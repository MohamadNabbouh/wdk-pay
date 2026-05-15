import { getChainConfig } from '../config.js';

const BALANCE_OF = '0x70a08231';
// ERC-20 Transfer(address,address,uint256) event signature
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/** Get USDT balance for an address on a given chain via RPC eth_call */
export async function getUsdtBalance(chain: string, address: string): Promise<number> {
  const cfg = getChainConfig(chain);
  try {
    const padded = address.slice(2).toLowerCase().padStart(64, '0');
    const res = await fetch(cfg.rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [{ to: cfg.usdtContract, data: BALANCE_OF + padded }, 'latest'],
        id: 1,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json()) as { result?: string };
    if (!json.result || json.result === '0x') return 0;
    return Number(BigInt(json.result)) / 10 ** cfg.decimals;
  } catch {
    return 0;
  }
}

/** Get the tx hash of the most recent USDT Transfer to an address via RPC eth_getLogs */
export async function getUsdtTxHash(chain: string, address: string): Promise<string | null> {
  const cfg = getChainConfig(chain);
  try {
    // Get current block number
    const blockRes = await fetch(cfg.rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
      signal: AbortSignal.timeout(10_000),
    });
    const blockJson = (await blockRes.json()) as { result?: string };
    if (!blockJson.result) return null;

    const currentBlock = parseInt(blockJson.result, 16);
    const fromBlock = '0x' + Math.max(0, currentBlock - 5000).toString(16);
    const toPadded = '0x' + address.slice(2).toLowerCase().padStart(64, '0');

    const logsRes = await fetch(cfg.rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getLogs',
        params: [{
          address: cfg.usdtContract,
          topics: [TRANSFER_TOPIC, null, toPadded],
          fromBlock,
          toBlock: 'latest',
        }],
        id: 2,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const logsJson = (await logsRes.json()) as { result?: Array<{ transactionHash: string }> };
    if (!logsJson.result || logsJson.result.length === 0) return null;

    // Return the most recent transfer tx hash
    return logsJson.result[logsJson.result.length - 1].transactionHash;
  } catch {
    return null;
  }
}
