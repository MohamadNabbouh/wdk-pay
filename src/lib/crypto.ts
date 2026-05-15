import { randomBytes, createHash } from 'node:crypto';

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function randomBase58(length = 24): string {
  const bytes = randomBytes(length);
  let result = '';
  for (const byte of bytes) {
    result += BASE58[byte % 58];
  }
  return result;
}

export function generateId(prefix: string, length = 24): string {
  return `${prefix}_${randomBase58(length)}`;
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
