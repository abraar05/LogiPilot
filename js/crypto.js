/**
 * crypto.js — password hashing, tokens and PIN derivation.
 *
 * Uses WebCrypto (PBKDF2-SHA256) where available and falls back to a clearly
 * labelled deterministic hash on insecure contexts so the app still runs from
 * `file://` or plain HTTP. Password material never leaves the device unless the
 * Apps Script bridge is configured, in which case verification happens server
 * side and this module is bypassed for sign-in.
 */
window.SP = window.SP || {};

SP.crypto = (() => {
  const enc = new TextEncoder();
  let subtle = null;
  let secure = false;

  try {
    subtle = (globalThis.crypto && globalThis.crypto.subtle) || null;
    secure = !!(globalThis.crypto && globalThis.crypto.getRandomValues);
  } catch { subtle = null; }

  const toB64 = (bytes) => {
    let s = '';
    const arr = new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i += 1) s += String.fromCharCode(arr[i]);
    return btoa(s);
  };
  const fromB64 = (str) => {
    const s = atob(str);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
    return out;
  };

  /** Deterministic fallback digest — FNV-1a based, not cryptographic. */
  function weakHash(str) {
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < str.length; i += 1) {
      const c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
    }
    return `w$${h1.toString(36)}.${h2.toString(36)}.${str.length.toString(36)}`;
  }

  /**
   * Derive a verifier for `password`.
   * @returns {Promise<{algo:string,salt:string,hash:string,iters:number}>}
   */
  async function hashPassword(password, saltB64) {
    const salt = saltB64 ? fromB64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
    const iters = 120000;

    if (subtle) {
      try {
        const key = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
        const bits = await subtle.deriveBits(
          { name: 'PBKDF2', salt, iterations: iters, hash: 'SHA-256' }, key, 256,
        );
        return { algo: 'pbkdf2-sha256', salt: toB64(salt), hash: toB64(new Uint8Array(bits)), iters };
      } catch { /* fall through */ }
    }
    return { algo: 'fnv1a-weak', salt: toB64(salt), hash: weakHash(`${toB64(salt)}::${password}`), iters: 0 };
  }

  /** Constant-time-ish comparison for verifiers. */
  function verifyRecord(record, password) {
    if (!record) return Promise.resolve(false);
    if (record.algo === 'fnv1a-weak') {
      return Promise.resolve(weakHash(`${record.salt}::${password}`) === record.hash);
    }
    return hashPassword(password, record.salt)
      .then((r) => r.hash === record.hash && r.algo === record.algo);
  }

  /** Opaque random session token. */
  function randomToken(bytes = 24) {
    const buf = crypto.getRandomValues(new Uint8Array(bytes));
    return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  /** Derive the verifier used for a 4-digit quick PIN. */
  const hashPin = (pin, saltB64) => hashPassword(`pin:${pin}`, saltB64);

  /** Password strength 0–4 with a human label. */
  function strength(password) {
    const p = String(password || '');
    if (!p) return { score: 0, label: 'Empty' };
    let score = 0;
    if (p.length >= 8) score += 1;
    if (p.length >= 12) score += 1;
    if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score += 1;
    if (/\d/.test(p)) score += 1;
    if (/[^A-Za-z0-9]/.test(p)) score += 1;
    if (/^(.)\1+$/.test(p) || /^(123|1234|12345|0000|password|qwerty|admin)/i.test(p)) {
      return { score: 0, label: 'Too predictable' };
    }
    score = Math.min(4, score);
    return { score, label: ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'][score] };
  }

  return {
    secure,
    isPBKDF2: () => !!subtle,
    hashPassword,
    hashPin,
    verifyRecord,
    randomToken,
    strength,
    weakHash,
  };
})();