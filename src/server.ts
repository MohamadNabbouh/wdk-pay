import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import cors from '@fastify/cors';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { sql } from './db/index.js';
import { intentRoutes } from './routes/intents.js';
import { checkoutRoutes } from './routes/checkout.js';
import { setupRoutes } from './routes/setup.js';
import { merchantRoutes } from './routes/merchant.js';
import { PaymentMonitor } from './services/monitor.js';
import { processWebhooks } from './services/webhooks.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = Fastify({ logger: { level: config.logLevel } });

await app.register(cors);

// Parse URL-encoded form bodies (for setup webhook form)
app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
  const parsed = Object.fromEntries(new URLSearchParams(body as string));
  done(null, parsed);
});

await app.register(intentRoutes, { prefix: '/v1' });
await app.register(checkoutRoutes);
await app.register(setupRoutes);
await app.register(merchantRoutes);

// Serve React SPA from client/dist/ if it exists
const clientDist = resolve(__dirname, '../client/dist');
if (existsSync(clientDist)) {
  await app.register(fastifyStatic, {
    root: clientDist,
    prefix: '/app/',
    wildcard: false,
  });

  // SPA catch-all: serve index.html for any /app/* route not matched by static files
  app.get('/app/*', async (_request, reply) => {
    return reply.sendFile('index.html', clientDist);
  });

  // Also handle exact /app (no trailing slash)
  app.get('/app', async (_request, reply) => {
    return reply.sendFile('index.html', clientDist);
  });
}

app.get('/health', async () => {
  await sql`SELECT 1`;
  return { status: 'ok', network: config.network };
});

// Root redirect — prefer /app if SPA is built, fallback to /setup
app.get('/', async (_request, reply) => {
  if (existsSync(clientDist)) {
    return reply.redirect('/app');
  }
  return reply.redirect('/setup');
});

// Payment monitor: RPC for real-time balance, WDK Indexer for tx hash tracking
const monitor = new PaymentMonitor();
monitor.start(config.pollIntervalMs);

// Process webhook deliveries every 5 seconds
const webhookInterval = setInterval(async () => {
  try {
    await processWebhooks();
  } catch (err) {
    console.error('Webhook processor error:', err);
  }
}, 5000);

const shutdown = async () => {
  monitor.stop();
  clearInterval(webhookInterval);
  await app.close();
  await sql.end();
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`WDK Pay running on http://localhost:${config.port}`);
