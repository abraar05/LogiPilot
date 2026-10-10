/**
 * domain/permissions.js — canonical permission matrix (mirrors js/config.js).
 * The API is the authority; the client uses the same list for UX only.
 */
export const PERMS = {
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

export const ROLES = {
  packer: { label: 'Packing Staff', perms: ['dashboard:view', 'orders:view', 'pack:perform', 'proofs:view', 'proofs:submit'] },
  approver: { label: 'QC Approver', perms: ['dashboard:view', 'orders:view', 'qc:perform', 'proofs:view', 'proofs:submit'] },
  driver: { label: 'Driver', perms: ['dashboard:view', 'orders:view', 'proofs:view'] },
  delivery: { label: 'Delivery Staff', perms: ['dashboard:view', 'orders:view', 'deliver:perform', 'proofs:view', 'proofs:submit'] },
  supervisor: {
    label: 'Supervisor',
    perms: [
      'dashboard:view', 'orders:view', 'orders:create', 'orders:edit', 'orders:cancel', 'orders:export',
      'assign:packer', 'assign:qc', 'assign:delivery',
      'pack:perform', 'qc:perform', 'deliver:perform',
      'proofs:view', 'proofs:submit', 'audit:view',
    ],
  },
  admin: { label: 'Administrator', perms: ['*'] },
};

export const can = (role, perm) => {
  const perms = ROLES[role]?.perms || [];
  return perms.includes('*') || perms.includes(perm);
};

export const assertCan = (role, perm) => {
  if (!can(role, perm)) {
    const err = new Error(`Role "${ROLES[role]?.label || role}" cannot ${(PERMS[perm] || perm).toLowerCase()}.`);
    err.status = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }
};

export const isElevated = (role) => role === 'admin' || role === 'supervisor';