/**
 * services/auth.js — users, sessions, passwords, TOTP, lockout.
 */
import { getDb } from '../db/index.js';
import { config } from '../config.js';
import { hashPassword, verifyPassword, randomToken, uid, totp, base32Encode, safeEqual, hmac } from '../util/crypto.js';
import { randomBytes } from 'node:crypto';
import * as audit from './audit.js';
import { ROLES, assertCan } from '../domain/permissions.js';

const now = () => Date.now();
const asError = (message, code = 'AUTH', status = 401) => Object.assign(new Error(message), { code, status });

/* ─────────────────────────────────────────────────────────── users */

export async function createUser({ orgId = 'default', name, email, password, role = 'packer', phone = '', totpSecret }) {
  const db = getDb();
  const mail = String(email || '').trim().toLowerCase();
  if (!mail || !/.+@.+\..+/.test(mail)) throw asError('A valid email is required.', 'VALIDATION', 400);
  if (!name || !String(name).trim()) throw asError('Name is required.', 'VALIDATION', 400);
  if (!ROLES[role]) throw asError(`Unknown role "${role}".`, 'VALIDATION', 400);
  if (!password || String(password).length < 8) throw asError('Password must be at least 8 characters.', 'VALIDATION', 400);
  const existing = (await db.filter('users')).find((u) => u.email === mail);
  if (existing) throw asError('A user with that email already exists.', 'DUPLICATE', 409);

  const user = {
    id: uid('usr'),
    orgId,
    name: String(name).trim(),
    email: mail,
    phone,
    role,
    password: hashPassword(password, config.passwordIterations),
    totpSecret: totpSecret || null,
    totpEnabled: !!totpSecret,
    active: true,
    failedCount: 0,
    lockedUntil: 0,
    createdAt: now(),
    lastLoginAt: null,
  };
  await db.insert('users', user);
  await audit.record({ orgId, actor: user.email, action: 'user.create', target: mail, detail: `role=${role}` });
  return publicUser(user);
}

const publicUser = (u) => ({
  id: u.id, orgId: u.orgId, name: u.name, email: u.email, phone: u.phone, role: u.role,
  active: u.active, totpEnabled: !!u.totpEnabled, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt,
});

export const listUsers = async (orgId = 'default') =>
  (await getDb().filter('users')).filter((u) => u.orgId === orgId).map(publicUser);

export async function getUser(id) {
  const u = await getDb().find('users', id);
  return u || null;
}

export async function updateUser(id, patch, actorEmail = 'system') {
  const db = getDb();
  const user = await db.find('users', id);
  if (!user) throw asError('User not found.', 'NOT_FOUND', 404);
  const next = {};
  if (patch.name !== undefined) next.name = String(patch.name);
  if (patch.phone !== undefined) next.phone = patch.phone;
  if (patch.role !== undefined) {
    if (!ROLES[patch.role]) throw asError('Unknown role.', 'VALIDATION', 400);
    next.role = patch.role;
  }
  if (patch.active !== undefined) next.active = !!patch.active;
  if (patch.password) next.password = hashPassword(patch.password, config.passwordIterations);
  const updated = await db.update('users', id, next);
  await audit.record({ orgId: user.orgId, actor: actorEmail, action: 'user.update', target: user.email, detail: Object.keys(next).join(', ') });
  return publicUser(updated);
}

/* ──────────────────────────────────────────────────────────── TOTP */

export async function enableTotp(userId) {
  const db = getDb();
  const secret = base32Encode(randomBytes(20));
  await db.update('users', userId, { totpSecret: secret, totpEnabled: false });
  return { secret, url: totp.url(secret, (await db.find('users', userId)).email) };
}

export async function confirmTotp(userId, code) {
  const db = getDb();
  const user = await db.find('users', userId);
  if (!user?.totpSecret) throw asError('No TOTP secret set.', 'NOT_FOUND', 404);
  if (!totp.verify(user.totpSecret, code)) throw asError('That code is not valid.', 'TOTP_INVALID', 400);
  await db.update('users', userId, { totpEnabled: true });
  await audit.record({ orgId: user.orgId, actor: user.email, action: 'user.totp_enable', target: user.email });
  return { ok: true };
}

/* ──────────────────────────────────────────────────────── sessions */

