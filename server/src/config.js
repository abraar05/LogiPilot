/**
 * config.js — server configuration from environment.
 */
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

const env = process.env;

export const config = {
  port: Number(env.PORT || 8787),
  host: env.HOST || '0.0.0.0',

  /** Required in production: 32+ random bytes. */
  secret: env.LP_SECRET || randomBytes(32).toString('hex'),

  /** 'pg' | 'file' — pg is used automatically when DATABASE_URL is set. */
  db: env.DATABASE_URL ? 'pg' : (env.LP_DB || 'file'),
  databaseUrl: env.DATABASE_URL || '',
  fileDbPath: resolve(env.LP_DATA_DIR || './data', 'logipilot.json'),

  sessionTtlMs: Number(env.LP_SESSION_TTL_H || 12) * 3600e3,
  rememberTtlMs: Number(env.LP_REMEMBER_TTL_D || 30) * 86400e3,
  passwordIterations: Number(env.LP_PBKDF2 || 120000),
  maxFailedAttempts: Number(env.LP_MAX_ATTEMPTS || 5),
  lockoutMs: Number(env.LP_LOCKOUT_SEC || 60) * 1000,

  corsOrigins: (env.LP_CORS || '*').split(',').map((s) => s.trim()),

  proofsDir: resolve(env.LP_PROOFS_DIR || './data/proofs'),
  maxUploadBytes: Number(env.LP_MAX_UPLOAD_MB || 12) * 1024 * 1024,

  isProd: env.NODE_ENV === 'production',
};

if (config.isProd && !env.LP_SECRET) {
  console.warn('[config] LP_SECRET is not set — a random one was generated. Sessions will not survive restarts.');
}