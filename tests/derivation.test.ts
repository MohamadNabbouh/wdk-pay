import { describe, it, expect } from 'vitest';
import { HDNodeWallet, Mnemonic } from 'ethers';
import { deriveAddress } from '../src/services/derivation.js';

// Well-known BIP-39 test mnemonic
const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

// Derive the xpub at m/44'/60'/0' (BIP-44 account level) using ethers as reference
const mnemonic = Mnemonic.fromPhrase(TEST_MNEMONIC);
const accountNode = HDNodeWallet.fromMnemonic(mnemonic, "m/44'/60'/0'");
const TEST_XPUB = accountNode.neuter().extendedKey;

// Reference addresses derived via ethers (ground truth)
function ethersAddress(index: number): string {
  return accountNode.derivePath(`0/${index}`).address;
}

describe('deriveAddress', () => {
  it('derives correct address at index 0', () => {
    const addr = deriveAddress(TEST_XPUB, 0);
    const expected = ethersAddress(0);
    expect(addr).toBe(expected);
  });

  it('derives correct addresses for indices 0-9', () => {
    for (let i = 0; i < 10; i++) {
      const addr = deriveAddress(TEST_XPUB, i);
      const expected = ethersAddress(i);
      expect(addr).toBe(expected);
    }
  });

  it('produces distinct addresses for different indices', () => {
    const addresses = new Set<string>();
    for (let i = 0; i < 20; i++) {
      addresses.add(deriveAddress(TEST_XPUB, i));
    }
    expect(addresses.size).toBe(20);
  });

  it('is deterministic', () => {
    const a1 = deriveAddress(TEST_XPUB, 42);
    const a2 = deriveAddress(TEST_XPUB, 42);
    expect(a1).toBe(a2);
  });

  it('returns checksummed addresses', () => {
    const addr = deriveAddress(TEST_XPUB, 0);
    expect(addr).toMatch(/^0x[0-9a-fA-F]{40}$/);
    // Checksummed = has mixed case
    expect(addr).not.toBe(addr.toLowerCase());
  });

  it('throws on invalid xpub', () => {
    expect(() => deriveAddress('xpub_invalid', 0)).toThrow();
  });
});
