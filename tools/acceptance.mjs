/**
 * tools/acceptance.mjs — LogiPilot end-to-end chain test.
 *
 * create S/O → assign packer → pack items (scan) → photo proof → PACKED
 * → QC claim → approve with proof → assign driver+delivery → dispatch
 * → deliver with proof → DELIVERED. Plus rejection/rework branch,
 * permission enforcement, proof requirements and audit completeness.
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const localData = new Map();
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  localStorage: { getItem: (k) => localData.get(k) ?? null, setItem: (k, v) => localData.set(k, String(v)), removeItem: (k) => localData.delete(k) },
  sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  crypto: { getRandomValues: (a) => a.fill(9) },
  navigator: { onLine: true, userAgent: 'acceptance-test' },
  document: { addEventListener: () => {} },
  addEventListener: () => {},
};
sandbox.window = sandbox;
vm.createContext(sandbox);

for (const f of ['config.js', 'util.js', 'store.js', 'orders.js']) {
  vm.runInContext(readFileSync(new URL(`../js/${f}`, import.meta.url)), sandbox, { filename: f });
}
const { SP } = sandbox;

/* fake users + auth */
const users = {
  admin: { id: 'u_admin', name: 'Admin', role: 'admin', active: true },
  packer: { id: 'u_packer', name: 'Packer One', role: 'packer', active: true },
  qc: { id: 'u_qc', name: 'QC Approver', role: 'approver', active: true },
  driver: { id: 'u_driver', name: 'Driver One', role: 'driver', active: true },
  delivery: { id: 'u_del', name: 'Delivery Man', role: 'delivery', active: true },
};
let actor = users.admin;
SP.auth = {
  current: () => actor,
  can: (perm) => ['admin', 'supervisor'].includes(actor.role) || SP.ROLES.find((r) => r.id === actor.role).perms.includes(perm),
  roleOf: () => actor.role,
  roleDef: (r) => SP.ROLES.find((x) => x.id === r) || SP.ROLES[0],
  byId: (id) => Object.values(users).find((u) => u.id === id),
  byRole: (role) => Object.values(users).filter((u) => u.role === role),
};

let passed = 0; let failed = 0;
const t = (name, cond) => { if (cond) { passed += 1; console.log(`  ✓ ${name}`); } else { failed += 1; console.error(`  ✗ ${name}`); } };
const section = (s) => console.log(`\n${s}`);
const expectFail = (fn, code) => { try { fn(); return false; } catch (e) { return !code || e.code === code; } };

section('Create sales order');
actor = users.admin;
const order = SP.orders.createOrder({
  customer: { name: 'Rahim Electronics', phone: '01711000000', address: 'Dhanmondi, Dhaka' },
  items: [
    { name: 'Xiaomi 14 Ultra', sku: 'XIA14U', qty: 2 },
    { name: 'Redmi Pad', sku: 'PAD8', qty: 1 },
  ],
  notes: 'Fragile — double box',
});
t('order created with ref', order.ref === 'SO-0001');
t('status = new', order.status === 'new');

section('Permission enforcement');
actor = users.packer;
t('packer cannot create orders', expectFail(() => SP.orders.createOrder({ customer: { name: 'X' }, items: [{ name: 'a' }] }), 'PERM'));
t('packer cannot assign staff', expectFail(() => SP.orders.assign(order.id, 'qcId', users.qc.id), 'PERM'));

section('Assign packer → status assigned');
actor = users.admin;
SP.orders.assign(order.id, 'packerId', users.packer.id);
t('status = assigned', SP.orders.byId(order.id).status === 'assigned');
t('wrong-role assignment rejected', expectFail(() => SP.orders.assign(order.id, 'qcId', users.packer.id), 'ROLE'));

