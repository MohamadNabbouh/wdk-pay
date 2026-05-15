import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgres://localhost:5432/wdkpay',
  network: (process.env.NETWORK || 'mainnet') as 'mainnet' | 'testnet',
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  logLevel: process.env.LOG_LEVEL || 'info',
  confirmationThreshold: parseInt(process.env.CONFIRMATION_THRESHOLD || '5', 10),
  indexerApiKey: process.env.WDK_INDEXER_API_KEY || '',
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '5000', 10),
} as const;

export interface ChainConfig {
  chainId: number;
  rpc: string;
  usdtContract: string;
  explorer: string;
  /** Name used in WDK Indexer API paths, or null if indexer doesn't support this chain */
  indexerName: string | null;
  /** USDT decimals (6 for most chains) */
  decimals: number;
}

export const CHAINS: Record<string, ChainConfig> = {
  arbitrum: {
    chainId: 42161,
    rpc: 'https://arb1.arbitrum.io/rpc',
    usdtContract: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    explorer: 'https://arbiscan.io',
    indexerName: 'arbitrum',
    decimals: 6,
  },
  ethereum: {
    chainId: 1,
    rpc: 'https://ethereum-rpc.publicnode.com',
    usdtContract: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    explorer: 'https://etherscan.io',
    indexerName: 'ethereum',
    decimals: 6,
  },
  polygon: {
    chainId: 137,
    rpc: 'https://polygon-bor-rpc.publicnode.com',
    usdtContract: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    explorer: 'https://polygonscan.com',
    indexerName: 'polygon',
    decimals: 6,
  },
  avalanche: {
    chainId: 43114,
    rpc: 'https://api.avax.network/ext/bc/C/rpc',
    usdtContract: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
    explorer: 'https://snowtrace.io',
    indexerName: 'avalanche',
    decimals: 6,
  },
};

export function getChainConfig(chain: string): ChainConfig {
  const c = CHAINS[chain];
  if (!c) throw new Error(`Unknown chain: ${chain}`);
  return c;
}

