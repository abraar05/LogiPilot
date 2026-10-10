/**
 * util/crypto.js — password hashing, tokens, HMAC, TOTP, idempotency keys.
 * Server-side primitives only; nothing here is shipped to the browser.
 */
import {
  pbkdf2Sync, randomBytes, createHmac, timingSafeEqual, createHash,
} from 'node:crypto';

const enc = (buf) => buf.toString('base64url');

/* ─────────────────────────────────────────────────────── passwords */

export function hashPassword(password, iterations = 120000) {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(String(password), salt, iterations, 32, 'sha256');
  return { algo: 'pbkdf2-sha256', iterations, salt: enc(salt), hash: enc(hash), at: Date.now() };
}

export function verifyPassword(record, password) {
  if (!record || record.algo !== 'pbkdf2-sha256') return false;
  const salt = Buffer.from(record.salt, 'base64url');
  const expected = Buffer.from(record.hash, 'base64url');
  const actual = pbkdf2Sync(String(password ?? ''), salt, record.iterations, expected.length, 'sha256');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/* ────────────────────────────────────────────────────────── tokens */

export const randomToken = (bytes = 32) => enc(randomBytes(bytes));
export const uid = (prefix = 'id') => `${prefix}_${Date.now().toString(36)}${randomBytes(4).toString('base64url')}`;
export const idempotencyKey = () => randomToken(16);

export const hmac = (secret, data) => createHmac('sha256', secret).update(String(data)).digest('base64url');
export const sha256 = (data) => createHash('sha256').update(String(data)).digest('hex');

/** Constant-time string compare that tolerates length mismatch. */
export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

/* ──────────────────────────────────────────────────────────── TOTP */

/** RFC 4648 base32 encode/decode for authenticator apps. */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0; let value = 0; let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  let bits = 0; let value = 0; const out = [];
  for (const ch of String(str).toUpperCase().replace(/=+$/, '')) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const totp = {
  url(secret, account, issuer = 'LogiPilot') {
    const label = encodeURIComponent(`${issuer}:${account}`);
    const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
    return `otpauth://totp/${label}?${params}`;
  },
  generate(secret, at = Date.now(), step = 30, digits = 6) {
    const counter = Math.floor(at / 1000 / step);
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(counter));
    const hmacBuf = createHmac('sha1', base32Decode(secret)).update(buf).digest();
    const offset = hmacBuf[hmacBuf.length - 1] & 0x0f;
    const code = ((hmacBuf[offset] & 0x7f) << 24 | (hmacBuf[offset + 1] & 0xff) << 16
      | (hmacBuf[offset + 2] & 0xff) << 8 | (hmacBuf[offset + 3] & 0xff)) % (10 ** digits);
    return String(code).padStart(digits, '0');
  },
  verify(secret, token, window = 1, at = Date.now()) {
    for (let i = -window; i <= window; i += 1) {
      if (safeEqual(this.generate(secret, at + i * 30000), String(token || '').trim())) return true;
    }
    return false;
  },
};