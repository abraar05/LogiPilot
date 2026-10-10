/**
 * services/orders.js — order lifecycle on the server (authority).
 * Every mutation writes an event, an audit record and an SSE broadcast.
 */
import { getDb } from '../db/index.js';
import { uid } from '../util/crypto.js';
import { validateTransition, nextStatuses, WorkflowError } from '../domain/order-machine.js';
import { assertCan, isElevated, ROLES } from '../domain/permissions.js';
import * as audit from './audit.js';
import * as events from './events.js';

const now = () => Date.now();

async function nextRef(orgId) {
  const db = getDb();
  const counters = await db.filter('counters');
  const row = counters.find((c) => c.name === `order:${orgId}`) || { id: `order:${orgId}`, name: `order:${orgId}`, value: 0 };
  const value = (row.value || 0) + 1;
  if (row.id) await db.update('counters', row.id, { value });
  else await db.insert('counters', row);
  return `SO-${String(value).padStart(4, '0')}`;
}

export async function list({ orgId = 'default', status, q, assignee } = {}) {
  const db = getDb();
  let rows = (await db.filter('orders')).filter((o) => o.orgId === orgId);
  if (status) rows = rows.filter((o) => o.status === status);
  if (assignee) rows = rows.filter((o) => o[assignee.field] === assignee.id);
  if (q) {
    const needle = String(q).toLowerCase();
    rows = rows.filter((o) => `${o.ref} ${o.customer?.name} ${o.customer?.phone} ${(o.items || []).map((i) => i.name).join(' ')}`.toLowerCase().includes(needle));
  }
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export const get = async (id, orgId = 'default') => {
  const o = await getDb().find('orders', id);
  return o && o.orgId === orgId ? o : null;
};

export async function create({ orgId = 'default', customer, items, notes = '', priority = 'normal', dueAt = null, codAmount = 0 }, actor) {
  assertCan(actor.role, 'orders:create');
  if (!customer?.name?.trim()) throw new WorkflowError('Customer name is required.', 'VALIDATION', 400);
  if (!Array.isArray(items) || !items.length) throw new WorkflowError('Add at least one item.', 'VALIDATION', 400);

  const db = getDb();
  const ref = await nextRef(orgId);
  const order = {
    id: uid('ord'),
    orgId,
    ref,
    barcode: `SO${ref.slice(3).padStart(6, '0')}`,
    customer: { name: customer.name.trim(), phone: customer.phone || '', address: customer.address || '' },
    items: items.map((i, idx) => ({
      id: `it${idx + 1}`,
      name: String(i.name).trim(),
      sku: i.sku || '',
      barcode: i.barcode || i.sku || '',
      qty: Math.max(1, Number(i.qty) || 1),
      packedQty: 0,
    })),
    status: 'new',
    priority,
    notes,
    cod: Number(codAmount) > 0 ? { amount: Number(codAmount) } : null,
    codCollected: false,
    packerId: null, qcId: null, driverId: null, deliveryId: null,
    history: [{ at: now(), by: actor.name, action: 'created', note: notes || '' }],
    createdAt: now(),
    updatedAt: now(),
    dueAt,
    version: 1,
  };
  await db.insert('orders', order);
  await audit.record({ orgId, actor: actor.name, action: 'order.create', target: ref, detail: `${customer.name} · ${items.length} line(s)` });
  events.publish(orgId, { type: 'order.created', order: slim(order) });
  return order;
}

const slim = (o) => ({
  id: o.id, ref: o.ref, status: o.status, customerName: o.customer?.name,
  packerId: o.packerId, qcId: o.qcId, deliveryId: o.deliveryId, driverId: o.driverId,
  version: o.version, updatedAt: o.updatedAt,
});

export async function update(id, patch, orgId = 'default', actor) {
  assertCan(actor.role, 'orders:edit');
  const db = getDb();
  const order = await get(id, orgId);
  if (!order) throw new WorkflowError('Order not found.', 'NOT_FOUND', 404);
  if (['packing', 'packed', 'qc_approved', 'out_for_delivery', 'delivered'].includes(order.status)) {
    throw new WorkflowError('This order is already in motion and can no longer be edited.', 'STATE');
  }
  const next = { updatedAt: now(), version: (order.version || 1) + 1 };
  if (patch.customer) next.customer = { ...order.customer, ...patch.customer };
  if (Array.isArray(patch.items)) {
    next.items = patch.items.filter((i) => String(i.name || '').trim()).map((i, idx) => ({
      id: `it${idx + 1}`, name: String(i.name).trim(), sku: i.sku || '', barcode: i.barcode || i.sku || '',
      qty: Math.max(1, Number(i.qty) || 1), packedQty: 0,
    }));
  }
  if (patch.priority) next.priority = patch.priority;
  if (patch.notes !== undefined) next.notes = patch.notes;
  if (patch.dueAt !== undefined) next.dueAt = patch.dueAt;
  if (patch.codAmount !== undefined) next.cod = Number(patch.codAmount) > 0 ? { amount: Number(patch.codAmount) } : null;

  next.history = [...order.history, { at: now(), by: actor.name, action: 'edited', note: 'Order details updated' }];
  const updated = await db.update('orders', id, next);
  await audit.record({ orgId, actor: actor.name, action: 'order.edit', target: order.ref, detail: Object.keys(patch).join(', ') });
  events.publish(orgId, { type: 'order.updated', order: slim(updated) });
  return updated;
}

export async function assign(id, field, userId, orgId = 'default', actor) {
  const db = getDb();
  const order = await get(id, orgId);
  if (!order) throw new WorkflowError('Order not found.', 'NOT_FOUND', 404);
  if (!isElevated(actor.role) && actor.id !== userId && !(await import('../domain/permissions.js')).can(actor.role, 'assign:packer')) {
    // self-assign allowed; everything else needs a supervisor
    if (field !== 'packerId' && field !== 'qcId' && field !== 'deliveryId') {
      throw new WorkflowError('Your role cannot assign staff.', 'FORBIDDEN', 403);
    }
  }
  const permMap = { packerId: 'assign:packer', qcId: 'assign:qc', driverId: 'assign:delivery', deliveryId: 'assign:delivery' };
  if (!isElevated(actor.role) && actor.id !== userId) assertCan(actor.role, permMap[field]);

  const user = await db.find('users', userId);
  if (!user || !user.active) throw new WorkflowError('That user is not available.', 'NOT_FOUND', 404);
  const roleForField = { packerId: 'packer', qcId: 'approver', driverId: 'driver', deliveryId: 'delivery' };
  if (user.role !== roleForField[field] && !isElevated(user.role)) {
    throw new WorkflowError(`${user.name} is a ${ROLES[user.role]?.label}, not a ${ROLES[roleForField[field]]?.label}.`, 'ROLE', 400);
  }

  const labels = { packerId: 'Packer', qcId: 'QC approver', driverId: 'Driver', deliveryId: 'Delivery staff' };
  let updated = await db.update('orders', id, {
    [field]: userId,
    updatedAt: now(),
    version: (order.version || 1) + 1,
    history: [...order.history, { at: now(), by: actor.name, action: 'assigned', note: `${labels[field]} → ${user.name}` }],
  });
  if (field === 'packerId' && order.status === 'new') updated = await transition(id, 'assigned', { orgId, actor });
  else {
    await audit.record({ orgId, actor: actor.name, action: 'order.assign', target: order.ref, detail: `${labels[field]} → ${user.name}` });
    events.publish(orgId, { type: 'order.updated', order: slim(updated) });
  }
  return updated;
}

export async function transition(id, to, { orgId = 'default', actor, proofId = null, note = '', expectedVersion = null } = {}) {
  const db = getDb();
  const order = await get(id, orgId);
  if (!order) throw new WorkflowError('Order not found.', 'NOT_FOUND', 404);
  if (expectedVersion && order.version && expectedVersion !== order.version) {
    throw new WorkflowError('This order changed while you were working on it. Reload and try again.', 'VERSION_CONFLICT', 409);
  }
  validateTransition(order, to, actor, { proofId, note });

  if (proofId) {
    const proof = await db.find('proofs', proofId);
    if (!proof || proof.orderId !== id) throw new WorkflowError('That proof does not belong to this order.', 'PROOF_MISMATCH', 400);
  }

  const updated = await db.update('orders', id, {
    status: to,
    updatedAt: now(),
    version: (order.version || 1) + 1,
    history: [...order.history, { at: now(), by: actor.name, action: to, note, proofId }],
  });

  const event = { id: uid('evt'), orgId, orderId: id, ref: order.ref, at: now(), action: to, actor: actor.name, note, proofId, version: updated.version };
  await db.insert('events', event);
  await audit.record({ orgId, actor: actor.name, action: `order.${to}`, target: order.ref, detail: note || `v${updated.version}` });
  events.publish(orgId, { type: 'order.transition', order: slim(updated), action: to, actor: actor.name, note });
  return updated;
}

export async function setPackedQty(id, itemId, qty, orgId = 'default', actor) {
  const db = getDb();
  const order = await get(id, orgId);
  if (!order) throw new WorkflowError('Order not found.', 'NOT_FOUND', 404);
  const items = order.items.map((i) => (i.id === itemId ? { ...i, packedQty: Math.max(0, Math.min(i.qty, Number(qty) || 0)) } : i));
  const updated = await db.update('orders', id, { items, updatedAt: now(), version: (order.version || 1) + 1 });
  events.publish(orgId, { type: 'order.updated', order: slim(updated) });
  return updated;
}

export async function collectCOD(id, amount, orgId = 'default', actor) {
  if (!isElevated(actor.role)) assertCan(actor.role, 'deliver:perform');
  const db = getDb();
  const order = await get(id, orgId);
  if (!order) throw new WorkflowError('Order not found.', 'NOT_FOUND', 404);
  const updated = await db.update('orders', id, {
    codCollected: true,
    updatedAt: now(),
    version: (order.version || 1) + 1,
    history: [...order.history, { at: now(), by: actor.name, action: 'cod_collected', note: String(amount) }],
  });
  await audit.record({ orgId, actor: actor.name, action: 'order.cod', target: order.ref, detail: String(amount) });
  events.publish(orgId, { type: 'order.updated', order: slim(updated) });
  return updated;
}

export async function history(id, orgId = 'default') {
  const db = getDb();
  const order = await get(id, orgId);
  if (!order) throw new WorkflowError('Order not found.', 'NOT_FOUND', 404);
  const evts = (await db.filter('events')).filter((e) => e.orderId === id).sort((a, b) => a.at - b.at);
  const proofs = (await db.filter('proofs')).filter((p) => p.orderId === id).sort((a, b) => b.at - a.at);
  return { order, events: evts, proofs: proofs.map(({ dataUrl, ...rest }) => rest) };
}

export const allowedNext = (order) => nextStatuses(order.status);