CREATE TABLE IF NOT EXISTS merchants (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  xpub                  TEXT NOT NULL,
  next_derivation_idx   INTEGER NOT NULL DEFAULT 0,
  webhook_url           TEXT,
  webhook_secret        TEXT NOT NULL,
  api_key_hash          TEXT NOT NULL,
  confirmation_threshold INTEGER NOT NULL DEFAULT 5,
  wallet_address        TEXT,
  fixed_receive_address TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_merchants_wallet ON merchants(wallet_address) WHERE wallet_address IS NOT NULL;

CREATE TABLE IF NOT EXISTS intents (
  id              TEXT PRIMARY KEY,
  merchant_id     TEXT NOT NULL REFERENCES merchants(id),
  order_id        TEXT NOT NULL,
  amount          NUMERIC(38, 6) NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'USDT',
  chain           TEXT NOT NULL DEFAULT 'arbitrum',
  address         TEXT NOT NULL,
  derivation_idx  INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'waiting',
  metadata        JSONB DEFAULT '{}',
  baseline_balance NUMERIC(38, 6) NOT NULL DEFAULT 0,
  paid_amount     NUMERIC(38, 6),
  paid_tx_hash    TEXT,
  paid_at         TIMESTAMPTZ,
  confirmed_at    TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_intents_derivation ON intents(merchant_id, chain, derivation_idx);
CREATE INDEX IF NOT EXISTS idx_intents_address ON intents(chain, address);
CREATE INDEX IF NOT EXISTS idx_intents_status ON intents(status) WHERE status IN ('waiting');
CREATE INDEX IF NOT EXISTS idx_intents_order ON intents(merchant_id, order_id);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id              TEXT PRIMARY KEY,
  merchant_id     TEXT NOT NULL REFERENCES merchants(id),
  intent_id       TEXT NOT NULL REFERENCES intents(id),
  event           TEXT NOT NULL,
  url             TEXT NOT NULL,
  payload         JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webhook_pending ON webhook_deliveries(next_attempt_at) WHERE status = 'pending';
