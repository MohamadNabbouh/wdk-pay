import { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { sql } from '../db/index.js';
import { config, getChainConfig } from '../config.js';

function formatDisplayAmount(amount: string): string {
  const n = parseFloat(amount);
  // Keep at least 2 decimals, up to 6 if meaningful
  const fixed = n.toFixed(6);
  const trimmed = fixed.replace(/0+$/, '');
  const decimals = trimmed.split('.')[1]?.length ?? 0;
  return decimals < 2 ? n.toFixed(2) : trimmed;
}

function amountToSmallestUnit(amount: string, decimals = 6): string {
  const [whole, frac = ''] = parseFloat(amount).toFixed(decimals).split('.');
  return BigInt(whole + frac).toString();
}

function buildEip681Uri(address: string, amount: string, chain: string): string {
  const chainCfg = getChainConfig(chain);
  const wei = amountToSmallestUnit(amount, chainCfg.decimals);
  return `ethereum:${chainCfg.usdtContract}@${chainCfg.chainId}/transfer?address=${address}&uint256=${wei}`;
}

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function chainDisplayName(chain: string): string {
  const names: Record<string, string> = {
    arbitrum: 'Arbitrum',
    ethereum: 'Ethereum',
    polygon: 'Polygon',
    avalanche: 'Avalanche',
  };
  return names[chain] || chain;
}

function renderPage(intent: Record<string, unknown>, qrSvg: string): string {
  const id = intent.id as string;
  const amount = formatDisplayAmount(intent.amount as string);
  const address = intent.address as string;
  const status = intent.status as string;
  const orderId = esc(intent.order_id as string);
  const chain = intent.chain as string;
  const txHash = intent.paid_tx_hash as string | null;
  const chainCfg = getChainConfig(chain);
  const chainName = chainDisplayName(chain);

  const isTerminal = status === 'confirmed' || status === 'cancelled';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pay ${amount} USDT — WDK Pay</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f0f2f5;color:#1a1a1a;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
.card{background:#fff;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,.08);max-width:420px;width:100%;padding:32px 24px;text-align:center}
.brand{font-size:14px;font-weight:600;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:24px}
.chain-badge{display:inline-block;background:#eff6ff;color:#1d4ed8;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;margin-bottom:16px}
.amount-display{font-size:36px;font-weight:700;margin-bottom:4px}
.amount-display .currency{font-size:20px;font-weight:500;color:#666}
.order-id{font-size:13px;color:#999;margin-bottom:24px}
.qr-wrap{display:flex;justify-content:center;margin-bottom:24px}
.qr-wrap svg{width:220px;height:220px;border-radius:8px}
.field{text-align:left;margin-bottom:16px}
.field label{display:block;font-size:12px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
.copyable{display:flex;align-items:center;gap:8px;background:#f7f8fa;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px}
.copyable code{flex:1;font-size:13px;font-family:"SF Mono",Monaco,Consolas,monospace;word-break:break-all;color:#333}
.copyable button{flex-shrink:0;border:none;background:#e5e7eb;color:#555;font-size:12px;font-weight:600;padding:6px 12px;border-radius:6px;cursor:pointer;transition:all .15s}
.copyable button:hover{background:#d1d5db}
.copyable button.copied{background:#059669;color:#fff}
.status-bar{display:flex;align-items:center;justify-content:center;gap:8px;margin-top:24px;padding:12px;border-radius:8px;font-size:14px;font-weight:500}
.status-bar.waiting{background:#fefce8;color:#a16207}
.status-bar.detected{background:#eff6ff;color:#1d4ed8}
.status-bar.confirmed{background:#ecfdf5;color:#047857}
.status-bar.cancelled{background:#fef2f2;color:#b91c1c}
.dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.waiting .dot{background:#eab308;animation:pulse 1.5s infinite}
.detected .dot{background:#3b82f6;animation:pulse 1s infinite}
.confirmed .dot{background:#059669}
.cancelled .dot{background:#dc2626}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.tx-link{display:block;margin-top:12px;font-size:12px;color:#2563eb;text-decoration:none;word-break:break-all}
.tx-link:hover{text-decoration:underline}
.footer{text-align:center;margin-top:20px;font-size:12px;color:#aaa}
.hidden{display:none}
</style>
</head>
<body>
<div>
<div class="card">
  <div class="brand">WDK Pay</div>
  <div class="chain-badge">${esc(chainName)}</div>

  <div class="amount-display">${amount} <span class="currency">USDT</span></div>
  <div class="order-id">Order ${orderId}</div>

  <div class="qr-wrap${isTerminal ? ' hidden' : ''}" id="qr">${qrSvg}</div>

  <div class="${isTerminal ? 'hidden' : ''}" id="fields">
    <div class="field">
      <label>Send to address</label>
      <div class="copyable">
        <code>${esc(address)}</code>
        <button data-copy="${esc(address)}" onclick="copy(this)">Copy</button>
      </div>
    </div>
    <div class="field">
      <label>Exact amount</label>
      <div class="copyable">
        <code>${esc(amount)} USDT</code>
        <button data-copy="${esc(amount)}" onclick="copy(this)">Copy</button>
      </div>
    </div>
  </div>

  <div class="status-bar ${status === 'waiting' && intent.paid_amount ? 'detected' : status}" id="status">
    <span class="dot"></span>
    <span id="status-text">${
      status === 'waiting'
        ? (intent.paid_amount ? 'Payment detected, confirming...' : 'Waiting for payment...')
        : status === 'confirmed'
          ? 'Payment confirmed!'
          : 'Payment cancelled.'
    }</span>
  </div>

  ${
    txHash
      ? `<a class="tx-link" href="${chainCfg.explorer}/tx/${txHash}" target="_blank" rel="noopener" id="tx-link">View transaction ↗</a>`
      : '<a class="tx-link hidden" id="tx-link" target="_blank" rel="noopener"></a>'
  }
</div>
<div class="footer">Powered by WDK · ${esc(chainName)} Network</div>
</div>

<script>
function copy(b){
  var text=b.dataset.copy;
  if(navigator.clipboard&&window.isSecureContext){
    navigator.clipboard.writeText(text).then(function(){done(b)}).catch(function(){fallback(text,b)});
  }else{fallback(text,b)}
}
function fallback(text,b){
  var ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.left='-9999px';
  document.body.appendChild(ta);ta.select();
  try{document.execCommand('copy');done(b)}catch(e){}
  document.body.removeChild(ta);
}
function done(b){b.textContent='Copied!';b.classList.add('copied');setTimeout(function(){b.textContent='Copy';b.classList.remove('copied')},2000)}

${
  !isTerminal
    ? `
(function(){
  var es=new EventSource('/pay/${id}/stream');
  es.addEventListener('status',function(e){
    var d=JSON.parse(e.data);
    var bar=document.getElementById('status');
    var txt=document.getElementById('status-text');
    if(d.status==='confirmed'){
      bar.className='status-bar confirmed';
      txt.textContent='Payment confirmed!';
      document.getElementById('qr').classList.add('hidden');
      document.getElementById('fields').classList.add('hidden');
      if(d.paid_tx_hash){
        var a=document.getElementById('tx-link');
        a.href='${chainCfg.explorer}/tx/'+d.paid_tx_hash;
        a.textContent='View transaction ↗';
        a.classList.remove('hidden');
      }
      es.close();
    }else if(d.status==='cancelled'){
      bar.className='status-bar cancelled';
      txt.textContent='Payment cancelled.';
      document.getElementById('qr').classList.add('hidden');
      document.getElementById('fields').classList.add('hidden');
      es.close();
    }else if(d.status==='waiting'&&d.paid_amount){
      bar.className='status-bar detected';
      txt.textContent='Payment detected, confirming...';
    }
  });
})();
`
    : ''
}
</script>
</body>
</html>`;
}

export async function checkoutRoutes(app: FastifyInstance) {
  // Hosted checkout page — no auth required (customer-facing)
  app.get('/pay/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const [intent] = await sql`SELECT * FROM intents WHERE id = ${id}`;

    if (!intent) {
      reply.code(404);
      return 'Payment not found.';
    }

    const eip681 = buildEip681Uri(
      intent.address as string,
      intent.amount as string,
      intent.chain as string,
    );
    const qrSvg = await QRCode.toString(eip681, {
      type: 'svg',
      margin: 2,
      color: { dark: '#1a1a1a', light: '#ffffff' },
    });

    reply.header('Content-Type', 'text/html; charset=utf-8');
    return renderPage(intent, qrSvg);
  });

  // SSE stream for live status updates
  app.get('/pay/:id/stream', async (request, reply) => {
    const { id } = request.params as { id: string };
    const [intent] = await sql`
      SELECT status, paid_amount, paid_tx_hash FROM intents WHERE id = ${id}
    `;

    if (!intent) {
      reply.code(404);
      return 'Not found';
    }

    reply.hijack();
    const res = reply.raw;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const send = (data: Record<string, unknown>) => {
      res.write(`event: status\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Send current state immediately (including paid_amount if detected)
    send({
      status: intent.status,
      paid_amount: intent.paid_amount,
      paid_tx_hash: intent.paid_tx_hash,
    });

    // If already terminal, close
    if (intent.status === 'confirmed' || intent.status === 'cancelled') {
      res.end();
      return;
    }

    // Poll for changes every 3 seconds
    const interval = setInterval(async () => {
      try {
        const [current] = await sql`
          SELECT status, paid_amount, paid_tx_hash FROM intents WHERE id = ${id}
        `;
        if (!current) {
          clearInterval(interval);
          res.end();
          return;
        }

        send({
          status: current.status,
          paid_amount: current.paid_amount,
          paid_tx_hash: current.paid_tx_hash,
        });

        if (
          current.status === 'confirmed' ||
          current.status === 'cancelled'
        ) {
          clearInterval(interval);
          res.end();
        }
      } catch {
        clearInterval(interval);
        res.end();
      }
    }, 3000);

    request.raw.on('close', () => clearInterval(interval));
  });
}
