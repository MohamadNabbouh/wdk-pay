/**
 * Simulate a payment for testing — bypasses the indexer entirely.
 *
 * Usage:
 *   npx tsx src/db/simulate-payment.ts <intent_id>
 *   npx tsx src/db/simulate-payment.ts <intent_id> --partial   # simulate partial payment
 *
 * This updates the DB exactly like the real monitor would,
 * so webhooks fire, SSE updates, checkout page transitions — everything.
 */
import { sql } from './index.js';
import { enqueueWebhook } from '../services/webhooks.js';

const intentId = process.argv[2];
const partial = process.argv.includes('--partial');

if (!intentId) {
  console.error('Usage: npx tsx src/db/simulate-payment.ts <intent_id> [--partial]');
  process.exit(1);
}

const [intent] = await sql`
  SELECT i.*, m.webhook_url
  FROM intents i
  JOIN merchants m ON i.merchant_id = m.id
  WHERE i.id = ${intentId}
`;

if (!intent) {
  console.error(`Intent ${intentId} not found.`);
  await sql.end();
  process.exit(1);
}

if (intent.status !== 'waiting') {
  console.error(`Intent is already ${intent.status}. Can only simulate for 'waiting' intents.`);
  await sql.end();
  process.exit(1);
}

const fakeTxHash = '0x' + 'ab'.repeat(32);
const requiredAmount = parseFloat(intent.amount as string);
const simulatedAmount = partial ? (requiredAmount * 0.5).toFixed(6) : requiredAmount.toFixed(6);

if (partial) {
  // Simulate partial payment (detected but not confirmed)
  await sql`
    UPDATE intents
    SET paid_amount = ${simulatedAmount},
        paid_tx_hash = ${fakeTxHash},
        updated_at = now()
    WHERE id = ${intentId} AND status = 'waiting'
  `;
  console.log(`Simulated partial payment: ${simulatedAmount} / ${requiredAmount} USDT`);
  console.log('Intent stays in "waiting" — checkout page will show "Payment detected, confirming..."');
} else {
  // Simulate full confirmed payment
  await sql`
    UPDATE intents
    SET status = 'confirmed',
        paid_amount = ${simulatedAmount},
        paid_tx_hash = ${fakeTxHash},
        paid_at = now(),
        confirmed_at = now(),
        updated_at = now()
    WHERE id = ${intentId} AND status = 'waiting'
  `;
  console.log(`Simulated confirmed payment: ${simulatedAmount} USDT, tx ${fakeTxHash}`);

  // Fire webhook just like the real monitor does
  await enqueueWebhook(
    intent.merchant_id as string,
    intentId,
    'intent.confirmed',
    {
      amount: intent.amount,
      paid_amount: simulatedAmount,
      paid_tx_hash: fakeTxHash,
      order_id: intent.order_id,
    },
  );
  console.log('Webhook enqueued (will deliver on next processor tick).');
}

await sql.end();
