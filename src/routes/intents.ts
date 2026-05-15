import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { sql } from '../db/index.js';
import { config, CHAINS } from '../config.js';
import { generateId, sha256 } from '../lib/crypto.js';
import { deriveAddress } from '../services/derivation.js';
import { enqueueWebhook } from '../services/webhooks.js';
import { getUsdtBalance } from '../services/balance.js';
import type { Merchant } from '../types.js';

declare module 'fastify' {
  interface FastifyRequest {
    merchant: Merchant;
  }
}

function apiError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
) {
  return reply.code(status).send({ error: { code, message } });
}

function formatIntent(row: Record<string, unknown>) {
  return {
    id: row.id,
    amount: row.amount,
    currency: row.currency,
    chain: row.chain,
    order_id: row.order_id,
    address: row.address,
    status: row.status,
    checkout_url: `${config.baseUrl}/pay/${row.id}`,
    paid_amount: row.paid_amount ?? null,
    paid_tx_hash: row.paid_tx_hash ?? null,
    metadata: row.metadata ?? {},
    created_at: row.created_at,
  };
}

export async function intentRoutes(app: FastifyInstance) {
  // Auth hook — all routes in this plugin require Bearer token
  app.addHook(
    'onRequest',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.headers.authorization;
      if (!auth?.startsWith('Bearer ')) {
        return apiError(reply, 401, 'unauthorized', 'Missing API key.');
      }

      const hash = sha256(auth.slice(7));
      const [merchant] = await sql`
        SELECT * FROM merchants WHERE api_key_hash = ${hash}
      `;

      if (!merchant) {
        return apiError(reply, 401, 'unauthorized', 'Invalid API key.');
      }

      request.merchant = merchant as unknown as Merchant;
    },
  );

  // POST /intents — create payment intent
  app.post('/intents', async (request, reply) => {
    const merchant = request.merchant;
    const body = request.body as Record<string, unknown> | null;

    if (!body || typeof body !== 'object') {
      return apiError(reply, 400, 'invalid_request', 'Request body required.');
    }

    const amount = body.amount as string | undefined;
    const orderId = body.order_id as string | undefined;
    const chain = (body.chain as string | undefined) || 'arbitrum';
    const metadata = (body.metadata as Record<string, unknown>) ?? {};

    if (!amount || !orderId) {
      return apiError(
        reply,
        400,
        'invalid_request',
        'amount and order_id are required.',
      );
    }

    if (isNaN(Number(amount)) || Number(amount) <= 0) {
      return apiError(
        reply,
        400,
        'invalid_request',
        'amount must be a positive number.',
      );
    }

    if (!CHAINS[chain]) {
      return apiError(
        reply,
        400,
        'invalid_request',
        `Unsupported chain: ${chain}. Supported: ${Object.keys(CHAINS).join(', ')}`,
      );
    }

    const intent = await sql.begin(async (tx) => {
      // Lock merchant row to serialize derivation index allocation
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
        VALUES (${id}, ${merchant.id}, ${orderId}, ${amount}, 'USDT', ${chain}, ${address}, ${idx}, 'waiting', ${sql.json(metadata as Record<string, string>)}, ${baselineBalance})
        RETURNING *
      `;

      await tx`
        UPDATE merchants SET next_derivation_idx = ${idx + 1} WHERE id = ${merchant.id}
      `;

      return row;
    });

    return reply.code(201).send(formatIntent(intent));
  });

  // GET /intents/:id — retrieve single intent
  app.get('/intents/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const [intent] = await sql`
      SELECT * FROM intents WHERE id = ${id} AND merchant_id = ${request.merchant.id}
    `;

    if (!intent) {
      return apiError(
        reply,
        404,
        'intent_not_found',
        'No intent matches the provided ID.',
      );
    }

    return formatIntent(intent);
  });

  // GET /intents — list intents
  app.get('/intents', async (request) => {
    const merchant = request.merchant;
    const { status, limit: limitStr } = request.query as Record<
      string,
      string
    >;
    const limit = Math.min(parseInt(limitStr, 10) || 50, 100);

    const intents = status
      ? await sql`
          SELECT * FROM intents
          WHERE merchant_id = ${merchant.id} AND status = ${status}
          ORDER BY created_at DESC LIMIT ${limit}
        `
      : await sql`
          SELECT * FROM intents
          WHERE merchant_id = ${merchant.id}
          ORDER BY created_at DESC LIMIT ${limit}
        `;

    return { data: intents.map(formatIntent) };
  });

  // POST /intents/:id/cancel — cancel a waiting intent
  app.post('/intents/:id/cancel', async (request, reply) => {
    const { id } = request.params as { id: string };
    const merchantId = request.merchant.id;

    const [intent] = await sql`
      UPDATE intents
      SET status = 'cancelled', cancelled_at = now(), updated_at = now()
      WHERE id = ${id} AND merchant_id = ${merchantId} AND status = 'waiting'
      RETURNING *
    `;

    if (!intent) {
      const [existing] = await sql`
        SELECT status FROM intents WHERE id = ${id} AND merchant_id = ${merchantId}
      `;
      if (!existing) {
        return apiError(
          reply,
          404,
          'intent_not_found',
          'No intent matches the provided ID.',
        );
      }
      return apiError(
        reply,
        409,
        'intent_already_terminal',
        `Intent is already ${existing.status}.`,
      );
    }

    await enqueueWebhook(merchantId, id, 'intent.cancelled', {
      amount: intent.amount,
      order_id: intent.order_id,
    });

    return formatIntent(intent);
  });
}
