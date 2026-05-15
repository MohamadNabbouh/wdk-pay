# WDK Pay — Self-Custodial USDT Checkout for Ecommerce

## What It Does (30-Second Version)
Merchant installs SDK → creates a payment intent (amount + order ID) → customer gets a hosted checkout page with QR code or wallet-connect → sends USDT from any wallet → backend detects payment via WDK Indexer + RPC → confirms intent → fires webhook to merchant. No custody, no intermediaries — USDT goes directly to the merchant's address.

Think Stripe Checkout, but for USDT on Arbitrum, Ethereum, Polygon, and Avalanche. Built on Tether's [Wallet Development Kit](https://docs.wallet.tether.io).

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────────┐
│  Merchant Server (Next.js, Shopify, etc.)                          │
│  ┌────────────────┐  ┌───────────────────┐  ┌───────────────────┐  │
│  │ SDK (wdk-pay)  │  │ POST /create-order│  │ POST /webhooks    │  │
│  │ intents.create │──│ server-side route │  │ signature verify  │  │
│  └──────┬─────────┘  └───────────────────┘  └────────▲──────────┘  │
│         │                                         │                │
└─────────┼─────────────────────────────────────────┼────────────────┘
          │ REST API (Bearer token)                 │ HMAC-SHA256 webhook
          ▼                                         │
