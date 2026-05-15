export interface Transfer {
  blockchain: string;
  blockNumber: number;
  transactionHash: string;
  transferIndex: number;
  token: string;
  amount: string;
  timestamp: number;
  transactionIndex: number;
  logIndex: number;
  from: string;
  to: string;
}

export class IndexerClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(opts: { apiKey: string; baseUrl?: string }) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? 'https://wdk-api.tether.io';
  }

  async getTokenTransfers(
    blockchain: string,
    token: string,
    address: string,
    opts?: { limit?: number; fromTs?: number; toTs?: number },
  ): Promise<Transfer[]> {
    const params = new URLSearchParams();
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.fromTs) params.set('fromTs', String(opts.fromTs));
    if (opts?.toTs) params.set('toTs', String(opts.toTs));

    const qs = params.toString();
    const url = `${this.baseUrl}/api/v1/${blockchain}/${token}/${address}/token-transfers${qs ? '?' + qs : ''}`;

    const res = await fetch(url, {
      headers: { 'x-api-key': this.apiKey },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Indexer ${res.status}: ${body}`);
    }

    const data = await res.json();
    return data.transfers ?? [];
  }

  async getTokenBalance(
    blockchain: string,
    token: string,
    address: string,
  ): Promise<string> {
    const url = `${this.baseUrl}/api/v1/${blockchain}/${token}/${address}/token-balances`;
    const res = await fetch(url, {
      headers: { 'X-API-KEY': this.apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Indexer balance ${res.status}: ${body}`);
    }
    const data = (await res.json()) as { tokenBalance: { amount: string } };
    return data.tokenBalance.amount;
  }

  async batchTokenBalances(
    queries: Array<{ blockchain: string; token: string; address: string }>,
  ): Promise<Array<{ amount: string } | { error: string }>> {
    const url = `${this.baseUrl}/api/v1/batch/token-balances`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'X-API-KEY': this.apiKey, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify(queries),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Indexer batch balance ${res.status}: ${body}`);
    }
    const data = (await res.json()) as Array<{ tokenBalance?: { amount: string }; error?: string }>;
    return data.map((d) =>
      d.tokenBalance ? { amount: d.tokenBalance.amount } : { error: d.error || 'unknown' },
    );
  }

  async health(): Promise<{ status: string; timestamp?: string }> {
    const res = await fetch(`${this.baseUrl}/api/v1/health`, {
      headers: { 'X-API-KEY': this.apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Indexer health ${res.status}`);
    return res.json() as Promise<{ status: string; timestamp?: string }>;
  }
}
