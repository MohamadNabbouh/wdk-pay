/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: [
      '@tetherto/wdk-wallet-evm',
      '@tetherto/wdk-wallet',
      'sodium-universal',
      'sodium-native',
      'bare-node-runtime',
      'require-addon',
    ],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({
        '@tetherto/wdk-wallet-evm': 'commonjs @tetherto/wdk-wallet-evm',
        '@tetherto/wdk-wallet': 'commonjs @tetherto/wdk-wallet',
        'sodium-universal': 'commonjs sodium-universal',
        'sodium-native': 'commonjs sodium-native',
        'bare-node-runtime': 'commonjs bare-node-runtime',
      });
    }
    return config;
  },
};

module.exports = nextConfig;
