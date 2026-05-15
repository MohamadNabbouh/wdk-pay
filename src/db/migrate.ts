import { readFileSync } from 'node:fs';
import { sql } from './index.js';

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf-8');

console.log('Running migration...');
await sql.unsafe(schema);
console.log('Migration complete.');
await sql.end();
