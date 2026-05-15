import { sql } from '../db/index.js';
import { config, getChainConfig } from '../config.js';
import { enqueueWebhook } from './webhooks.js';
import { IndexerClient } from './indexer.js';
import { getUsdtBalance, getUsdtTxHash } from './balance.js';

export class PaymentMonitor {
  private interval: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private indexer: IndexerClient;

  constructor() {
    if (!config.indexerApiKey) {
      throw new Error('WDK_INDEXER_API_KEY is required');
    }
    this.indexer = new IndexerClient({ apiKey: config.indexerApiKey });
    console.log('Payment monitor: WDK Indexer (primary) + RPC (fallback)');
  }

  start(intervalMs = 5000) {
    if (this.interval) return;
    console.log(`Payment monitor started (polling every ${intervalMs / 1000}s)`);
    this.poll();
    this.interval = setInterval(() => this.poll(), intervalMs);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    console.log('Payment monitor stopped');
  }

  private async poll() {
    if (this.polling) return;
    this.polling = true;

    try {
      const intents = await sql`
        SELECT i.*
        FROM intents i
        WHERE i.status = 'waiting'
      `;

      // Group intents by chain
      if (intents.length > 0) {
        const byChain = new Map<string, Record<string, unknown>[]>();
        for (const intent of intents) {
          const chain = intent.chain as string;
          const list = byChain.get(chain) || [];
          list.push(intent as Record<string, unknown>);
          byChain.set(chain, list);
        }

        for (const [chain, chainIntents] of byChain) {
          try {
            await this.pollChain(chain, chainIntents);
          } catch (err) {
            console.error(`Monitor poll error for chain ${chain}:`, (err as Error).message);
          }
        }
      }
      // Cancel expired intents (waiting > 30 minutes)
      const expired = await sql`
        UPDATE intents
        SET status = 'cancelled',
            cancelled_at = now(),
            updated_at = now()
        WHERE status = 'waiting'
          AND created_at < now() - interval '30 minutes'
        RETURNING id, merchant_id, amount, order_id
      `;
      for (const intent of expired) {
        console.log(`Intent ${intent.id} expired after 30 minutes`);
        await enqueueWebhook(
          intent.merchant_id as string,
          intent.id as string,
          'intent.cancelled',
          { amount: intent.amount, order_id: intent.order_id },
        );
      }
      // Backfill tx hashes for confirmed intents (indexer may have caught up)
      await this.backfillTxHashes();
    } catch (err) {
      console.error('Monitor poll error:', err);
    } finally {
      this.polling = false;
    }
  }

  private async backfillTxHashes() {
    const pending = await sql`
      SELECT id, chain, address, created_at
      FROM intents
      WHERE status = 'confirmed'
        AND paid_tx_hash IS NULL
        AND confirmed_at > now() - interval '48 hours'
      LIMIT 5
    `;

    for (const intent of pending) {
      const chainCfg = getChainConfig(intent.chain as string);

      // Try RPC logs first, then indexer
      let txHash = await getUsdtTxHash(intent.chain as string, intent.address as string);
      if (!txHash && chainCfg.indexerName) {
        const afterTs = Math.floor(new Date(intent.created_at as string).getTime() / 1000);
        txHash = await this.indexerTxHash(chainCfg.indexerName, intent.address as string, afterTs);
      }
      if (txHash) {
        await sql`
          UPDATE intents SET paid_tx_hash = ${txHash}, updated_at = now()
          WHERE id = ${intent.id as string}
        `;
        console.log(`Backfilled tx hash for ${intent.id}: ${txHash}`);
      }
    }
  }

  private async pollChain(chain: string, intents: Record<string, unknown>[]) {
    const chainCfg = getChainConfig(chain);

    // WDK Indexer batch balance (primary) — one API call for all addresses
    const indexerBalances = new Map<string, number>();
    if (chainCfg.indexerName) {
      try {
        const queries = intents.map((i) => ({
          blockchain: chainCfg.indexerName!,
          token: 'usdt',
          address: i.address as string,
        }));
        const results = await this.indexer.batchTokenBalances(queries);
        for (let i = 0; i < intents.length; i++) {
          const r = results[i];
          if ('amount' in r) {
            const bal = parseFloat(r.amount);
            if (bal > 0) indexerBalances.set(intents[i].address as string, bal);
          }
        }
      } catch {
        // Indexer unavailable — fall back to RPC for all
      }
    }

    for (const intent of intents) {
      const address = intent.address as string;
      const requiredAmount = parseFloat(intent.amount as string);
      const previousPaid = parseFloat((intent.paid_amount as string) || '0');
      const baseline = parseFloat((intent.baseline_balance as string) || '0');

      // Use WDK Indexer balance if available, fall back to RPC
      let totalBalance = indexerBalances.get(address) ?? null;
      if (totalBalance === null || totalBalance <= 0) {
        totalBalance = await getUsdtBalance(chain, address);
      }

      if (totalBalance === null || totalBalance <= 0) continue;

      // Subtract baseline (pre-existing balance at intent creation) to get new funds
      const newFunds = totalBalance - baseline;
      if (newFunds <= 0 || newFunds <= previousPaid) continue;

      if (newFunds >= requiredAmount) {
        // Get tx hash: try RPC logs first (real-time), fall back to WDK Indexer
        let txHash = await getUsdtTxHash(chain, address);
        if (!txHash && chainCfg.indexerName) {
          const intentCreatedAt = Math.floor(new Date(intent.created_at as string).getTime() / 1000);
          txHash = await this.indexerTxHash(chainCfg.indexerName, address, intentCreatedAt);
        }

        const [updated] = await sql`
          UPDATE intents
          SET status = 'confirmed',
              paid_amount = ${newFunds.toString()},
              paid_tx_hash = ${txHash},
              paid_at = now(),
              confirmed_at = now(),
              updated_at = now()
          WHERE id = ${intent.id as string} AND status = 'waiting'
          RETURNING id
        `;
        if (updated) {
          console.log(
            `Intent ${intent.id} confirmed: ${newFunds} USDT${txHash ? ` tx ${txHash}` : ' (tx hash pending indexer sync)'}`,
          );
          await enqueueWebhook(
            intent.merchant_id as string,
            intent.id as string,
            'intent.confirmed',
            {
              amount: intent.amount,
              paid_amount: newFunds.toString(),
              paid_tx_hash: txHash,
              order_id: intent.order_id,
            },
          );
        }
      } else if (newFunds > 0 && newFunds !== previousPaid) {
        // Partial payment
        await sql`
          UPDATE intents
          SET paid_amount = ${newFunds.toString()},
              updated_at = now()
          WHERE id = ${intent.id as string} AND status = 'waiting'
            AND (paid_amount IS NULL OR paid_amount != ${newFunds.toString()})
        `;
        if (!previousPaid) {
          console.log(
            `Intent ${intent.id} partial payment: ${newFunds} USDT (need ${requiredAmount})`,
          );
        }
      }
    }
  }

  /** Get tx hash from WDK Indexer (best-effort, may return null if indexer is lagged) */
  private async indexerTxHash(
    blockchain: string,
    address: string,
    afterTs: number,
  ): Promise<string | null> {
    try {
      const transfers = await this.indexer.getTokenTransfers(
        blockchain,
        'usdt',
        address,
        { limit: 10, fromTs: afterTs },
      );
      const incoming = transfers.filter(
        (t) => t.to.toLowerCase() === address.toLowerCase(),
      );
      if (incoming.length === 0) return null;
      return incoming[incoming.length - 1].transactionHash;
    } catch {
      return null;
    }
  }
}