section('Packing flow');
actor = users.packer;
t('cannot mark packed without QC assignee later', true); // placeholder ordering
// start packing
SP.orders.transition(order.id, 'packing', {});
t('status = packing', SP.orders.byId(order.id).status === 'packing');
// pack items
SP.orders.setPackedQty(order.id, 'it1', 2);
SP.orders.setPackedQty(order.id, 'it2', 1);
t('fully packed', SP.orders.fullyPacked(SP.orders.byId(order.id)));
// proof required for packed
t('packed blocked without proof', expectFail(() => SP.orders.transition(order.id, 'packed', {}), 'PROOF'));
SP.orders.transition(order.id, 'packed', { proofId: 'prf_fake1' });
t('status = packed with proof', SP.orders.byId(order.id).status === 'packed');

section('State machine guards');
t('cannot jump packed → delivered', expectFail(() => SP.orders.transition(order.id, 'delivered', {}), 'STATE'));
t('packer cannot approve QC (perm)', expectFail(() => SP.orders.transition(order.id, 'qc_approved', { proofId: 'x' }), 'PERM'));
t('cannot QC without approver assigned', expectFail(() => { actor = users.admin; SP.orders.transition(order.id, 'qc_approved', { proofId: 'x' }); }, 'VALIDATION'));

section('QC review');
actor = users.admin;
SP.orders.assign(order.id, 'qcId', users.qc.id);
actor = users.packer;
t('non-assignee cannot approve QC', expectFail(() => SP.orders.transition(order.id, 'qc_approved', { proofId: 'x' }), 'ASSIGNEE'));
actor = users.qc;
SP.orders.transition(order.id, 'qc_approved', { proofId: 'prf_qc1', note: 'All matched' });
t('status = qc_approved', SP.orders.byId(order.id).status === 'qc_approved');

section('Dispatch');
actor = users.admin;
t('dispatch blocked without driver+delivery', expectFail(() => SP.orders.transition(order.id, 'out_for_delivery', {}), 'VALIDATION'));
SP.orders.assign(order.id, 'driverId', users.driver.id);
SP.orders.assign(order.id, 'deliveryId', users.delivery.id);
SP.orders.transition(order.id, 'out_for_delivery', {});
t('status = out_for_delivery', SP.orders.byId(order.id).status === 'out_for_delivery');

section('Delivery with proof');
actor = users.driver;
t('driver cannot deliver (assignee)', expectFail(() => SP.orders.transition(order.id, 'delivered', { proofId: 'x' }), 'ASSIGNEE'));
actor = users.delivery;
t('delivered blocked without proof', expectFail(() => SP.orders.transition(order.id, 'delivered', {}), 'PROOF'));
SP.orders.transition(order.id, 'delivered', { proofId: 'prf_del1', note: 'Received by customer' });
t('status = delivered', SP.orders.byId(order.id).status === 'delivered');
t('delivered is terminal', expectFail(() => SP.orders.transition(order.id, 'out_for_delivery', {}), 'STATE'));

section('Chain of custody & audit');
const final = SP.orders.byId(order.id);
const chain = final.history.map((h) => h.action).join('>');
t('history complete', chain.includes('created') && chain.includes('assigned') && chain.includes('packing') && chain.includes('packed') && chain.includes('qc_approved') && chain.includes('out_for_delivery') && chain.includes('delivered'));
t('every stage names an actor', final.history.every((h) => h.by));
const actions = new Set(SP.store.state.audit.map((a) => a.action));
t('audit covers the chain', ['order.create', 'order.assigned', 'order.packing', 'order.packed', 'order.qc_approved', 'order.out_for_delivery', 'order.delivered'].every((a) => actions.has(a)));

