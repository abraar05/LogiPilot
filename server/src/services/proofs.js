/**
 * services/proofs.js — immutable photo proofs.
 * Images are stored on disk (or referenced by key in object storage) and the
 * metadata row is append-only: updates/deletes are rejected by design.
 */
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '../db/index.js';
import { config } from '../config.js';
import { uid, sha256 } from '../util/crypto.js';
import * as audit from './audit.js';
import * as events from './events.js';

const now = () => Date.now();
const immutableError = () => Object.assign(new Error('Photo proofs are immutable and cannot be edited or deleted.'), { status: 405, code: 'IMMUTABLE' });

export async function create({ orgId = 'default', orderId, stage, dataUrl, gps = null, device = 'unknown', note = '' }, actor) {
  const db = getDb();
  const order = await db.find('orders', orderId);
  if (!order || order.orgId !== orgId) throw Object.assign(new Error('Order not found.'), { status: 404, code: 'NOT_FOUND' });

  const match = /^data:(image\/(jpeg|png|webp));base64,(.+)$/.exec(String(dataUrl || ''));
  if (!match) throw Object.assign(new Error('Proof must be a base64 image (jpeg, png or webp).'), { status: 400, code: 'VALIDATION' });
  const [, mime, b64] = match;
  const buffer = Buffer.from(b64, 'base64');
  if (buffer.length > config.maxUploadBytes) {
    throw Object.assign(new Error(`Proof exceeds ${Math.round(config.maxUploadBytes / 1048576)}MB.`), { status: 413, code: 'TOO_LARGE' });
  }

  mkdirSync(config.proofsDir, { recursive: true });
  const id = uid('prf');
  const fileName = `${id}.${mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'}`;
  writeFileSync(join(config.proofsDir, fileName), buffer);

  const proof = {
    id,
    orgId,
    orderId,
    orderRef: order.ref,
    ref: `PRF-${String((await db.filter('proofs')).filter((p) => p.orgId === orgId).length + 1).padStart(4, '0')}`,
    stage,
    fileName,
    mime,
    bytes: buffer.length,
    sha256: sha256(buffer),
    byId: actor.id,
    byName: actor.name,
    role: actor.role,
    at: now(),
    gps,           // null when the device did not grant location — never faked
    device,
    note,
    immutable: true,
  };
  await db.insert('proofs', proof);
  await audit.record({ orgId, actor: actor.name, action: 'proof.submit', target: proof.ref, detail: `${order.ref} · ${stage} · ${gps ? 'GPS' : 'no GPS'}` });
  events.publish(orgId, { type: 'proof.created', orderId, proofId: id, stage });
  return proof;
}

export async function list({ orgId = 'default', orderId, stage, limit = 200 } = {}) {
  const db = getDb();
  let rows = (await db.filter('proofs')).filter((p) => p.orgId === orgId);
  if (orderId) rows = rows.filter((p) => p.orderId === orderId);
  if (stage) rows = rows.filter((p) => p.stage === stage);
  return rows.sort((a, b) => b.at - a.at).slice(0, limit);
}

export async function readImage(id) {
  const proof = await getDb().find('proofs', id);
  if (!proof) return null;
  const path = join(config.proofsDir, proof.fileName);
  if (!existsSync(path)) return null;
  return { buffer: readFileSync(path), mime: proof.mime };
}

export const update = () => { throw immutableError(); };
export const remove = () => { throw immutableError(); };

/** Storage hygiene: drop proofs older than N days (audited, order keeps its history). */
export async function purgeOlderThan(days, orgId = 'default', actor = { name: 'system' }) {
  const cutoff = now() - days * 864e5;
  const db = getDb();
  const stale = (await db.filter('proofs')).filter((p) => p.orgId === orgId && p.at < cutoff);
  for (const p of stale) await db.remove('proofs', (x) => x.id === p.id);
  await audit.record({ orgId, actor: actor.name, action: 'proof.purge', target: `${stale.length} proofs`, detail: `older than ${days} days` });
  return { purged: stale.length };
}