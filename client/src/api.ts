const BASE = '';

export async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...opts?.headers as Record<string, string> };
  if (opts?.body) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers,
  });

  if (res.status === 404) {
    throw new NotFoundError();
  }

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }

  return data as T;
}

export class NotFoundError extends Error {
  constructor() {
    super('Not found');
    this.name = 'NotFoundError';
  }
}

export interface MerchantInfo {
  id: string;
  name: string;
  webhook_url: string | null;
  wallet_address: string;
  fixed_receive_address: string | null;
  created_at: string;
}

export interface MerchantCreated {
  id: string;
  name: string;
  api_key: string;
  webhook_secret: string;
}

export interface IntentSummary {
  id: string;
  order_id: string;
  amount: string;
  currency: string;
  chain: string;
  status: string;
  address: string;
  paid_amount: string | null;
  paid_tx_hash: string | null;
  created_at: string;
}

export interface IntentCreated {
  id: string;
  checkout_url: string;
  amount: string;
  chain: string;
  address: string;
  status: string;
}

export function getMerchant(wallet: string) {
  return apiFetch<MerchantInfo>(`/api/merchant?wallet=${wallet}`);
}

export function createMerchant(body: {
  name: string;
  xpub: string;
  wallet_address: string;
  webhook_url?: string;
}) {
  return apiFetch<MerchantCreated>('/api/merchant', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateMerchant(body: {
  wallet_address: string;
  fixed_receive_address?: string | null;
  webhook_url?: string | null;
  confirmation_threshold?: string;
}) {
  return apiFetch<MerchantInfo>('/api/merchant', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function deleteMerchant(wallet: string) {
  return apiFetch<{ deleted: boolean }>(`/api/merchant?wallet=${wallet}`, {
    method: 'DELETE',
  });
}

export function listIntents(wallet: string) {
  return apiFetch<{ data: IntentSummary[] }>(`/api/merchant/intents?wallet=${wallet}`);
}

export function createIntent(body: {
  wallet_address: string;
  amount: string;
  chain: string;
}) {
  return apiFetch<IntentCreated>('/api/merchant/intents', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
