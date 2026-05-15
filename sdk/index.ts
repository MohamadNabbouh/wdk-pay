import { createHmac } from 'node:crypto';

export interface WdkPayOptions {
  apiKey: string;
  baseUrl?: string;
  webhookSecret?: string;
}

export interface CreateIntentParams {
  amount: string;
  orderId: string;
  chain?: string;
  metadata?: Record<string, unknown>;
}

export interface Intent {
  id: string;
  amount: string;
  currency: string;
  chain: string;
  order_id: string;
  address: string;
  status: 'waiting' | 'confirmed' | 'cancelled';
  checkout_url: string;
  paid_amount: string | null;
  paid_tx_hash: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface WebhookEvent {
  event: string;
  intent_id: string;
  data: Record<string, unknown>;
}

class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'WdkPayApiError';
  }
}

export class WdkPay {
  private apiKey: string;
  private baseUrl: string;
  private webhookSecret: string | null;

  public intents: IntentsResource;
  public webhooks: WebhooksResource;

  constructor(opts: WdkPayOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? 'http://localhost:3000').replace(/\/$/, '');
    this.webhookSecret = opts.webhookSecret ?? null;
    this.intents = new IntentsResource(this);
    this.webhooks = new WebhooksResource(this);
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });

    const data = await res.json();

    if (!res.ok) {
      const err = (data as { error?: { code?: string; message?: string } })
        .error;
      throw new ApiError(
        res.status,
        err?.code ?? 'unknown',
        err?.message ?? `HTTP ${res.status}`,
      );
    }

    return data as T;
  }

  getWebhookSecret(): string {
    if (!this.webhookSecret) {
      throw new Error('webhookSecret not configured');
    }
    return this.webhookSecret;
  }
}

class IntentsResource {
  constructor(private client: WdkPay) {}

  async create(params: CreateIntentParams): Promise<Intent> {
    return this.client.request<Intent>('POST', '/v1/intents', {
      amount: params.amount,
      order_id: params.orderId,
      chain: params.chain,
      metadata: params.metadata,
    });
  }

  async get(id: string): Promise<Intent> {
    return this.client.request<Intent>('GET', `/v1/intents/${id}`);
  }

  async list(opts?: {
    status?: string;
    limit?: number;
  }): Promise<{ data: Intent[] }> {
    const params = new URLSearchParams();
    if (opts?.status) params.set('status', opts.status);
    if (opts?.limit) params.set('limit', String(opts.limit));
    const qs = params.toString();
    return this.client.request<{ data: Intent[] }>(
      'GET',
      `/v1/intents${qs ? '?' + qs : ''}`,
    );
  }

  async cancel(id: string): Promise<Intent> {
    return this.client.request<Intent>('POST', `/v1/intents/${id}/cancel`);
  }
}

class WebhooksResource {
  constructor(private client: WdkPay) {}

  /**
   * Verify and parse a webhook payload.
   * Pass the raw JSON body string and the X-WDKPay-Signature header value.
   */
  constructEvent(body: string, signature: string): WebhookEvent {
    const secret = this.client.getWebhookSecret();
    const expected = createHmac('sha256', secret).update(body).digest('hex');

    if (signature !== expected) {
      throw new Error('Invalid webhook signature');
    }

    return JSON.parse(body) as WebhookEvent;
  }
}

export default WdkPay;
