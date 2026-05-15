import { createHmac } from 'node:crypto';
import { sql } from '../db/index.js';
import { generateId } from '../lib/crypto.js';

interface WebhookPayload {
  event: string;
  intent_id: string;
  data: Record<string, unknown>;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

// Backoff: 10s, 30s, 90s, 270s, 810s (~13 min total)
function backoffMs(attempt: number): number {
  return 10_000 * Math.pow(3, attempt);
}

/** Enqueue a webhook delivery for later processing */
export async function enqueueWebhook(
  merchantId: string,
  intentId: string,
  event: string,
  data: Record<string, unknown>,
) {
  // Look up merchant webhook_url
  const [merchant] = await sql`
    SELECT webhook_url FROM merchants WHERE id = ${merchantId}
  `;
  if (!merchant?.webhook_url) return;

  const payload = { event, intent_id: intentId, data } as Record<string, unknown>;
  const id = generateId('whd');

  await sql`
    INSERT INTO webhook_deliveries (id, merchant_id, intent_id, event, url, payload)
    VALUES (${id}, ${merchantId}, ${intentId}, ${event}, ${merchant.webhook_url as string}, ${sql.json(payload as Record<string, string>)})
  `;
}

/** Process pending webhook deliveries — called on an interval */
export async function processWebhooks() {
  const deliveries = await sql`
    SELECT wd.*, m.webhook_secret
    FROM webhook_deliveries wd
    JOIN merchants m ON wd.merchant_id = m.id
    WHERE wd.status = 'pending' AND wd.next_attempt_at <= now()
    ORDER BY wd.next_attempt_at
    LIMIT 20
  `;

  for (const d of deliveries) {
    try {
      await deliver(d as Record<string, unknown>);
    } catch (err) {
      console.error(`Webhook delivery ${d.id} error:`, err);
    }
  }
}

async function deliver(d: Record<string, unknown>) {
  const body = JSON.stringify(d.payload);
  const signature = sign(body, d.webhook_secret as string);
  const attempt = (d.attempts as number) + 1;

  try {
    const res = await fetch(d.url as string, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-WDKPay-Signature': signature,
        'X-WDKPay-Event': d.event as string,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    if (res.ok) {
      await sql`
        UPDATE webhook_deliveries
        SET status = 'delivered', attempts = ${attempt}, completed_at = now()
        WHERE id = ${d.id as string}
      `;
      return;
    }

    throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const maxAttempts = d.max_attempts as number;
    const id = d.id as string;

    if (attempt >= maxAttempts) {
      await sql`
        UPDATE webhook_deliveries
        SET status = 'failed', attempts = ${attempt}, last_error = ${error}
        WHERE id = ${id}
      `;
    } else {
      const nextAt = new Date(Date.now() + backoffMs(attempt));
      await sql`
        UPDATE webhook_deliveries
        SET attempts = ${attempt}, last_error = ${error}, next_attempt_at = ${nextAt.toISOString()}
        WHERE id = ${id}
      `;
    }
  }
}
