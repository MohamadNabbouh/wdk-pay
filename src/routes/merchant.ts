import { FastifyInstance } from 'fastify';
import { sql } from '../db/index.js';
import { config, CHAINS } from '../config.js';
import { generateId, randomBase58, sha256 } from '../lib/crypto.js';
import { deriveAddress } from '../services/derivation.js';
import { getUsdtBalance } from '../services/balance.js';

export async function merchantRoutes(app: FastifyInstance) {
  // GET /api/merchant?wallet=0x... — get merchant info
  app.get('/api/merchant', async (request, reply) => {
    const { wallet } = request.query as Record<string, string>;
    if (!wallet) {
      return reply.code(400).send({ error: 'wallet query param required' });
    }

    const [merchant] = await sql`
      SELECT id, name, webhook_url, confirmation_threshold, wallet_address, fixed_receive_address, created_at
      FROM merchants WHERE wallet_address = ${wallet.toLowerCase()}
    `;

    if (!merchant) {
      return reply.code(404).send({ error: 'not_found' });
    }

    return merchant;
  });

  // POST /api/merchant — create merchant
  app.post('/api/merchant', async (request, reply) => {
    const body = request.body as Record<string, string> | null;
    if (!body) return reply.code(400).send({ error: 'Body required.' });

    const { name, xpub, webhook_url, wallet_address, fixed_receive_address } = body;

    if (!name?.trim() || !xpub?.trim() || !wallet_address?.trim()) {
      return reply.code(400).send({ error: 'name, xpub, and wallet_address are required.' });
    }

    if (!xpub.startsWith('xpub')) {
      return reply.code(400).send({ error: 'xpub must start with "xpub".' });
    }

    // Check if merchant already exists for this wallet
    const [existing] = await sql`
      SELECT id FROM merchants WHERE wallet_address = ${wallet_address.toLowerCase()}
    `;
    if (existing) {
      return reply.code(409).send({ error: 'Merchant already exists for this wallet.' });
    }

    const merchantId = generateId('merch');
    const apiKey = `wdk_live_${randomBase58(32)}`;
    const webhookSecret = `whsec_${randomBase58(32)}`;
    const apiKeyHash = sha256(apiKey);

    const fixedAddr = fixed_receive_address?.trim() || null;
    if (fixedAddr && !fixedAddr.match(/^0x[a-fA-F0-9]{40}$/)) {
      return reply.code(400).send({ error: 'fixed_receive_address must be a valid EVM address (0x...).' });
    }

    await sql`
      INSERT INTO merchants (id, name, xpub, webhook_url, webhook_secret, api_key_hash, confirmation_threshold, wallet_address, fixed_receive_address)
      VALUES (${merchantId}, ${name.trim()}, ${xpub.trim()}, ${webhook_url?.trim() || null}, ${webhookSecret}, ${apiKeyHash}, 1, ${wallet_address.toLowerCase()}, ${fixedAddr})
    `;

    return reply.code(201).send({
      id: merchantId,
      name: name.trim(),
      api_key: apiKey,
      webhook_secret: webhookSecret,
    });
  });

  // POST /api/merchant/intents — create test intent (dashboard demo)
  app.post('/api/merchant/intents', async (request, reply) => {
    const body = request.body as Record<string, string> | null;
    if (!body) return reply.code(400).send({ error: 'Body required.' });

    const wallet = body.wallet_address;
    if (!wallet) return reply.code(400).send({ error: 'wallet_address required.' });

    const [merchant] = await sql`
      SELECT id FROM merchants WHERE wallet_address = ${wallet.toLowerCase()}
    `;
    if (!merchant) return reply.code(404).send({ error: 'Merchant not found.' });

    const amount = body.amount || '10.00';
    const chain = body.chain || 'arbitrum';

    if (!CHAINS[chain]) {
      return reply.code(400).send({ error: `Unsupported chain: ${chain}` });
    }

    const orderId = `ord_${Date.now()}`;

    const intent = await sql.begin(async (tx) => {
      const [m] = await tx`
        SELECT id, xpub, next_derivation_idx, fixed_receive_address
        FROM merchants WHERE id = ${merchant.id} FOR UPDATE
      `;
      const idx = m.next_derivation_idx as number;
      const isFixed = !!m.fixed_receive_address;
      const address = isFixed
        ? (m.fixed_receive_address as string)
        : deriveAddress(m.xpub as string, idx);
      const id = generateId('pi');

      // Snapshot current balance so monitor only confirms NEW funds
      const baselineBalance = isFixed ? await getUsdtBalance(chain, address) : 0;

      const [row] = await tx`
        INSERT INTO intents (id, merchant_id, order_id, amount, currency, chain, address, derivation_idx, status, metadata, baseline_balance)
        VALUES (${id}, ${merchant.id}, ${orderId}, ${amount}, 'USDT', ${chain}, ${address}, ${idx}, 'waiting', '{}', ${baselineBalance})
        RETURNING *
      `;
      await tx`
        UPDATE merchants SET next_derivation_idx = ${idx + 1} WHERE id = ${merchant.id}
      `;
      return row;
    });

    return reply.code(201).send({
      id: intent.id,
      checkout_url: `${config.baseUrl}/pay/${intent.id}`,
      amount: intent.amount,
      chain: intent.chain,
      address: intent.address,
      status: intent.status,
    });
  });

  // GET /api/merchant/intents?wallet=0x... — list recent intents
  app.get('/api/merchant/intents', async (request, reply) => {
    const { wallet } = request.query as Record<string, string>;
    if (!wallet) return reply.code(400).send({ error: 'wallet query param required' });

    const [merchant] = await sql`
      SELECT id FROM merchants WHERE wallet_address = ${wallet.toLowerCase()}
    `;
    if (!merchant) return reply.code(404).send({ error: 'Merchant not found.' });

    const intents = await sql`
      SELECT id, order_id, amount, currency, chain, status, address, paid_amount, paid_tx_hash, created_at
      FROM intents
      WHERE merchant_id = ${merchant.id}
      ORDER BY created_at DESC
      LIMIT 20
    `;

    return { data: intents };
  });

  // PATCH /api/merchant — update merchant settings
  app.patch('/api/merchant', async (request, reply) => {
    const body = request.body as Record<string, string | null> | null;
    if (!body) return reply.code(400).send({ error: 'Body required.' });

    const wallet = body.wallet_address as string;
    if (!wallet) return reply.code(400).send({ error: 'wallet_address required.' });

    const [merchant] = await sql`
      SELECT id FROM merchants WHERE wallet_address = ${wallet.toLowerCase()}
    `;
    if (!merchant) return reply.code(404).send({ error: 'Merchant not found.' });

    // Update fixed_receive_address (null to clear, string to set)
    if ('fixed_receive_address' in body) {
      const addr = body.fixed_receive_address?.trim() || null;
      if (addr && !addr.match(/^0x[a-fA-F0-9]{40}$/)) {
        return reply.code(400).send({ error: 'fixed_receive_address must be a valid EVM address.' });
      }
      await sql`
        UPDATE merchants SET fixed_receive_address = ${addr} WHERE id = ${merchant.id}
      `;
    }

    // Update webhook_url
    if ('webhook_url' in body) {
      await sql`
        UPDATE merchants SET webhook_url = ${body.webhook_url?.trim() || null} WHERE id = ${merchant.id}
      `;
    }

    const [updated] = await sql`
      SELECT id, name, webhook_url, confirmation_threshold, wallet_address, fixed_receive_address, created_at
      FROM merchants WHERE id = ${merchant.id}
    `;
    return updated;
  });

  // DELETE /api/merchant?wallet=0x... — reset merchant
  app.delete('/api/merchant', async (request, reply) => {
    const { wallet } = request.query as Record<string, string>;
    if (!wallet) return reply.code(400).send({ error: 'wallet query param required' });

    const [merchant] = await sql`
      SELECT id FROM merchants WHERE wallet_address = ${wallet.toLowerCase()}
    `;
    if (!merchant) return reply.code(404).send({ error: 'Merchant not found.' });

    await sql`DELETE FROM webhook_deliveries WHERE merchant_id = ${merchant.id}`;
    await sql`DELETE FROM intents WHERE merchant_id = ${merchant.id}`;
    await sql`DELETE FROM merchants WHERE id = ${merchant.id}`;

    return { deleted: true };
  });
}
