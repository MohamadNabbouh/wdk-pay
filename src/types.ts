export interface Merchant {
  id: string;
  name: string;
  xpub: string;
  next_derivation_idx: number;
  webhook_url: string | null;
  webhook_secret: string;
  api_key_hash: string;
  confirmation_threshold: number;
  wallet_address: string | null;
  fixed_receive_address: string | null;
  created_at: Date;
}

export interface Intent {
  id: string;
  merchant_id: string;
  order_id: string;
  amount: string;
  currency: string;
  chain: string;
  address: string;
  derivation_idx: number;
  status: 'waiting' | 'confirmed' | 'cancelled';
  metadata: Record<string, unknown>;
  paid_amount: string | null;
  paid_tx_hash: string | null;
  paid_at: Date | null;
  confirmed_at: Date | null;
  cancelled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}
