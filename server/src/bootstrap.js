/**
 * bootstrap.js — create the first admin + a starter crew on an empty server.
 * Run: node src/bootstrap.js
 * Creates admin + supervisor + one user per operational role and prints
 * their credentials once. Safe to re-run: existing users are left alone.
 */
import { openDb } from './db/index.js';
import * as auth from './services/auth.js';
import { randomToken } from './util/crypto.js';

await openDb();

const password = (prefix) => `${prefix}-${randomToken(6)}`;
const crew = [
  { name: 'Admin', email: 'admin@logipilot.app', role: 'admin' },
  { name: 'Supervisor', email: 'super@logipilot.app', role: 'supervisor' },
  { name: 'Packer One', email: 'packer@logipilot.app', role: 'packer' },
  { name: 'QC Approver', email: 'qc@logipilot.app', role: 'approver' },
  { name: 'Driver One', email: 'driver@logipilot.app', role: 'driver' },
  { name: 'Delivery Staff', email: 'delivery@logipilot.app', role: 'delivery' },
];

const created = [];
for (const u of crew) {
  const pwd = password(u.role.slice(0, 3).toUpperCase());
  try {
    await auth.createUser({ ...u, password: pwd });
    created.push({ ...u, password: pwd });
  } catch (e) {
    if (e.code !== 'DUPLICATE') throw e;
  }
}

if (created.length) {
  console.log('\nLogiPilot accounts created:\n');
  for (const u of created) console.log(`  ${u.email.padEnd(26)} ${u.password}   (${u.role})`);
  console.log('\nChange these passwords immediately.\n');
} else {
  console.log('All bootstrap accounts already exist — nothing to do.');
}
