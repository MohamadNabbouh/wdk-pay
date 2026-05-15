import { HDKey } from '@scure/bip32';
import { computeAddress } from 'ethers';

/**
 * Derive an Ethereum address from an xpub at a given BIP-44 index.
 *
 * The xpub must be at the BIP-44 account level: m/44'/60'/0'
 * We derive the remaining path: m/0/{idx} (external chain, address index)
 */
export function deriveAddress(xpub: string, idx: number): string {
  const root = HDKey.fromExtendedKey(xpub);
  const child = root.deriveChild(0).deriveChild(idx);
  if (!child.publicKey) throw new Error('derivation failed: no public key');
  const hexPubKey = '0x' + Buffer.from(child.publicKey).toString('hex');
  return computeAddress(hexPubKey);
}