┌────────────────────────────────────────────────────────────────────┐
│  WDK Pay Server (Fastify)                                          │
│                                                                    │
│  /v1/intents/*          REST API (create, get, list, cancel)       │
│  /pay/:id               Hosted checkout page (SSR HTML + QR)       │
│  /pay/:id/stream        SSE live status updates                    │
│  /setup                 Web setup wizard (merchant onboarding)     │
│  /api/merchant/*        Wallet-authenticated merchant API          │ 
│  /app/*                 SPA dashboard (React + wagmi)              │
│                                                                    │
│  Payment Monitor (5s polling loop)                                 │
│  ├── WDK Indexer API    POST batch/token-balances  (primary)       │
│  ├── RPC eth_call       balanceOf fallback          (fallback)     │
│  ├── RPC eth_getLogs    Transfer event tx hash      (real-time)    │
│  └── WDK Indexer API    token-transfers tx hash     (backfill)     │
│                                                                    │
│  Webhook Processor (5s interval)                                   │
│  └── HMAC-SHA256 signed POST with exponential backoff              │
│                                                                    │
│  PostgreSQL (intents, merchants, webhook_deliveries)               │
└────────────────────────────────────────────────────────────────────┘
          │                              │
          ▼                              ▼
┌──────────────────┐          ┌──────────────────┐
│  WDK Indexer API │          │  Chain RPCs      │
│  wdk-api.tether  │          │  (Arbitrum, ETH, │
│  .io             │          │   Polygon, AVAX) │
└──────────────────┘          └──────────────────┘
```

---

## The Payment Flow

### 1. Merchant Creates an Intent
```
POST /v1/intents
Authorization: Bearer wdk_live_...
{
  "amount": "10.00",
  "order_id": "ord_12345",
  "chain": "arbitrum",
  "metadata": { "product": "Pro License" }
}
```

Returns:
```json
{
  "id": "pi_abc123...",
  "amount": "10.00",
  "currency": "USDT",
  "chain": "arbitrum",
  "address": "0x7f2C...",
  "status": "waiting",
  "checkout_url": "https://yourserver.com/pay/pi_abc123..."
}
```

### 2. Address Derivation
Two modes depending on merchant config:

**HD-derived (default):** Each intent gets a unique address derived from the merchant's xpub.
```
BIP-44 path: m/44'/60'/0' (xpub level)
Remaining:   m/0/{idx}    (we derive this part)

idx 0 → 0x7f2C...  (intent 1)
idx 1 → 0xa3B1...  (intent 2)
idx 2 → 0x91F4...  (intent 3)
```
Uses `@scure/bip32` for derivation, `ethers.computeAddress()` for public key → address.

**Fixed address:** Merchant sets a single receive address. All intents share it.
Requires **baseline balance snapshotting** — at intent creation, we record the current USDT balance via RPC so the monitor only confirms *new* funds.

### 3. Customer Pays
Customer is redirected to `/pay/pi_abc123...` — a server-rendered checkout page with:
- **EIP-681 QR code** — scannable by any Ethereum wallet (MetaMask, Trust, etc.)
- **Copy-paste address and amount** — for manual transfer
- **SSE live updates** — page auto-updates when payment is detected/confirmed

The EIP-681 URI format:
```
ethereum:{USDT_CONTRACT}@{CHAIN_ID}/transfer?address={RECIPIENT}&uint256={AMOUNT_WEI}
```

### 4. Payment Detection (the core loop)

Every 5 seconds, the `PaymentMonitor` runs:

```
poll():
  1. SELECT all intents WHERE status = 'waiting'
  2. Group by chain

  For each chain:
    3. WDK Indexer batch balance query (primary path)
       POST wdk-api.tether.io/api/v1/batch/token-balances
       → Returns current USDT balance for all addresses in one call

    4. For addresses where indexer returned 0 or failed:
       RPC fallback: eth_call to USDT contract's balanceOf()
       → Real-time balance from the chain directly

    5. For each intent:
       newFunds = currentBalance - baseline_balance
       if newFunds >= requiredAmount:
         → CONFIRMED (get tx hash, fire webhook)
       else if newFunds > 0:
         → Partial payment (update paid_amount, keep waiting)

  6. Cancel intents older than 30 minutes
     → Fire intent.cancelled webhook

  7. Backfill tx hashes for confirmed intents missing one
     → Try RPC eth_getLogs first, then WDK Indexer transfers
```

### 5. Webhook Delivery
On confirmation or cancellation, a webhook is enqueued and delivered:

```
POST https://merchant.com/webhooks/wdkpay
Content-Type: application/json
X-WDKPay-Signature: <HMAC-SHA256 hex digest>
X-WDKPay-Event: intent.confirmed

{
  "event": "intent.confirmed",
  "intent_id": "pi_abc123...",
  "data": {
    "amount": "10.00",
    "paid_amount": "10.00",
    "paid_tx_hash": "0xabc...",
    "order_id": "ord_12345"
  }
}
```

Signature verification (merchant side):
```typescript
const expected = crypto.createHmac('sha256', webhookSecret)
  .update(rawBody).digest('hex');
if (signature !== expected) throw new Error('Invalid signature');
```

Retry policy: 5 attempts with exponential backoff (10s, 30s, 90s, 270s, 810s).

---

## WDK Indexer Integration

The [WDK Indexer API](https://docs.wallet.tether.io/tools/indexer-api) (`wdk-api.tether.io`) is the **primary** code path for both balance detection and transaction tracking.

### Endpoints Used

| Endpoint | Purpose | File |
|----------|---------|------|
| `POST /api/v1/batch/token-balances` | Batch USDT balance for all waiting intents per chain | `src/services/monitor.ts` → `pollChain()` |
| `GET /api/v1/{chain}/usdt/{addr}/token-transfers` | Tx hash lookup for confirmed payments | `src/services/monitor.ts` → `indexerTxHash()` |
| `GET /api/v1/health` | Health check | `src/services/indexer.ts` → `health()` |

### Why RPC Fallback Exists

The WDK Indexer is the first thing queried on every poll cycle. However, the indexer's sync state can lag behind the chain tip. When the indexer returns a zero balance for an address that actually has funds on-chain, the RPC fallback (`eth_call` to `balanceOf`) catches it in real-time.

This is standard practice for indexer-backed systems — the architecture is **indexer-first, RPC-fallback**. If/when the indexer syncs to real-time, the RPC path is never hit and the code requires zero changes.

| Detection Method | Source | Latency | Used For |
|-----------------|--------|---------|----------|
| WDK Indexer batch balance | `wdk-api.tether.io` | Depends on sync | Primary balance check |
| RPC `balanceOf` | Chain RPC | Real-time | Fallback when indexer returns 0 |
| RPC `eth_getLogs` | Chain RPC | Real-time (last 5000 blocks) | Tx hash for fresh payments |
| WDK Indexer transfers | `wdk-api.tether.io` | Depends on sync | Tx hash backfill for older payments |

---

## Baseline Balance (Fixed Address Safety)

When a merchant uses a **fixed receive address** (same address for all intents), pre-existing USDT would falsely confirm new intents. Solution:

```
At intent creation:
  baseline = RPC balanceOf(fixedAddress)    # snapshot current balance

At payment detection:
  newFunds = currentBalance - baseline
  if newFunds >= intentAmount → confirmed
```

HD-derived addresses always start at 0, so `baseline = 0` for those.

---

## Supported Chains

| Chain | Chain ID | USDT Contract | RPC | Indexer Name |
|-------|----------|---------------|-----|-------------|
| Arbitrum | 42161 | `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9` | `arb1.arbitrum.io/rpc` | `arbitrum` |
| Ethereum | 1 | `0xdAC17F958D2ee523a2206206994597C13D831ec7` | `ethereum-rpc.publicnode.com` | `ethereum` |
| Polygon | 137 | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` | `polygon-bor-rpc.publicnode.com` | `polygon` |
| Avalanche | 43114 | `0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7` | `api.avax.network/ext/bc/C/rpc` | `avalanche` |

---

## Merchant SDK (`sdk/index.ts`)

A lightweight TypeScript SDK for server-side integration:

```typescript
import WdkPay from 'wdk-pay';

const wdkPay = new WdkPay({
  apiKey: 'wdk_live_...',
  baseUrl: 'https://your-wdkpay-server.com',
  webhookSecret: 'whsec_...',  // optional, for webhook verification
});

// Create a payment intent
const intent = await wdkPay.intents.create({
  amount: '25.00',
  orderId: 'order-789',
  chain: 'arbitrum',
  metadata: { customer: 'alice@example.com' },
});

// Redirect customer to checkout
redirect(intent.checkout_url);

// Later: verify webhook
app.post('/webhooks', (req, res) => {
  const event = wdkPay.webhooks.constructEvent(
    req.body,                              // raw JSON string
    req.headers['x-wdkpay-signature'],     // HMAC-SHA256 hex
  );

  if (event.event === 'intent.confirmed') {
    fulfillOrder(event.data.order_id);
  }
});
```

### SDK Methods

| Method | Description |
|--------|-------------|
| `intents.create(params)` | Create a new payment intent |
| `intents.get(id)` | Retrieve an intent by ID |
| `intents.list({ status?, limit? })` | List intents with optional filters |
| `intents.cancel(id)` | Cancel a waiting intent |
| `webhooks.constructEvent(body, sig)` | Verify and parse a webhook payload |

---

## REST API Reference

All `/v1/*` routes require `Authorization: Bearer <api_key>`.

### POST /v1/intents
Create a payment intent.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `amount` | string | yes | — | USDT amount (e.g. `"10.00"`) |
| `order_id` | string | yes | — | Your order reference |
| `chain` | string | no | `"arbitrum"` | Target chain |
| `metadata` | object | no | `{}` | Arbitrary JSON metadata |

**Response (201):**
```json
{
  "id": "pi_...",
  "amount": "10.00",
  "currency": "USDT",
  "chain": "arbitrum",
  "order_id": "ord_123",
  "address": "0x...",
  "status": "waiting",
  "checkout_url": "https://server/pay/pi_...",
  "paid_amount": null,
  "paid_tx_hash": null,
  "metadata": {},
  "created_at": "2026-05-15T12:00:00.000Z"
}
```

### GET /v1/intents/:id
Retrieve a single intent.

### GET /v1/intents
List intents. Query params: `status` (waiting/confirmed/cancelled), `limit` (max 100).

### POST /v1/intents/:id/cancel
Cancel a waiting intent. Returns `409` if already terminal.

---

## Webhook Events

| Event | Fired When | Data Fields |
|-------|------------|-------------|
| `intent.confirmed` | Payment confirmed on-chain | `amount`, `paid_amount`, `paid_tx_hash`, `order_id` |
| `intent.cancelled` | Intent cancelled (manual or 30min expiry) | `amount`, `order_id` |

Webhooks are signed with HMAC-SHA256 using the merchant's `webhook_secret`. The signature is in the `X-WDKPay-Signature` header. Verify by computing `HMAC-SHA256(raw_body, webhook_secret)` and comparing.

---

## Setup Guide

### Prerequisites
- Node.js 20+
- PostgreSQL 14+
- A WDK Indexer API key ([request here](https://docs.wallet.tether.io/tools/indexer-api))
- An xpub key at BIP-44 account level (`m/44'/60'/0'`)

### 1. Install and Configure

```bash
git clone https://github.com/your-repo/wdk-pay.git
cd wdk-pay
npm install

# Create .env
cat > .env << 'EOF'
DATABASE_URL=postgres://wdkpay:wdkpay@localhost:5432/wdkpay
WDK_INDEXER_API_KEY=your_indexer_api_key
BASE_URL=https://your-domain.com
PORT=3000
NETWORK=mainnet
LOG_LEVEL=info
POLL_INTERVAL_MS=5000
EOF
```

### 2. Create Database

```bash
createdb wdkpay
npm run migrate
```

### 3. Start the Server

```bash
# Development
npm run dev

# Production
npx tsx src/server.ts
# or: npm run build && node dist/server.js
```

### 4. Merchant Onboarding

**Option A: Web setup wizard** — Visit `http://localhost:3000/setup` and follow the guided flow. Enter your merchant name, xpub, and optionally a webhook URL. You'll receive your API key and webhook secret.

**Option B: API** — `POST /api/merchant` with `name`, `xpub`, `wallet_address`, and optionally `webhook_url` and `fixed_receive_address`.

### 5. Build the Dashboard (optional)

```bash
cd client && npm install && npm run build
```

The SPA dashboard is served at `/app/` and provides a UI for managing intents, viewing payment history, and updating settings.

---

## How the Two Servers Work Together

WDK Pay runs as two processes in a typical deployment:

```
Port 3000 — WDK Pay Server (Fastify)
├── /setup              Merchant onboarding wizard (create account, get credentials)
├── /v1/intents/*       REST API (the SDK talks to this)
├── /pay/:id            Hosted checkout page (customer-facing, QR + SSE)
├── /api/merchant/*     Dashboard API (wallet-authenticated)
├── /app/*              SPA dashboard (React)
└── Payment Monitor     Background polling loop (detects payments, fires webhooks)

Port 3001 — Example Storefront (Next.js)
├── /                   Product catalog with cart + chain selector
├── /api/create-intent  Server-side route → calls WDK Pay SDK → creates intent on :3000
├── /api/webhooks       Receives webhook POSTs from :3000 when payment confirms
└── /api/intent         Polls intent status from :3000 for live checkout updates
```

**The end-to-end flow:**

1. Merchant visits `:3000/setup` → enters name + xpub → gets **API key** (`wdk_live_...`) and **webhook secret** (`whsec_...`)
2. Merchant puts those credentials in their storefront's `.env.local` (the example app on `:3001`)
3. Customer browses products on `:3001`, adds to cart, clicks Checkout
4. Storefront's server-side route uses the SDK + API key to call `:3000/v1/intents` → creates a payment intent
5. Customer sees checkout UI with QR code and wallet-connect option
6. Customer sends USDT from any wallet to the intent address
7. `:3000`'s payment monitor detects the payment via WDK Indexer / RPC
8. `:3000` confirms the intent and POSTs a webhook to `:3001/api/webhooks` (signed with the webhook secret)
9. Storefront verifies the signature and fulfills the order

---

## Example Integration (Next.js)

The `example/` directory contains a complete Next.js storefront demonstrating:

- **Product catalog** with cart and chain selector
- **Two payment methods**: wallet-connect (RainbowKit/wagmi) and QR/manual
- **Server-side intent creation** via the WDK Pay SDK
- **Webhook handler** with signature verification

```bash
cd example
npm install

# Paste the API key and webhook secret from the setup wizard (:3000/setup)
cat > .env.local << 'EOF'
WDK_PAY_API_KEY=wdk_live_...
WDK_PAY_BASE_URL=http://localhost:3000
WDK_PAY_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_WC_PROJECT_ID=your_walletconnect_project_id
EOF

npm run dev   # runs on port 3001
```

### Example: Create Intent (server-side route)
```typescript
// example/app/api/create-intent/route.ts
import WdkPay from 'wdk-pay';

const wdkPay = new WdkPay({
  apiKey: process.env.WDK_PAY_API_KEY!,
  baseUrl: process.env.WDK_PAY_BASE_URL,
});

export async function POST(request: NextRequest) {
  const { amount, chain, productName } = await request.json();
  const intent = await wdkPay.intents.create({
    amount,
    orderId: `ord_${Date.now()}`,
    chain,
    metadata: { product: productName },
  });
  return NextResponse.json(intent);
}
```

### Example: Verify Webhook
```typescript
// example/app/api/webhooks/route.ts
const event = wdkPay.webhooks.constructEvent(body, signature);

if (event.event === 'intent.confirmed') {
  console.log(`Order ${event.data.order_id} paid! ${event.data.paid_amount} USDT`);
  // Fulfill the order in your database
}
```

---

## Database Schema

Three tables — `merchants`, `intents`, `webhook_deliveries`:

```sql
merchants
├── id                    TEXT PRIMARY KEY         -- merch_...
├── name                  TEXT NOT NULL
├── xpub                  TEXT NOT NULL             -- BIP-44 account-level xpub
├── next_derivation_idx   INTEGER DEFAULT 0         -- auto-incrementing address index
├── webhook_url           TEXT                      -- optional
├── webhook_secret        TEXT NOT NULL             -- whsec_...
├── api_key_hash          TEXT NOT NULL             -- SHA-256 of wdk_live_...
├── wallet_address        TEXT                      -- for dashboard auth
├── fixed_receive_address TEXT                      -- optional, overrides HD derivation
└── created_at            TIMESTAMPTZ

intents
├── id                TEXT PRIMARY KEY              -- pi_...
├── merchant_id       TEXT REFERENCES merchants
├── order_id          TEXT NOT NULL
├── amount            NUMERIC(38,6) NOT NULL
├── currency          TEXT DEFAULT 'USDT'
├── chain             TEXT DEFAULT 'arbitrum'
├── address           TEXT NOT NULL                 -- derived or fixed
├── derivation_idx    INTEGER NOT NULL
├── status            TEXT DEFAULT 'waiting'        -- waiting | confirmed | cancelled
├── baseline_balance  NUMERIC(38,6) DEFAULT 0      -- pre-existing balance snapshot
├── paid_amount       NUMERIC(38,6)
├── paid_tx_hash      TEXT
├── paid_at           TIMESTAMPTZ
├── confirmed_at      TIMESTAMPTZ
├── cancelled_at      TIMESTAMPTZ
├── metadata          JSONB DEFAULT '{}'
├── created_at        TIMESTAMPTZ
└── updated_at        TIMESTAMPTZ

webhook_deliveries
├── id              TEXT PRIMARY KEY                -- whd_...
├── merchant_id     TEXT REFERENCES merchants
├── intent_id       TEXT REFERENCES intents
├── event           TEXT NOT NULL                   -- intent.confirmed | intent.cancelled
├── url             TEXT NOT NULL
├── payload         JSONB NOT NULL
├── status          TEXT DEFAULT 'pending'          -- pending | delivered | failed
├── attempts        INTEGER DEFAULT 0
├── max_attempts    INTEGER DEFAULT 5
├── next_attempt_at TIMESTAMPTZ
├── last_error      TEXT
├── created_at      TIMESTAMPTZ
└── completed_at    TIMESTAMPTZ
```

---

## Key Configuration (`src/config.ts`)

| Parameter | Env Variable | Default | Purpose |
|-----------|-------------|---------|---------|
| `port` | `PORT` | `3000` | Server listen port |
| `databaseUrl` | `DATABASE_URL` | `postgres://localhost:5432/wdkpay` | PostgreSQL connection |
| `baseUrl` | `BASE_URL` | `http://localhost:3000` | Public URL for checkout links |
| `indexerApiKey` | `WDK_INDEXER_API_KEY` | — | WDK Indexer API authentication |
| `pollIntervalMs` | `POLL_INTERVAL_MS` | `5000` | Payment monitor polling interval |
| `logLevel` | `LOG_LEVEL` | `info` | Fastify log level |
| `network` | `NETWORK` | `mainnet` | Network identifier |

### Hardcoded Constants

| Constant | Value | Location | Purpose |
|----------|-------|----------|---------|
| Intent expiry | 30 minutes | `monitor.ts` | Auto-cancel waiting intents |
| Webhook retry | 5 attempts | `webhook_deliveries.max_attempts` | Max delivery attempts |
| Webhook backoff | 10s * 3^attempt | `webhooks.ts` | Exponential backoff (10s → 810s) |
| RPC log window | 5000 blocks | `balance.ts` | `eth_getLogs` lookback for tx hash |
| Tx hash backfill | 48 hours | `monitor.ts` | Only backfill recent confirmed intents |
| SSE poll | 3 seconds | `checkout.ts` | Checkout page status update interval |
| USDT decimals | 6 | All chains | Standard USDT precision |

---

## Security Considerations

- **API keys** are stored as SHA-256 hashes — the plaintext key is shown once at creation and never stored
- **Webhook signatures** use HMAC-SHA256 with a per-merchant secret, preventing payload tampering
- **HD derivation** uses `@scure/bip32` (audited library) — only the xpub is stored, never the private key
- **Input validation** on all API endpoints (amount must be positive, chain must be supported, addresses must match `0x[a-fA-F0-9]{40}`)
- **SQL injection prevention** via parameterized queries (`postgres.js` tagged templates)
- **XSS prevention** via HTML entity escaping on all SSR-rendered user data
- **No custody** — the server never holds private keys or moves funds

---

## Project Structure

```
wdk-pay/
├── src/
│   ├── server.ts              # Fastify entry point
│   ├── config.ts              # Environment config + chain definitions
│   ├── db/
│   │   ├── index.ts           # postgres.js connection
│   │   ├── schema.sql         # Table definitions
│   │   └── migrate.ts         # Migration runner
│   ├── routes/
│   │   ├── intents.ts         # REST API (Bearer auth)
│   │   ├── checkout.ts        # SSR checkout page + SSE stream
│   │   ├── setup.ts           # Web setup wizard
│   │   └── merchant.ts        # Wallet-authenticated API (dashboard)
│   ├── services/
│   │   ├── monitor.ts         # Payment detection loop
│   │   ├── indexer.ts         # WDK Indexer API client
│   │   ├── balance.ts         # RPC balance + tx hash
│   │   ├── webhooks.ts        # Webhook enqueue + delivery
│   │   └── derivation.ts      # BIP-44 HD address derivation
│   ├── lib/
│   │   └── crypto.ts          # ID generation, SHA-256, Base58
│   └── types.ts               # Shared TypeScript types
├── sdk/
│   └── index.ts               # Merchant SDK (WdkPay class)
├── client/                    # React SPA dashboard (Vite + wagmi)
├── example/                   # Next.js reference storefront
├── package.json
└── tsconfig.json
```

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Server | Fastify 5 |
| Language | TypeScript (strict, ESM) |
| Database | PostgreSQL via `postgres.js` |
| HD Derivation | `@scure/bip32` + `ethers` v6 |
| QR Codes | `qrcode` (server) + `react-qr-code` (client) |
| Dashboard | React + Vite + wagmi + RainbowKit |
| Example App | Next.js 14 + wagmi |
| Testing | Vitest |
| Runtime | Node.js 20+ |

---

## License

MIT
