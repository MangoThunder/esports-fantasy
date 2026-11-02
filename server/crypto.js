// Node crypto helpers. The GitHub Pages build swaps this for web/crypto.js.
import crypto from 'node:crypto';

export const randomHex = (bytes) => crypto.randomBytes(bytes).toString('hex');

export function hashPassword(pw) {
  const salt = randomHex(16);
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}

export function checkPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(pw, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}
