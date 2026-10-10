/**
 * db/index.js — storage adapter selection.
 *
 * `file` adapter: durable JSON document on disk (dev, small deployments, CI).
 * `pg` adapter:   Postgres via the optional `pg` driver (production).
 * Both expose the same collections API used by every service.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config.js';

const COLLECTIONS = [
  'orgs', 'users', 'sessions', 'orders', 'proofs', 'approvals',
  'events', 'audit', 'notifications', 'idempotency', 'counters',
];

/* ═══════════════════════════════════════════════════════════ file */

function fileAdapter() {
  const path = config.fileDbPath;
  let data = load();

  function load() {
    if (existsSync(path)) {
      try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
    }
    return null;
  }
  function blank() {
    const d = { meta: { schema: 1, createdAt: Date.now() } };
    for (const c of COLLECTIONS) d[c] = [];
    return d;
  }
  function persist() {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(data), 'utf8');
    renameSync(tmp, path);   // atomic swap — never a half-written file
  }
  data = load() || blank();

  return {
    kind: 'file',
    path,
    collections: Object.fromEntries(COLLECTIONS.map((c) => [c, () => data[c]])),
    insert(collection, doc) { data[collection].push(doc); persist(); return doc; },
    find(collection, predicate) {
      if (typeof predicate === 'function') return data[collection].find(predicate) || null;
      return data[collection].find((d) => d.id === predicate) || null;
    },
    filter(collection, predicate) {
      if (typeof predicate === 'function') return data[collection].filter(predicate);
      if (predicate === undefined || predicate === null) return [...data[collection]];
      return data[collection].filter((d) => d.id === predicate);
    },
    update(collection, predicate, patch) {
      const doc = data[collection].find((d) => (typeof predicate === 'function' ? predicate(d) : d.id === predicate));
      if (!doc) return null;
      Object.assign(doc, typeof patch === 'function' ? patch(doc) : patch);
      persist();
      return doc;
    },
    remove(collection, predicate) {
      const before = data[collection].length;
      data[collection] = data[collection].filter((d) => !(typeof predicate === 'function' ? predicate(d) : d.id === predicate));
      if (data[collection].length !== before) persist();
      return before - data[collection].length;
    },
    transaction(fn) { return fn(this); },
    raw() { return data; },
    close() { persist(); },
  };
}

/* ═════════════════════════════════════════════════════════════ pg */

/**
 * Postgres adapter. The `pg` module is imported dynamically so the server
 * still boots (with the file adapter) when it is not installed.
 */
async function pgAdapter() {
  let pg;
  try { pg = (await import('pg')).default; } catch { return null; }
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10, ssl: config.isProd ? { rejectUnauthorized: false } : undefined });
  try { await pool.query('select 1'); } catch (e) {
    console.error('[db] Postgres unreachable:', e.message);
    return null;
  }

  const TABLES = {
    orgs: 'orgs', users: 'users', sessions: 'sessions', orders: 'orders', proofs: 'proofs',
    approvals: 'approvals', events: 'events', audit: 'audit', notifications: 'notifications',
    idempotency: 'idempotency', counters: 'counters',
  };
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orgs (id text PRIMARY KEY, name text, data jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now());
    CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, org_id text, email text UNIQUE, data jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now());
    CREATE TABLE IF NOT EXISTS sessions (id text PRIMARY KEY, user_id text, expires_at timestamptz, data jsonb NOT NULL DEFAULT '{}'::jsonb);
    CREATE TABLE IF NOT EXISTS orders (id text PRIMARY KEY, org_id text, ref text, status text, updated_at timestamptz, data jsonb NOT NULL DEFAULT '{}'::jsonb);
    CREATE INDEX IF NOT EXISTS orders_org_status ON orders(org_id, status);
    CREATE TABLE IF NOT EXISTS proofs (id text PRIMARY KEY, org_id text, order_id text, created_at timestamptz, data jsonb NOT NULL DEFAULT '{}'::jsonb);
    CREATE TABLE IF NOT EXISTS events (id text PRIMARY KEY, org_id text, order_id text, at timestamptz, data jsonb NOT NULL DEFAULT '{}'::jsonb);
    CREATE TABLE IF NOT EXISTS audit (id text PRIMARY KEY, org_id text, at timestamptz, data jsonb NOT NULL DEFAULT '{}'::jsonb);
    CREATE TABLE IF NOT EXISTS notifications (id text PRIMARY KEY, org_id text, user_id text, read boolean DEFAULT false, data jsonb NOT NULL DEFAULT '{}'::jsonb);
    CREATE TABLE IF NOT EXISTS idempotency (key text PRIMARY KEY, response jsonb, created_at timestamptz DEFAULT now());
    CREATE TABLE IF NOT EXISTS counters (name text PRIMARY KEY, value int NOT NULL DEFAULT 0);
  `);

  return {
    kind: 'pg',
    insert: async (c, doc) => { await pool.query(`INSERT INTO ${TABLES[c]} (id, data) VALUES ($1, $2::jsonb)`, [doc.id, JSON.stringify(doc)]); return doc; },
    find: async (c, idOrPredicate) => {
      const id = typeof idOrPredicate === 'function' ? null : idOrPredicate;
      const { rows } = await pool.query(`SELECT data FROM ${TABLES[c]} WHERE id = $1`, [id]);
      return rows[0]?.data || null;
    },
    filter: async (c) => { const { rows } = await pool.query(`SELECT data FROM ${TABLES[c]}`); return rows.map((r) => r.data); },
    update: async (c, id, patch) => {
      const { rows } = await pool.query(`UPDATE ${TABLES[c]} SET data = data || $2::jsonb WHERE id = $1 RETURNING data`, [id, JSON.stringify(patch)]);
      return rows[0]?.data || null;
    },
    remove: async (c, id) => { await pool.query(`DELETE FROM ${TABLES[c]} WHERE id = $1`, [id]); },
    transaction: async (fn) => fn({ /* pg adapter is single-connection safe via pool */ }),
    pool,
    async close() { await pool.end(); },
  };
}

/* ═══════════════════════════════════════════════════════════ open */

let adapter = null;

export async function openDb() {
  if (adapter) return adapter;
  if (config.db === 'pg') {
    adapter = await pgAdapter();
    if (!adapter) {
      console.warn('[db] falling back to the file adapter (Postgres unavailable)');
    }
  }
  if (!adapter) adapter = fileAdapter();
  console.log(`[db] adapter: ${adapter.kind}${adapter.kind === 'file' ? ` (${adapter.path})` : ''}`);
  return adapter;
}

export const getDb = () => {
  if (!adapter) throw new Error('Database not opened');
  return adapter;
};

export { COLLECTIONS };