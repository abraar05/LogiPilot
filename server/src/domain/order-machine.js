/**
 * domain/order-machine.js — canonical order state machine.
 * This is the server-side authority. `test/parity.test.js` asserts it stays
 * identical to the client's copy in js/config.js.
 */
import { assertCan, isElevated } from './permissions.js';

export const STATUSES = [
  { id: 'new', stage: 'intake' },
  { id: 'assigned', stage: 'pack' },
  { id: 'packing', stage: 'pack' },
  { id: 'packed', stage: 'qc' },
  { id: 'qc_approved', stage: 'qc' },
  { id: 'qc_rejected', stage: 'pack' },
  { id: 'out_for_delivery', stage: 'deliver' },
  { id: 'delivered', stage: 'done' },
  { id: 'failed', stage: 'deliver' },
  { id: 'returned', stage: 'done' },
  { id: 'cancelled', stage: 'done' },
];

export const TRANSITIONS = {
  new: ['assigned', 'cancelled'],
  assigned: ['packing', 'cancelled'],
  packing: ['packed', 'cancelled'],
  packed: ['qc_approved', 'qc_rejected'],
  qc_rejected: ['packing', 'cancelled'],
  qc_approved: ['out_for_delivery', 'cancelled'],
  out_for_delivery: ['delivered', 'failed', 'returned'],
  failed: ['out_for_delivery', 'returned', 'cancelled'],
  delivered: [],
  returned: [],
  cancelled: [],
};

export const PROOF_REQUIRED = { packed: true, qc_approved: true, delivered: true, failed: false };

const PERM_FOR = {
  assigned: null,
  packing: 'pack:perform',
  packed: 'pack:perform',
  qc_approved: 'qc:perform',
  qc_rejected: 'qc:perform',
  out_for_delivery: 'assign:delivery',
  delivered: 'deliver:perform',
  failed: 'deliver:perform',
  returned: 'deliver:perform',
  cancelled: 'orders:cancel',
};

const ASSIGNEE_FOR = {
  packing: 'packerId',
  packed: 'packerId',
  qc_approved: 'qcId',
  qc_rejected: 'qcId',
  delivered: 'deliveryId',
  failed: 'deliveryId',
  returned: 'deliveryId',
};

export class WorkflowError extends Error {
  constructor(message, code = 'WF', status = 422) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * Validate a transition without mutating anything.
 * @param order   the stored order document
 * @param to      target status
 * @param actor   { id, role, name }
 * @param opts    { proofId, note, skipPerm }
 * @throws WorkflowError with a human-readable reason.
 */
export function validateTransition(order, to, actor, opts = {}) {
  if (!order) throw new WorkflowError('Order not found.', 'NOT_FOUND', 404);
  if (!TRANSITIONS[order.status]?.includes(to)) {
    throw new WorkflowError(`Cannot move ${order.ref} from "${order.status}" to "${to}".`);
  }

  if (!isElevated(actor.role)) {
    const field = ASSIGNEE_FOR[to];
    if (field && order[field] && order[field] !== actor.id) {
      throw new WorkflowError('This order is assigned to someone else for this step.', 'ASSIGNEE', 403);
    }
    let perm = PERM_FOR[to];
    if (to === 'out_for_delivery' && order.status === 'failed') perm = null; // retry is delivery work
    if (perm) assertCan(actor.role, perm);
  }

  if (to === 'packing' && !order.packerId) throw new WorkflowError('Assign a packer first.', 'VALIDATION');
  if (['qc_approved', 'qc_rejected'].includes(to) && !order.qcId) throw new WorkflowError('Assign a QC approver first.', 'VALIDATION');
  if (to === 'out_for_delivery' && (!order.driverId || !order.deliveryId)) {
    throw new WorkflowError('Assign both a driver and delivery staff before dispatch.', 'VALIDATION');
  }
  if (PROOF_REQUIRED[to] && !opts.proofId) {
    throw new WorkflowError(`A stamped photo proof is required to move to "${to}".`, 'PROOF_REQUIRED');
  }
  return true;
}

export const nextStatuses = (status) => TRANSITIONS[status] || [];