export async function signIn({ email, password, totpCode, remember = false, device = 'unknown' }) {
  const db = getDb();
  const mail = String(email || '').trim().toLowerCase();
  const user = (await db.filter('users')).find((u) => u.email === mail);

  if (!user) {
    // Spend comparable time so timing does not reveal account existence.
    hashPassword(String(password || ''), config.passwordIterations);
    throw asError('Email or password is incorrect.', 'INVALID_CREDENTIALS');
  }
  if (!user.active) throw asError('This account has been deactivated.', 'ACCOUNT_DISABLED', 403);
  if (user.lockedUntil > now()) {
    throw asError(`Account locked. Try again in ${Math.ceil((user.lockedUntil - now()) / 1000)}s.`, 'LOCKED', 423);
  }
  if (!verifyPassword(user.password, password)) {
    const failed = (user.failedCount || 0) + 1;
    const patch = { failedCount: failed };
    if (failed >= config.maxFailedAttempts) {
      patch.lockedUntil = now() + config.lockoutMs;
      patch.failedCount = 0;
      await audit.record({ orgId: user.orgId, actor: mail, action: 'auth.lockout', target: mail, detail: `${config.maxFailedAttempts} failed attempts` });
    }
    await db.update('users', user.id, patch);
    throw asError('Email or password is incorrect.', 'INVALID_CREDENTIALS');
  }
  if (user.totpEnabled) {
    if (!totpCode || !totp.verify(user.totpSecret, totpCode)) {
      throw asError('A valid authenticator code is required.', 'TOTP_REQUIRED', 401);
    }
  }

  const token = randomToken(32);
  const ttl = remember ? config.rememberTtlMs : config.sessionTtlMs;
  const session = {
    id: uid('ses'),
    userId: user.id,
    orgId: user.orgId,
    tokenHash: hmac(config.secret, token),
    createdAt: now(),
    expiresAt: now() + ttl,
    device,
    remember: !!remember,
  };
  await db.insert('sessions', session);
  await db.update('users', user.id, { failedCount: 0, lockedUntil: 0, lastLoginAt: now() });
  await audit.record({ orgId: user.orgId, actor: user.email, action: 'auth.signin', target: user.email, detail: device });

  return { token, expiresAt: session.expiresAt, user: publicUser(user) };
}

export async function resolveSession(token) {
  if (!token) return null;
  const db = getDb();
  const hash = hmac(config.secret, token);
  const session = (await db.filter('sessions')).find((s) => safeEqual(s.tokenHash, hash));
  if (!session || session.expiresAt < now()) return null;
  const user = await db.find('users', session.userId);
  if (!user || !user.active) return null;
  return { session, user };
}

export async function signOut(token) {
  const db = getDb();
  const hash = hmac(config.secret, token);
  const session = (await db.filter('sessions')).find((s) => safeEqual(s.tokenHash, hash));
  if (session) {
    await db.remove('sessions', (s) => s.id === session.id);
    const user = await db.find('users', session.userId);
    await audit.record({ orgId: session.orgId, actor: user?.email || 'unknown', action: 'auth.signout', target: session.device });
  }
  return { ok: true };
}

export async function revokeAll(userId) {
  const db = getDb();
  const sessions = await db.filter('sessions');
  let n = 0;
  for (const s of sessions.filter((x) => x.userId === userId)) {
    await db.remove('sessions', (x) => x.id === s.id);
    n += 1;
  }
  return { revoked: n };
}

/** Password reset request — a token is returned for the email transport. */
export async function requestPasswordReset(email) {
  const db = getDb();
  const user = (await db.filter('users')).find((u) => u.email === String(email).toLowerCase());
  if (!user) return { ok: true }; // do not leak account existence
  const token = randomToken(24);
  await db.update('users', user.id, { resetTokenHash: hmac(config.secret, token), resetExpiresAt: now() + 900e3 });
  await audit.record({ orgId: user.orgId, actor: user.email, action: 'auth.reset_requested', target: user.email });
  return { ok: true, token }; // the mailer replaces this in production
}

export async function completePasswordReset(token, newPassword) {
  const db = getDb();
  const hash = hmac(config.secret, token);
  const user = (await db.filter('users')).find((u) => safeEqual(u.resetTokenHash || '', hash));
  if (!user || (user.resetExpiresAt || 0) < now()) throw asError('This reset link is invalid or expired.', 'RESET_INVALID', 400);
  await db.update('users', user.id, {
    password: hashPassword(newPassword, config.passwordIterations),
    resetTokenHash: null, resetExpiresAt: 0, failedCount: 0, lockedUntil: 0,
  });
  await revokeAll(user.id);
  await audit.record({ orgId: user.orgId, actor: user.email, action: 'auth.reset_completed', target: user.email });
  return { ok: true };
}

export async function changePassword(userId, currentPassword, newPassword) {
  const db = getDb();
  const user = await db.find('users', userId);
  if (!user) throw asError('User not found.', 'NOT_FOUND', 404);
  if (!verifyPassword(user.password, currentPassword)) throw asError('Current password is incorrect.');
  if (!newPassword || String(newPassword).length < 8) throw asError('Password must be at least 8 characters.', 'VALIDATION', 400);
  await db.update('users', userId, { password: hashPassword(newPassword, config.passwordIterations) });
  await audit.record({ orgId: user.orgId, actor: user.email, action: 'auth.password_changed', target: user.email });
  return { ok: true };
}

export { assertCan };