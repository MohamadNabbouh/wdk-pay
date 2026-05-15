import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { mainnet, arbitrum } from 'wagmi/chains';

export const wagmiConfig = getDefaultConfig({
  appName: 'WDK Pay',
  projectId: 'e3547a15e6769ceabd64a074e5b6c9f0',
  chains: [mainnet, arbitrum],
});
