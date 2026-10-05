/**
 * orders.js — the sales-order workflow engine.
 *
 * NEW → ASSIGNED → PACKING → PACKED → QC_APPROVED → OUT_FOR_DELIVERY
 *     → DELIVERED  (with QC_REJECTED / FAILED / RETURNED branches)
 *
 * All transitions go through `transition()` which validates the state
 * machine, enforces assignment + proof requirements, records history and
 * audit, and notifies the next responsible party.
 */
window.SP = window.SP || {};

SP.orders = (() => {
  const st = () => SP.store.state;

  class WorkflowError extends Error {
    constructor(message, code) { super(message); this.code = code || 'WF'; }
  }

  const byId = (id) => st().orders.find((o) => o.id === id);
  const byRef = (ref) => st().orders.find((o) => o.ref.toLowerCase() === String(ref || '').toLowerCase());

  /* ─────────────────────────────────────────────────────── creation */

  function createOrder({ customer, items, notes = '', priority = 'normal', dueAt = null }) {
    if (!SP.auth.can('orders:create')) throw new WorkflowError('Your role cannot create orders.', 'PERM');
    if (!customer?.name?.trim()) throw new WorkflowError('Customer name is required.', 'VALIDATION');
    if (!items?.length) throw new WorkflowError('Add at least one item.', 'VALIDATION');

    const order = {
      id: SP.uid('ord'),
      ref: SP.store.nextRef('order'),
      barcode: SP.store.state.counters.order ? `SO${String(SP.store.state.counters.order).padStart(6, '0')}` : SP.uid('bc'),
      customer: { name: customer.name.trim(), phone: customer.phone || '', address: customer.address || '' },
      items: items.map((i, idx) => ({
        id: `it${idx + 1}`,
        name: String(i.name).trim(),
        sku: i.sku || '',
        barcode: i.barcode || '',
        qty: Math.max(1, Number(i.qty) || 1),
        packedQty: 0,
      })),
      status: 'new',
      priority,
      packerId: null, qcId: null, driverId: null, deliveryId: null,
      notes,
      history: [{ at: Date.now(), by: SP.auth.current()?.name || 'system', action: 'created', note: notes || '' }],
      createdAt: Date.now(), updatedAt: Date.now(),
      dueAt,
    };
    SP.store.update(['orders'], (s) => { s.orders.unshift(order); });
    SP.store.audit('order.create', order.ref, `${order.customer.name} · ${SP.sum(order.items, (i) => i.qty)} units`);
    return order;
  }

  /* ─────────────────────────────────────────────────── assignments */

  function assign(orderId, role, userId, by) {
    const order = byId(orderId);
    if (!order) throw new WorkflowError('Order not found.', 'NOT_FOUND');
    const permMap = { packerId: 'assign:packer', qcId: 'assign:qc', driverId: 'assign:delivery', deliveryId: 'assign:delivery' };
    const self = SP.auth.current();
    const isSelf = userId === self?.id;
    if (!isSelf && !SP.auth.can(permMap[role])) throw new WorkflowError('Your role cannot assign staff.', 'PERM');
    if (isSelf && !SP.store.state.settings.allowSelfAssign && !SP.auth.can(permMap[role])) {
      throw new WorkflowError('Self-assignment is disabled by the administrator.', 'PERM');
    }
    const user = SP.auth.byId(userId);
    if (!user || !user.active) throw new WorkflowError('That user is not available.', 'NOT_FOUND');

    const roleForField = { packerId: 'packer', qcId: 'approver', driverId: 'driver', deliveryId: 'delivery' };
    if (user.role !== roleForField[role] && !['admin', 'supervisor'].includes(user.role)) {
      throw new WorkflowError(`${user.name} is a ${SP.auth.roleDef(user.role).label}, not a ${SP.auth.roleDef(roleForField[role]).label}.`, 'ROLE');
    }

    SP.store.update(['orders'], (s) => {
      const t = s.orders.find((x) => x.id === orderId);
      t[role] = userId;
      t.updatedAt = Date.now();
      t.history.push({ at: Date.now(), by: by || self?.name || 'system', action: 'assigned', note: `${fieldLabel(role)} → ${user.name}` });
    });

    // Auto-advance NEW → ASSIGNED when a packer is set.
    if (role === 'packerId' && order.status === 'new') {
      transition(orderId, 'assigned', { note: `Assigned to ${user.name}`, skipPerm: true });
    } else {
      SP.store.audit('order.assign', order.ref, `${fieldLabel(role)} → ${user.name}`);
    }

    if (!isSelf) {
      SP.store.notify({ tone: 'info', title: `New task: ${order.ref}`, body: `You were assigned as ${fieldLabel(role)} for ${order.customer.name}.`, route: routeFor(role) });
    }
    return byId(orderId);
  }

  const fieldLabel = (role) => ({ packerId: 'Packer', qcId: 'QC approver', driverId: 'Driver', deliveryId: 'Delivery staff' })[role];
  const routeFor = (role) => ({ packerId: 'packing', qcId: 'qc', driverId: 'delivery', deliveryId: 'delivery' })[role];

  /* ─────────────────────────────────────────────────── transitions */

  function assertAssignable(order, to, user) {
    // The person performing stage work must be the assignee (or supervisor/admin).
    const elevated = ['admin', 'supervisor'].includes(SP.auth.roleOf(user));
    if (elevated) return;
    const required = {
      packing: order.packerId, packed: order.packerId,
      qc_approved: order.qcId, qc_rejected: order.qcId,
      delivered: order.deliveryId, failed: order.deliveryId, returned: order.deliveryId,
    }[to];
    if (required && required !== user?.id) {
      throw new WorkflowError('This order is assigned to someone else for this step.', 'ASSIGNEE');
    }
  }

  /**
   * Move an order to a new status.
   * opts: { note, proofId, skipPerm }
   */
  function transition(orderId, to, opts = {}) {
    const order = byId(orderId);
    if (!order) throw new WorkflowError('Order not found.', 'NOT_FOUND');
    const user = SP.auth.current();

    if (!SP.TRANSITIONS[order.status]?.includes(to)) {
      throw new WorkflowError(`Cannot move ${order.ref} from "${SP.statusOf(order.status).label}" to "${SP.statusOf(to).label}".`, 'STATE');
    }
    assertAssignable(order, to, user);

    const PERM_FOR = {
      assigned: null, packing: 'pack:perform', packed: 'pack:perform',
      qc_approved: 'qc:perform', qc_rejected: 'qc:perform',
      out_for_delivery: 'assign:delivery',
      delivered: 'deliver:perform', failed: 'deliver:perform', returned: 'deliver:perform',
      cancelled: 'orders:cancel',
    };
    let permNeeded = PERM_FOR[to];
    // Re-attempting a failed delivery is delivery work, not dispatch work.
    if (to === 'out_for_delivery' && order.status === 'failed') permNeeded = null;
    if (permNeeded && !opts.skipPerm && !SP.auth.can(permNeeded)) {
      throw new WorkflowError('Your role cannot perform this step.', 'PERM');
    }

    // Assignment prerequisites.
    if (to === 'packing' && !order.packerId) throw new WorkflowError('Assign a packer first.', 'VALIDATION');
    if (['qc_approved', 'qc_rejected'].includes(to) && !order.qcId) throw new WorkflowError('Assign a QC approver first.', 'VALIDATION');
    if (to === 'out_for_delivery' && (!order.driverId || !order.deliveryId)) {
      throw new WorkflowError('Assign both a driver and delivery staff before dispatch.', 'VALIDATION');
    }

    // Proof prerequisites.
    const proofRule = SP.PROOF_REQUIRED[to];
    if (proofRule && !proofRule.optional) {
      const needProof = (to === 'qc_approved' && SP.store.state.settings.qcRequiresPhoto)
        || (to === 'delivered' && SP.store.state.settings.deliveryRequiresPhoto)
        || to === 'packed';
      if (needProof && !opts.proofId) throw new WorkflowError(`A stamped photo proof (${proofRule.label}) is required.`, 'PROOF');
    }

    SP.store.update(['orders'], (s) => {
      const t = s.orders.find((x) => x.id === orderId);
      t.status = to;
      t.updatedAt = Date.now();
      t.history.push({
        at: Date.now(), by: user?.name || 'system',
        action: to, note: opts.note || '', proofId: opts.proofId || null,
      });
    });

    SP.store.audit(`order.${to}`, order.ref, opts.note || '', user?.name);

    // Notify the next party in the chain.
    const notifyUser = { packed: order.qcId, qc_rejected: order.packerId, qc_approved: order.driverId, out_for_delivery: order.deliveryId }[to];
    if (notifyUser) {
      const msgs = {
        packed: `${order.ref} is packed and waiting for your QC check.`,
        qc_rejected: `${order.ref} was rejected at QC${opts.note ? `: ${opts.note}` : '.'}`,
        qc_approved: `${order.ref} passed QC and is ready for dispatch.`,
        out_for_delivery: `${order.ref} is on its way — you handle the handover.`,
      };
      SP.store.notify({ tone: to === 'qc_rejected' ? 'warn' : 'info', title: `Order ${order.ref}`, body: msgs[to], route: routeFor(to === 'qc_rejected' ? 'packerId' : to === 'packed' ? 'qcId' : 'deliveryId') });
    }
    return byId(orderId);
  }

  /* ─────────────────────────────────────────────────── item packing */

  function setPackedQty(orderId, itemId, qty) {
    const order = byId(orderId);
    if (!order) throw new WorkflowError('Order not found.', 'NOT_FOUND');
    const item = order.items.find((i) => i.id === itemId);
    if (!item) throw new WorkflowError('Item not found.', 'NOT_FOUND');
    const q = SP.clamp(qty, 0, item.qty);
    SP.store.update(['orders'], (s) => {
      const t = s.orders.find((x) => x.id === orderId);
      t.items.find((i) => i.id === itemId).packedQty = q;
      t.updatedAt = Date.now();
    }, { silent: true });
  }

  const fullyPacked = (order) => order.items.every((i) => i.packedQty >= i.qty);

  /* ─────────────────────────────────────────────────────── queries */

  const queues = () => {
    const s = st();
    const uid = SP.auth.current()?.id;
    return {
      toPack: s.orders.filter((o) => ['assigned', 'packing', 'qc_rejected'].includes(o.status) && (!o.packerId || o.packerId === uid)),
      qcQueue: s.orders.filter((o) => o.status === 'packed' && (!o.qcId || o.qcId === uid)),
      deliveryQueue: s.orders.filter((o) => ['qc_approved', 'out_for_delivery'].includes(o.status)),
      myDeliveries: s.orders.filter((o) => ['out_for_delivery'].includes(o.status) && (o.deliveryId === uid || o.driverId === uid)),
      active: s.orders.filter((o) => !['delivered', 'returned', 'cancelled'].includes(o.status)),
      doneToday: s.orders.filter((o) => o.status === 'delivered' && o.updatedAt >= new Date().setHours(0, 0, 0, 0)),
    };
  };

  return { createOrder, assign, transition, setPackedQty, fullyPacked, byId, byRef, queues, WorkflowError };
})();
