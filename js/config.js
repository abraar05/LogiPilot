/**
 * config.js — LogiPilot configuration: roles, permissions, order workflow.
 *
 * LogiPilot — logistics operations: sales-order packing, QC approval,
 * delivery chain and stamped photo proofs.
 */
window.SP = window.SP || {};

SP.VERSION = '1.0.2';
SP.BUILD = '2026.10.05';
SP.PRODUCT_NAME = 'LogiPilot';
SP.TAGLINE = 'Pack · Approve · Deliver — every step proven';

SP.STORAGE_KEY = 'logipilot.state.v1';
SP.SESSION_KEY = 'logipilot.session.v1';

/* ═══════════════════════════════════════════════ order state machine */

/**
 * The chain:
 *   NEW → ASSIGNED (to packer) → PACKING → PACKED (photo proof)
 *       → QC_PENDING → QC_APPROVED (photo) | QC_REJECTED → back to PACKING
 *       → OUT_FOR_DELIVERY (driver + delivery man assigned)
 *       → DELIVERED (photo proof) | FAILED | RETURNED
 */
SP.ORDER_STATUS = [
  { id: 'new', label: 'New', tone: 'mute', stage: 'intake' },
  { id: 'assigned', label: 'Assigned to packer', tone: 'info', stage: 'pack' },
  { id: 'packing', label: 'Packing', tone: 'brand', stage: 'pack' },
  { id: 'packed', label: 'Packed — awaiting QC', tone: 'warn', stage: 'qc' },
  { id: 'qc_approved', label: 'QC approved', tone: 'ok', stage: 'qc' },
  { id: 'qc_rejected', label: 'QC rejected — rework', tone: 'danger', stage: 'pack' },
  { id: 'out_for_delivery', label: 'Out for delivery', tone: 'warn', stage: 'deliver' },
  { id: 'delivered', label: 'Delivered', tone: 'ok', stage: 'done' },
  { id: 'failed', label: 'Delivery failed', tone: 'danger', stage: 'deliver' },
  { id: 'returned', label: 'Returned', tone: 'mute', stage: 'done' },
  { id: 'cancelled', label: 'Cancelled', tone: 'mute', stage: 'done' },
];

SP.statusOf = (id) => {
  const base = SP.ORDER_STATUS.find((s) => s.id === id) || { id, label: id, tone: 'mute', stage: 'done' };
  return { ...base, get label() { return SP.i18n ? SP.i18n.statusLabel(id) : base.label; } };
};

/** Allowed transitions; each records history + requires proof where marked. */
SP.TRANSITIONS = {
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

/** Transitions that cannot complete without a stamped photo proof. */
SP.PROOF_REQUIRED = {
  packed: { label: 'Packaged goods', role: 'packer' },
  qc_approved: { label: 'QC check', role: 'approver' },
  delivered: { label: 'Delivery handover', role: 'delivery' },
  failed: { label: 'Failed delivery attempt', role: 'delivery', optional: true },
};

/* ═══════════════════════════════════════════════════════ roles & perms */

SP.PERMS = {
  'dashboard:view': 'View dashboard',
  'orders:view': 'View orders',
  'orders:create': 'Create sales orders',
  'orders:edit': 'Edit orders',
  'orders:cancel': 'Cancel orders',
  'orders:export': 'Export orders',
  'assign:packer': 'Assign packers',
  'assign:qc': 'Assign QC approvers',
  'assign:delivery': 'Assign driver & delivery staff',
  'pack:perform': 'Pack orders',
  'qc:perform': 'Approve / reject packed orders',
  'deliver:perform': 'Run deliveries',
  'proofs:view': 'View photo proofs',
  'proofs:submit': 'Submit photo proofs',
  'users:manage': 'Manage users, roles & assignments',
  'audit:view': 'View audit log',
  'settings:manage': 'Manage settings',
  'data:manage': 'Backup, restore & purge data',
};

SP.ROLES = [
  {
    id: 'packer', label: 'Packing Staff',
    blurb: 'Prepares goods for packaging as per the sales order.',
    perms: ['dashboard:view', 'orders:view', 'pack:perform', 'proofs:view', 'proofs:submit'],
  },
  {
    id: 'approver', label: 'QC Approver',
    blurb: 'Checks packaged items against the order and reports mismatches.',
    perms: ['dashboard:view', 'orders:view', 'qc:perform', 'proofs:view', 'proofs:submit'],
  },
  {
    id: 'driver', label: 'Driver',
    blurb: 'Carries parcels; sees the route and delivery status.',
    perms: ['dashboard:view', 'orders:view', 'proofs:view'],
  },
  {
    id: 'delivery', label: 'Delivery Staff',
    blurb: 'Hands parcels over and captures proof of delivery.',
    perms: ['dashboard:view', 'orders:view', 'deliver:perform', 'proofs:view', 'proofs:submit'],
  },
  {
    id: 'supervisor', label: 'Supervisor',
    blurb: 'Assigns work, watches every queue, exports reports.',
    perms: [
      'dashboard:view', 'orders:view', 'orders:create', 'orders:edit', 'orders:cancel', 'orders:export',
      'assign:packer', 'assign:qc', 'assign:delivery',
      'pack:perform', 'qc:perform', 'deliver:perform',
      'proofs:view', 'proofs:submit', 'audit:view',
    ],
  },
  {
    id: 'admin', label: 'Administrator',
    blurb: 'Full control including users, permissions and data.',
    perms: ['*'],
  },
];

/* ════════════════════════════════════════════════════════════ nav */

SP.NAV = [
  {
    group: 'Work',
    items: [
      { route: 'dashboard', label: 'Dashboard', icon: 'grid', tab: true },
      { route: 'packing', label: 'Packing', icon: 'box', tab: true, badge: 'packing', perm: 'pack:perform' },
      { route: 'qc', label: 'QC Approval', icon: 'checkCircle', tab: true, badge: 'qc', perm: 'qc:perform' },
      { route: 'delivery', label: 'Delivery', icon: 'truck', tab: true, badge: 'delivery', perm: 'deliver:perform' },
    ],
  },
  {
    group: 'Track',
    items: [
      { route: 'orders', label: 'Orders', icon: 'file', perm: 'orders:view' },
      { route: 'proofs', label: 'Photo Proofs', icon: 'eye', perm: 'proofs:view' },
    ],
  },
  {
    group: 'Administration',
    items: [
      { route: 'users', label: 'Users & Assignment', icon: 'shield', perm: 'users:manage' },
      { route: 'audit', label: 'Audit Log', icon: 'database', perm: 'audit:view' },
      { route: 'settings', label: 'Settings', icon: 'cog' },
    ],
  },
];

SP.TABS = ['dashboard', 'packing', 'qc', 'delivery', 'more'];

SP.TIPS = [
  { id: 'photo', where: 'packing', text: 'Photos are stamped with your name, the time and the order reference — they cannot be edited afterwards.' },
  { id: 'reject', where: 'qc', text: 'Rejecting sends the order straight back to the packer with your note.' },
  { id: 'chain', where: 'delivery', text: 'Driver carries, delivery staff hands over. Both are recorded on the order.' },
];
