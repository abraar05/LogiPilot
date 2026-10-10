/**
 * services/audit.js — hash-chained, append-only audit trail.
 * Each record commits the hash of the previous one, so tampering with any
 * entry breaks the chain and is detectable by `verifyChain()`.
 */
import { getDb } from '../db/index.js';
import { sha256, uid } from '../util/crypto.js';

const canonical = (a) => JSON.stringify({
  id: a.id, at: a.at, orgId: a.orgId, actor: a.actor, action: a.action, target: a.target, detail: a.detail, prev: a.prev,
});

/** Append one immutable record; returns the stored entry. */
export async function record({ orgId = 'default', actor = 'system', action, target = '', detail = '', meta = {} }) {
  const db = getDb();
  const chain = await db.filter('audit', (a) => a.orgId === orgId);
  const prev = chain.length ? chain[chain.length - 1].hash : 'genesis';
  const at = Date.now();
  const entry = { id: uid('aud'), at, orgId, actor, action, target, detail, meta, prev };
  entry.hash = sha256(canonical(entry));
  await db.insert('audit', entry);
  return entry;
}

/** Recompute the chain; returns { ok, brokenAt }. */
export async function verifyChain(orgId = 'default') {
  const db = getDb();
  const chain = (await db.filter('audit', (a) => a.orgId === orgId)).sort((a, b) => a.at - b.at);
  let prev = 'genesis';
  for (const entry of chain) {
    if (entry.prev !== prev) return { ok: false, brokenAt: entry.id };
    if (sha256(canonical(entry)) !== entry.hash) return { ok: false, brokenAt: entry.id };
    prev = entry.hash;
  }
  return { ok: true, length: chain.length };
}

export async function query({ orgId = 'default', limit = 100, action, actor, q } = {}) {
  const db = getDb();
  let rows = (await db.filter('audit', (a) => a.orgId === orgId)).sort((a, b) => b.at - a.at);
  if (action) rows = rows.filter((r) => String(r.action).startsWith(action));
  if (actor) rows = rows.filter((r) => r.actor === actor);
  if (q) {
    const needle = String(q).toLowerCase();
    rows = rows.filter((r) => `${r.action} ${r.actor} ${r.target} ${r.detail}`.toLowerCase().includes(needle));
  }
  return rows.slice(0, Math.min(limit, 1000));
}