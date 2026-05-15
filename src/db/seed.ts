import { sql } from './index.js';
import { generateId, sha256, randomBase58 } from '../lib/crypto.js';
import { HDNodeWallet, Mnemonic } from 'ethers';

const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

async function seed() {
  const existing = await sql`SELECT id FROM merchants LIMIT 1`;
  if (existing.length > 0) {
    console.log(`Merchant ${existing[0].id} already exists. Skipping seed.`);
    await sql.end();
    return;
  }

  const name = process.env.MERCHANT_NAME || 'Test Merchant';
  const xpub =
    process.env.MERCHANT_XPUB ||
    (() => {
      console.log(`No MERCHANT_XPUB set. Using test mnemonic.`);
      console.log(`Mnemonic: ${TEST_MNEMONIC}\n`);
      const mnemonic = Mnemonic.fromPhrase(TEST_MNEMONIC);
      return HDNodeWallet.fromMnemonic(mnemonic, "m/44'/60'/0'").neuter()
        .extendedKey;
    })();

  const apiKey = `wdk_live_${randomBase58(32)}`;
  const webhookSecret = `whsec_${randomBase58(32)}`;
  const id = generateId('merch');

  await sql`
    INSERT INTO merchants (id, name, xpub, webhook_secret, api_key_hash, confirmation_threshold)
    VALUES (${id}, ${name}, ${xpub}, ${webhookSecret}, ${sha256(apiKey)}, 5)
  `;

  console.log('Merchant created successfully!');
  console.log('─'.repeat(50));
  console.log(`  ID:             ${id}`);
  console.log(`  Name:           ${name}`);
  console.log(`  API Key:        ${apiKey}`);
  console.log(`  Webhook Secret: ${webhookSecret}`);
  console.log(`  xpub:           ${xpub.slice(0, 20)}...`);
  console.log('─'.repeat(50));
  console.log('\nSave these — they will not be shown again.\n');

  await sql.end();
}

seed();
