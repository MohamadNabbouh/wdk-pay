import { FastifyInstance } from 'fastify';
import { sql } from '../db/index.js';
import { generateId, randomBase58, sha256 } from '../lib/crypto.js';

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function setupRoutes(app: FastifyInstance) {
  // Check if any merchant exists
  app.get('/setup', async (_request, reply) => {
    const [existing] = await sql`SELECT id, name, webhook_url, confirmation_threshold, created_at FROM merchants LIMIT 1`;
    if (existing) {
      const merchant = existing;
      reply.header('Content-Type', 'text/html; charset=utf-8');
      return configuredPage(merchant as Record<string, unknown>);
    }

    reply.header('Content-Type', 'text/html; charset=utf-8');
    return setupPage();
  });

  // GET /setup/reset?confirm=yes — reconfigure merchant (deletes old one)
  app.get('/setup/reset', async (request, reply) => {
    const { confirm } = request.query as Record<string, string>;
    if (confirm !== 'yes') {
      return reply.redirect('/setup');
    }

    const [existing] = await sql`SELECT id FROM merchants LIMIT 1`;
    if (!existing) {
      return reply.redirect('/setup');
    }

    // Delete merchant and all related data
    await sql`DELETE FROM webhook_deliveries WHERE merchant_id = ${existing.id}`;
    await sql`DELETE FROM intents WHERE merchant_id = ${existing.id}`;
    await sql`DELETE FROM merchants WHERE id = ${existing.id}`;

    return reply.redirect('/setup');
  });

  // POST /setup/webhook — update webhook URL
  app.post('/setup/webhook', async (request, reply) => {
    const [merchant] = await sql`SELECT id FROM merchants LIMIT 1`;
    if (!merchant) {
      return reply.code(404).send({ error: 'No merchant configured.' });
    }

    const body = request.body as Record<string, string> | null;
    const webhookUrl = body?.webhook_url?.trim() || null;

    if (webhookUrl && !/^https?:\/\/.+/.test(webhookUrl)) {
      return reply.code(400).send({ error: 'Invalid URL format.' });
    }

    await sql`
      UPDATE merchants SET webhook_url = ${webhookUrl} WHERE id = ${merchant.id}
    `;

    return reply.redirect('/setup');
  });

  // POST /setup — create merchant
  app.post('/setup', async (request, reply) => {
    const [existing] = await sql`SELECT id FROM merchants LIMIT 1`;
    if (existing) {
      return reply.code(409).send({ error: 'Merchant already configured.' });
    }

    const body = request.body as Record<string, string> | null;
    if (!body) return reply.code(400).send({ error: 'Body required.' });

    const { name, xpub, webhook_url } = body;

    if (!name?.trim() || !xpub?.trim()) {
      return reply
        .code(400)
        .send({ error: 'name and xpub are required.' });
    }

    // Basic xpub validation
    if (!xpub.startsWith('xpub')) {
      return reply
        .code(400)
        .send({ error: 'xpub must start with "xpub".' });
    }

    const merchantId = generateId('merch');
    const apiKey = `wdk_live_${randomBase58(32)}`;
    const webhookSecret = `whsec_${randomBase58(32)}`;
    const apiKeyHash = sha256(apiKey);
    await sql`
      INSERT INTO merchants (id, name, xpub, webhook_url, webhook_secret, api_key_hash, confirmation_threshold)
      VALUES (${merchantId}, ${name.trim()}, ${xpub.trim()}, ${webhook_url?.trim() || null}, ${webhookSecret}, ${apiKeyHash}, 1)
    `;

    reply.header('Content-Type', 'text/html; charset=utf-8');
    return successPage(name.trim(), apiKey, webhookSecret);
  });
}

