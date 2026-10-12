import crypto from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(plain, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(plain, stored) {
  try {
    const [algo, saltB64, keyB64] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const expected = Buffer.from(keyB64, 'base64');
    const actual = crypto.scryptSync(plain, Buffer.from(saltB64, 'base64'), expected.length, SCRYPT);
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export const newToken = () => crypto.randomBytes(32).toString('hex');

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