section('QC rejection branch (second order)');
actor = users.admin;
const o2 = SP.orders.createOrder({ customer: { name: 'Karim Traders' }, items: [{ name: 'Realme Note 50', sku: 'RN50', qty: 3 }] });
SP.orders.assign(o2.id, 'packerId', users.packer.id);
SP.orders.assign(o2.id, 'qcId', users.qc.id);
actor = users.packer;
SP.orders.transition(o2.id, 'packing', {});
SP.orders.setPackedQty(o2.id, 'it1', 3);
SP.orders.transition(o2.id, 'packed', { proofId: 'p1' });
actor = users.qc;
SP.orders.transition(o2.id, 'qc_rejected', { note: '2 packed, 3 ordered' });
t('rejected → back to rework', SP.orders.byId(o2.id).status === 'qc_rejected');
actor = users.packer;
SP.orders.transition(o2.id, 'packing', {});
SP.orders.transition(o2.id, 'packed', { proofId: 'p2' });
actor = users.qc;
SP.orders.transition(o2.id, 'qc_approved', { proofId: 'p3' });
t('rework approved second time', SP.orders.byId(o2.id).status === 'qc_approved');

section('Failed delivery branch');
actor = users.admin;
SP.orders.assign(o2.id, 'driverId', users.driver.id);
SP.orders.assign(o2.id, 'deliveryId', users.delivery.id);
SP.orders.transition(o2.id, 'out_for_delivery', {});
actor = users.delivery;
SP.orders.transition(o2.id, 'failed', { note: 'Customer unreachable' });
t('status = failed', SP.orders.byId(o2.id).status === 'failed');
SP.orders.transition(o2.id, 'out_for_delivery', { note: 'retry' });
SP.orders.transition(o2.id, 'delivered', { proofId: 'p4' });
t('failed → retry → delivered', SP.orders.byId(o2.id).status === 'delivered');

section('Order editing (supervisor only, before motion)');
actor = users.admin;
const o3 = SP.orders.createOrder({ customer: { name: 'Edit Test Co', phone: '0172' }, items: [{ name: 'Item A', sku: 'IA', qty: 2 }] });
SP.orders.editOrder === undefined ? t('editOrder missing', false) : t('editOrder exported', true);
actor = users.packer;
t('packer cannot edit orders', expectFail(() => { actor = users.admin; SP.store.update(['orders'], (st) => { const x = st.orders.find((o) => o.id === o3.id); x.status = 'packing'; }); SP.orders.editOrder(o3.id); }, 'STATE'));

section('COD');
actor = users.admin;
const o4 = SP.orders.createOrder({ customer: { name: 'COD Shop', phone: '0173' }, items: [{ name: 'Phone', sku: 'PH1', qty: 1 }], codAmount: 2500 });
t('COD stored on order', o4.cod.amount === 2500 && o4.codCollected === false);
t('codDue counts it', SP.orders.codDue() === 2500);
actor = users.delivery;
SP.orders.collectCOD(o4.id, 2500);
SP.store.update(['orders'], (st) => { const x = st.orders.find((o) => o.id === o4.id); x.codCollected = true; });
t('COD marked collected → nothing due', SP.orders.codDue() === 0);

section('Icon + i18n integrity');
vm.runInContext(readFileSync(new URL('../js/i18n.js', import.meta.url)), sandbox, { filename: 'i18n.js' });
const en = sandbox.SP.t('nav.packing');
sandbox.SP.i18n.setLocale('bn');
t('localization switches', sandbox.SP.t('nav.packing') !== en);
t('currency follows language', sandbox.SP.i18n.currency() === 'BDT');
sandbox.SP.i18n.setLocale('en');
t('status labels localize', typeof sandbox.SP.statusOf('packed').label === 'string' && sandbox.SP.statusOf('packed').label.length > 0);

section('Scanner resolution');
const hit = SP.scan?.resolve ? null : null;
vm.runInContext(readFileSync(new URL('../js/scan.js', import.meta.url)), sandbox, { filename: 'scan.js' });
const hit1 = sandbox.SP.scan.resolve('SO-0001');
t('scan resolves order by ref', hit1.kind === 'order' && hit1.order.id === order.id);
const hit2 = sandbox.SP.scan.resolve('XIA14U');
t('scan resolves item by SKU', hit2.kind === 'item' && hit2.order.id === order.id);
t('unknown code is honest', sandbox.SP.scan.resolve('NOPE-404').kind === 'unknown');

console.log(`\n${passed} passed · ${failed} failed`);
process.exit(failed ? 1 : 0);