function configuredPage(merchant: Record<string, unknown>): string {
  const name = esc(merchant.name as string);
  const webhookUrl = merchant.webhook_url ? esc(merchant.webhook_url as string) : '<span style="color:#aaa">Not configured</span>';
  const created = new Date(merchant.created_at as string).toLocaleDateString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WDK Pay — Settings</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f0f2f5;color:#1a1a1a;min-height:100vh}
.nav{background:#fff;border-bottom:1px solid #e5e7eb;padding:16px 24px;display:flex;align-items:center;justify-content:space-between}
.nav .brand{font-size:16px;font-weight:700;color:#1a1a1a}
.nav .brand span{color:#059669}
.nav-links{display:flex;gap:16px}
.nav-link{font-size:13px;font-weight:500;color:#666;text-decoration:none;padding:4px 8px;border-radius:6px;transition:all .15s}
.nav-link:hover{color:#1a1a1a;background:#f3f4f6}
.nav .network{font-size:12px;background:#ecfdf5;color:#047857;padding:4px 10px;border-radius:12px;font-weight:600}
.container{max-width:560px;margin:0 auto;padding:32px 16px}
.card{background:#fff;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,.08);padding:32px 24px}
h1{font-size:24px;margin-bottom:4px;text-align:center}
.subtitle{text-align:center;color:#666;font-size:14px;margin-bottom:24px}
.info-row{display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid #f3f4f6;font-size:14px}
.info-row:last-child{border-bottom:none}
.info-label{color:#888;font-weight:500}
.info-value{color:#1a1a1a;font-weight:600}
.reset-section{margin-top:24px;padding-top:24px;border-top:2px solid #fef2f2}
.reset-section h3{font-size:15px;color:#b91c1c;margin-bottom:8px}
.reset-section p{font-size:13px;color:#666;margin-bottom:16px}
.reset-btn{width:100%;padding:12px;background:#fff;color:#dc2626;border:2px solid #fecaca;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;transition:all .15s}
.reset-btn:hover{background:#fef2f2;border-color:#dc2626}

.modal-overlay{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.5);z-index:1000;align-items:center;justify-content:center;padding:16px}
.modal-overlay.open{display:flex}
.modal{background:#fff;border-radius:16px;max-width:440px;width:100%;padding:32px 24px;text-align:center}
.modal h2{font-size:20px;color:#b91c1c;margin-bottom:12px}
.modal p{font-size:14px;color:#555;margin-bottom:8px}
.modal .warning{background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;font-size:13px;color:#991b1b;margin:16px 0;text-align:left}
.modal .warning li{margin:4px 0 4px 16px}
.modal-actions{display:flex;gap:12px;margin-top:20px}
.modal-actions button{flex:1;padding:12px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;border:none}
.cancel-btn{background:#f3f4f6;color:#555}
.cancel-btn:hover{background:#e5e7eb}
.confirm-btn{background:#dc2626;color:#fff}
.confirm-btn:hover{background:#b91c1c}
</style>
</head>
<body>

<div class="nav">
  <div class="brand"><span>WDK</span> Pay</div>
  <div class="nav-links">
    <a href="/app" class="nav-link">Store</a>
    <a href="/setup" class="nav-link">Settings</a>
  </div>
  <div class="network">Mainnet</div>
</div>

<div class="container">
  <div class="card">
    <h1>Settings</h1>
    <p class="subtitle">Current merchant configuration</p>

    <div class="info-row"><span class="info-label">Business Name</span><span class="info-value">${name}</span></div>
    <div class="info-row"><span class="info-label">Created</span><span class="info-value">${created}</span></div>

    <div style="margin-top:24px;padding-top:24px;border-top:1px solid #f3f4f6">
      <form method="POST" action="/setup/webhook" style="display:flex;flex-direction:column;gap:8px">
        <label style="font-size:13px;font-weight:600;color:#555">Webhook URL</label>
        <div style="display:flex;gap:8px">
          <input type="url" name="webhook_url" value="${merchant.webhook_url ? esc(merchant.webhook_url as string) : ''}" placeholder="https://yoursite.com/webhooks/wdkpay" style="flex:1;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;font-family:inherit">
          <button type="submit" style="padding:10px 20px;background:#2563eb;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap">Save</button>
        </div>
        <small style="font-size:12px;color:#999">Leave empty to disable webhooks. Payment events will be POST'd here with HMAC-SHA256 signatures.</small>
      </form>
    </div>

    <div class="reset-section">
      <h3>Reconfigure Store</h3>
      <p>Set up a new wallet and get new API credentials. This will delete all existing payment history.</p>
      <button class="reset-btn" onclick="showResetModal()">Reconfigure Merchant</button>
    </div>
  </div>
</div>

<!-- Reset Confirmation Modal -->
<div class="modal-overlay" id="reset-modal">
  <div class="modal">
    <h2>Are you sure?</h2>
    <p>This will permanently delete your current configuration.</p>
    <div class="warning">
      <strong>This action will:</strong>
      <ul>
        <li>Delete your current merchant profile</li>
        <li>Invalidate your existing API key</li>
        <li>Delete all payment history</li>
        <li>Generate a new wallet and new credentials</li>
      </ul>
    </div>
    <p style="font-size:13px;color:#888">Your funds are safe — they remain in your wallet controlled by your seed phrase.</p>
    <div class="modal-actions">
      <button class="cancel-btn" onclick="closeResetModal()">Cancel</button>
      <a href="/setup/reset?confirm=yes" class="confirm-btn" style="flex:1;text-decoration:none;text-align:center;display:flex;align-items:center;justify-content:center">Yes, Reconfigure</a>
    </div>
  </div>
</div>

<script>
function showResetModal(){document.getElementById('reset-modal').classList.add('open')}
function closeResetModal(){document.getElementById('reset-modal').classList.remove('open')}
document.getElementById('reset-modal').addEventListener('click',function(e){if(e.target===this)closeResetModal()});
document.addEventListener('keydown',function(e){if(e.key==='Escape')closeResetModal()});
</script>
</body>
</html>`;
}

function setupPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WDK Pay — Setup</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f0f2f5;color:#1a1a1a;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
.card{background:#fff;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,.08);max-width:520px;width:100%;padding:32px 24px}
.brand{font-size:14px;font-weight:600;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;text-align:center}
h1{text-align:center;font-size:24px;margin-bottom:4px}
.subtitle{text-align:center;color:#666;font-size:14px;margin-bottom:24px}
.field{margin-bottom:16px}
.field label{display:block;font-size:13px;font-weight:600;color:#555;margin-bottom:6px}
.field input{width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;font-family:inherit}
.field input:focus{outline:none;border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.1)}
.field small{display:block;margin-top:4px;font-size:12px;color:#999}
.seed-area{background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:16px;margin-bottom:20px}
.seed-area h3{font-size:14px;margin-bottom:8px;color:#a16207}
.seed-area p{font-size:13px;color:#92400e;margin-bottom:8px}
.seed-words{font-family:"SF Mono",Monaco,Consolas,monospace;font-size:13px;background:#fff;border:1px solid #fde68a;border-radius:6px;padding:12px;word-break:break-all;margin-bottom:8px;user-select:all}
.seed-copy-btn{width:100%;padding:8px;background:#a16207;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;margin-bottom:8px}
.seed-copy-btn:hover{background:#92400e}
.seed-copy-btn.done{background:#059669}
.seed-area .warning{font-size:12px;color:#dc2626;font-weight:600}
.copyable{display:flex;align-items:center;gap:8px;background:#f7f8fa;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px}
.copyable code{flex:1;font-size:13px;font-family:"SF Mono",Monaco,Consolas,monospace;word-break:break-all;color:#333}
.copy-btn{flex-shrink:0;border:none;background:#e5e7eb;color:#555;font-size:12px;font-weight:600;padding:6px 12px;border-radius:6px;cursor:pointer}
.copy-btn:hover{background:#d1d5db}
.copy-btn.done{background:#059669;color:#fff}
#generate-btn{background:#2563eb;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;width:100%;margin-bottom:16px}
#generate-btn:hover{background:#1d4ed8}
#generate-btn:disabled{background:#93c5fd;cursor:not-allowed}
#submit-btn{background:#059669;color:#fff;border:none;padding:12px 20px;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;width:100%;margin-top:8px}
#submit-btn:hover{background:#047857}
#submit-btn:disabled{background:#6ee7b7;cursor:not-allowed}
.hidden{display:none}
#error{color:#dc2626;font-size:13px;margin-top:8px;text-align:center}
</style>
</head>
<body>
<div class="card">
  <div class="brand">WDK Pay</div>
  <h1>Merchant Setup</h1>
  <p class="subtitle">Configure your payment gateway in one step.</p>

  <div class="field">
    <label for="name">Business Name</label>
    <input type="text" id="name" placeholder="My Store" required>
  </div>

  <div class="seed-area hidden" id="seed-area">
    <h3>Your Wallet Seed Phrase</h3>
    <p>Write this down and store it securely. This is the ONLY time you will see it.</p>
    <div class="seed-words" id="seed-words"></div>
    <button type="button" class="seed-copy-btn" id="copy-seed-btn" onclick="copySeed()">Copy Seed Phrase</button>
    <p class="warning">The server never sees this seed phrase. Only the xpub (watch-only key) is sent.</p>
  </div>

  <button type="button" id="generate-btn">Generate Wallet</button>

  <div class="hidden" id="xpub-section">
    <div class="field">
      <label for="xpub">Extended Public Key (xpub)</label>
      <input type="text" id="xpub" readonly>
      <small>Derived from your seed phrase. This is safe to share — it cannot spend funds.</small>
    </div>
  </div>

  <div class="field">
    <label for="webhook_url">Webhook URL (optional)</label>
    <input type="url" id="webhook_url" placeholder="https://yoursite.com/webhooks/wdkpay">
    <small>We'll POST payment events here with HMAC-SHA256 signatures.</small>
  </div>

  <button type="button" id="submit-btn" disabled>Complete Setup</button>
  <div id="error"></div>
</div>

<script>
function doCopy(text,btn){
  if(navigator.clipboard&&window.isSecureContext){
    navigator.clipboard.writeText(text).then(function(){markDone(btn)}).catch(function(){fallback(text,btn)});
  }else{fallback(text,btn)}
}
function fallback(text,btn){
  var ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.left='-9999px';
  document.body.appendChild(ta);ta.select();
  try{document.execCommand('copy');markDone(btn)}catch(e){}
  document.body.removeChild(ta);
}
function markDone(btn){btn.textContent='Copied!';btn.classList.add('done');setTimeout(function(){btn.textContent='Copy';btn.classList.remove('done')},2000)}
function copySeed(){
  var text=document.getElementById('seed-words').textContent;
  var btn=document.getElementById('copy-seed-btn');
  if(navigator.clipboard&&window.isSecureContext){
    navigator.clipboard.writeText(text).then(function(){btn.textContent='Copied!';btn.classList.add('done');setTimeout(function(){btn.textContent='Copy Seed Phrase';btn.classList.remove('done')},2000)}).catch(function(){fallbackSeed(text,btn)});
  }else{fallbackSeed(text,btn)}
}
function fallbackSeed(text,btn){
  var ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.left='-9999px';
  document.body.appendChild(ta);ta.select();
  try{document.execCommand('copy');btn.textContent='Copied!';btn.classList.add('done');setTimeout(function(){btn.textContent='Copy Seed Phrase';btn.classList.remove('done')},2000)}catch(e){}
  document.body.removeChild(ta);
}
</script>
<script type="module">
import { ethers } from 'https://esm.sh/ethers@6';

const genBtn = document.getElementById('generate-btn');
const submitBtn = document.getElementById('submit-btn');
const seedArea = document.getElementById('seed-area');
const seedWords = document.getElementById('seed-words');
const xpubSection = document.getElementById('xpub-section');
const xpubInput = document.getElementById('xpub');
const errorEl = document.getElementById('error');

let xpubValue = '';

genBtn.addEventListener('click', () => {
  try {
    const wallet = ethers.HDNodeWallet.createRandom();
    const mnemonic = wallet.mnemonic.phrase;
    seedWords.textContent = mnemonic;
    seedArea.classList.remove('hidden');

    // Derive account-level xpub: m/44'/60'/0'
    const accountNode = ethers.HDNodeWallet.fromPhrase(mnemonic, "", "m/44'/60'/0'");
    xpubValue = accountNode.neuter().extendedKey;
    xpubInput.value = xpubValue;
    xpubSection.classList.remove('hidden');
    submitBtn.disabled = false;
    genBtn.disabled = true;
    genBtn.textContent = 'Wallet Generated';
  } catch (e) {
    errorEl.textContent = 'Failed to generate wallet: ' + e.message;
  }
});

submitBtn.addEventListener('click', async () => {
  errorEl.textContent = '';
  const name = document.getElementById('name').value.trim();
  if (!name) { errorEl.textContent = 'Business name is required.'; return; }
  if (!xpubValue) { errorEl.textContent = 'Generate a wallet first.'; return; }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Setting up...';

  try {
    const res = await fetch('/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        xpub: xpubValue,
        webhook_url: document.getElementById('webhook_url').value.trim() || undefined,
      }),
    });

    if (res.ok) {
      // Replace entire page — use document.write so scripts execute
      var html = await res.text();
      document.open();
      document.write(html);
      document.close();
    } else {
      const err = await res.json();
      errorEl.textContent = err.error || 'Setup failed.';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Complete Setup';
    }
  } catch (e) {
    errorEl.textContent = 'Network error: ' + e.message;
    submitBtn.disabled = false;
    submitBtn.textContent = 'Complete Setup';
  }
});
</script>
</body>
</html>`;
}

function successPage(name: string, apiKey: string, webhookSecret: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WDK Pay — Setup Complete</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f0f2f5;color:#1a1a1a;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
.card{background:#fff;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,.08);max-width:520px;width:100%;padding:32px 24px}
h1{text-align:center;font-size:24px;margin-bottom:4px;color:#059669}
.subtitle{text-align:center;color:#666;font-size:14px;margin-bottom:24px}
.field{margin-bottom:16px}
.field label{display:block;font-size:12px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
.copyable{display:flex;align-items:center;gap:8px;background:#f7f8fa;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px}
.copyable code{flex:1;font-size:13px;font-family:"SF Mono",Monaco,Consolas,monospace;word-break:break-all;color:#333}
.copyable button{flex-shrink:0;border:none;background:#e5e7eb;color:#555;font-size:12px;font-weight:600;padding:6px 12px;border-radius:6px;cursor:pointer}
.copyable button:hover{background:#d1d5db}
.warning{background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;font-size:13px;color:#991b1b;margin-top:20px}
</style>
</head>
<body>
<div class="card">
  <h1>Setup Complete</h1>
  <p class="subtitle">${esc(name)} is ready to accept payments.</p>

  <div class="field">
    <label>API Key</label>
    <div class="copyable">
      <code>${esc(apiKey)}</code>
      <button onclick="copyText('${esc(apiKey)}',this)">Copy</button>
    </div>
  </div>

  <div class="field">
    <label>Webhook Secret</label>
    <div class="copyable">
      <code>${esc(webhookSecret)}</code>
      <button onclick="copyText('${esc(webhookSecret)}',this)">Copy</button>
    </div>
  </div>

  <div class="warning">
    Save these credentials now — they will not be shown again. The API key is used to authenticate requests, and the webhook secret is used to verify webhook signatures.
  </div>

  <a href="/app" style="display:block;text-align:center;margin-top:20px;padding:12px 20px;background:#059669;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Go to Store Demo</a>
</div>

<script>
function copyText(text,btn){
  if(navigator.clipboard&&window.isSecureContext){
    navigator.clipboard.writeText(text).then(function(){btn.textContent='Copied!';setTimeout(function(){btn.textContent='Copy'},2000)}).catch(function(){fallbackCopy(text,btn)});
  }else{fallbackCopy(text,btn)}
}
function fallbackCopy(text,btn){
  var ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.left='-9999px';
  document.body.appendChild(ta);ta.select();
  try{document.execCommand('copy');btn.textContent='Copied!';setTimeout(function(){btn.textContent='Copy'},2000)}catch(e){}
  document.body.removeChild(ta);
}
</script>
</body>
</html>`;
}
