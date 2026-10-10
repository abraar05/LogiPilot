/**
 * test/api.test.js — end-to-end API lifecycle over the file adapter.
 * Run: node --test test/  (or npm test inside server/)
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'logipilot-test-'));
process.env.LP_DATA_DIR = dir;
process.env.LP_PROOFS_DIR = join(dir, 'proofs');
process.env.LP_SECRET = 'test-secret-value-0123456789';
process.env.LP_PBKDF2 = '1000';           // fast hashing for tests only

const { createApp } = await import('../src/index.js');
const app = await createApp();

let server;
let base;
let token;

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();   // SSE clients would otherwise hold it open
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

async function api(method, path, body, opts = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.token ? {} : {}),
      ...(opts.headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* csv or binary */ }
  return { status: res.status, body: json, raw: text, headers: res.headers };
}

const asUser = (path, body, extra = {}) => api('POST', path, body, { token, ...extra });
const get = (path) => api('GET', path, undefined, { token });
const patch = (path, body) => api('PATCH', path, body, { token });

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let admin; let packer; let qc; let delivery; let driver;
let orderId;

test('health is public', async () => {
  const res = await api('GET', '/api/v1/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test('meta exposes the canonical state machine', async () => {
  const res = await api('GET', '/api/v1/meta');
  assert.ok(res.body.transitions.packed.includes('qc_approved'));
});

test('sign-in fails without an account', async () => {
  const res = await api('POST', '/api/v1/auth/signin', { email: 'nobody@x.com', password: 'whatever1' });
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'INVALID_CREDENTIALS');
});

test('admin bootstrap + login', async () => {
  admin = (await api('POST', '/api/v1/users', null)).status; // no auth → 401 expected path below
  assert.equal(admin, 401);

  // bootstrap the first admin directly via the service (mirrors production seeding)
  const { createUser } = await import('../src/services/auth.js');
  await createUser({ name: 'Admin', email: 'admin@test.app', password: 'Admin@1234', role: 'admin' });
  await createUser({ name: 'Packer', email: 'packer@test.app', password: 'Pack@1234', role: 'packer' });
  await createUser({ name: 'QC', email: 'qc@test.app', password: 'Qc@12345', role: 'approver' });
  await createUser({ name: 'Driver', email: 'driver@test.app', password: 'Drive@1234', role: 'driver' });
  await createUser({ name: 'Delivery', email: 'delivery@test.app', password: 'Deliver@123', role: 'delivery' });

  const res = await api('POST', '/api/v1/auth/signin', { email: 'admin@test.app', password: 'Admin@1234' });
  assert.equal(res.status, 200);
  assert.ok(res.body.token);
  token = res.body.token;
});

test('bad password is rejected and counted', async () => {
  const res = await api('POST', '/api/v1/auth/signin', { email: 'admin@test.app', password: 'wrong-pass' });
  assert.equal(res.status, 401);
});

test('user directory requires sign-in', async () => {
  const res = await api('GET', '/api/v1/users');
  assert.equal(res.status, 401);
});

test('packer cannot create orders (server-side RBAC)', async () => {
  await asUser('/api/v1/auth/signout');
  token = (await api('POST', '/api/v1/auth/signin', { email: 'packer@test.app', password: 'Pack@1234' })).body.token;
  const res = await asUser('/api/v1/orders', { customer: { name: 'X' }, items: [{ name: 'a', qty: 1 }] });
  assert.equal(res.status, 403);
  await api('POST', '/api/v1/auth/signout');
  token = (await api('POST', '/api/v1/auth/signin', { email: 'admin@test.app', password: 'Admin@1234' })).body.token;
});

test('order lifecycle: create → assign → pack → proof → qc → dispatch → deliver', async () => {
  const created = await asUser('/api/v1/orders', {
    customer: { name: 'Rahim Electronics', phone: '01711000000', address: 'Dhaka' },
    items: [{ name: 'Xiaomi 14 Ultra', sku: 'XIA14U', qty: 2 }, { name: 'Redmi Pad', sku: 'PAD8', qty: 1 }],
    codAmount: 2500,
  }, { headers: { 'idempotency-key': 'order-1' } });
  assert.equal(created.status, 200);
  assert.equal(created.body.order.status, 'new');
  orderId = created.body.order.id;

  // duplicate idempotency key replays the same order
  const replay = await asUser('/api/v1/orders', {
    customer: { name: 'Rahim Electronics' }, items: [{ name: 'Xiaomi 14 Ultra', qty: 2 }],
  }, { headers: { 'idempotency-key': 'order-1' } });
  assert.equal(replay.body.order.id, orderId, 'idempotent replay returns the same order');

  const users = (await get('/api/v1/users')).body.users;
  packer = users.find((u) => u.role === 'packer');
  qc = users.find((u) => u.role === 'approver');
  driver = users.find((u) => u.role === 'driver');
  delivery = users.find((u) => u.role === 'delivery');

  const assigned = await asUser(`/api/v1/orders/${orderId}/assign`, { field: 'packerId', userId: packer.id });
  assert.equal(assigned.body.order.status, 'assigned');

  // packer session
  await api('POST', '/api/v1/auth/signout');
  const packerToken = (await api('POST', '/api/v1/auth/signin', { email: 'packer@test.app', password: 'Pack@1234' })).body.token;

  const started = await api('POST', `/api/v1/orders/${orderId}/transition`, { to: 'packing' }, { token: packerToken });
  assert.equal(started.body.order.status, 'packing');

  const items = (await get(`/api/v1/orders/${orderId}`)).body.order.items;
  await api('POST', `/api/v1/orders/${orderId}/packed-qty`, { itemId: items[0].id, qty: items[0].qty }, { token: packerToken });
  await api('POST', `/api/v1/orders/${orderId}/packed-qty`, { itemId: items[1].id, qty: items[1].qty }, { token: packerToken });

  // packed requires a proof
  const noProof = await api('POST', `/api/v1/orders/${orderId}/transition`, { to: 'packed' }, { token: packerToken });
  assert.equal(noProof.status, 422);
  assert.equal(noProof.body.error.code, 'PROOF_REQUIRED');

  const proof = await api('POST', `/api/v1/orders/${orderId}/proofs`, { stage: 'packed', dataUrl: TINY_PNG, gps: { lat: 23.78, lng: 90.41, acc: 20 } }, { token: packerToken });
  assert.equal(proof.status, 200);
  assert.ok(proof.body.proof.sha256, 'proof content is hashed');

  const packed = await api('POST', `/api/v1/orders/${orderId}/transition`, { to: 'packed', proofId: proof.body.proof.id }, { token: packerToken });
  assert.equal(packed.body.order.status, 'packed');

  // qc
  await api('POST', '/api/v1/auth/signout');
  const qcToken = (await api('POST', '/api/v1/auth/signin', { email: 'qc@test.app', password: 'Qc@12345' })).body.token;
  const noApprover = await api('POST', `/api/v1/orders/${orderId}/transition`, { to: 'qc_approved', proofId: proof.body.proof.id }, { token: qcToken });
  assert.equal(noApprover.status, 422, 'QC approver must be assigned first');

  token = (await api('POST', '/api/v1/auth/signin', { email: 'admin@test.app', password: 'Admin@1234' })).body.token;
  await asUser(`/api/v1/orders/${orderId}/assign`, { field: 'qcId', userId: qc.id });
  token = qcToken;
  const qcProof = await api('POST', `/api/v1/orders/${orderId}/proofs`, { stage: 'qc_approved', dataUrl: TINY_PNG }, { token: qcToken });
  const approved = await api('POST', `/api/v1/orders/${orderId}/transition`, { to: 'qc_approved', proofId: qcProof.body.proof.id }, { token: qcToken });
  assert.equal(approved.body.order.status, 'qc_approved');

  // dispatch needs driver + delivery
  token = (await api('POST', '/api/v1/auth/signin', { email: 'admin@test.app', password: 'Admin@1234' })).body.token;
  const noCrew = await asUser(`/api/v1/orders/${orderId}/transition`, { to: 'out_for_delivery' });
  assert.equal(noCrew.status, 422);
  await asUser(`/api/v1/orders/${orderId}/assign`, { field: 'driverId', userId: driver.id });
  await asUser(`/api/v1/orders/${orderId}/assign`, { field: 'deliveryId', userId: delivery.id });
  const dispatched = await asUser(`/api/v1/orders/${orderId}/transition`, { to: 'out_for_delivery' });
  assert.equal(dispatched.body.order.status, 'out_for_delivery');

  // delivery
  await api('POST', '/api/v1/auth/signout');
  const deliveryToken = (await api('POST', '/api/v1/auth/signin', { email: 'delivery@test.app', password: 'Deliver@123' })).body.token;
  const delProof = await api('POST', `/api/v1/orders/${orderId}/proofs`, { stage: 'delivered', dataUrl: TINY_PNG }, { token: deliveryToken });
  const delivered = await api('POST', `/api/v1/orders/${orderId}/transition`, { to: 'delivered', proofId: delProof.body.proof.id }, { token: deliveryToken });
  assert.equal(delivered.body.order.status, 'delivered');

  const cod = await api('POST', `/api/v1/orders/${orderId}/cod`, { amount: 2500 }, { token: deliveryToken });
  assert.equal(cod.body.order.codCollected, true);

  const history = await get(`/api/v1/orders/${orderId}`);
  assert.equal(history.body.order.status, 'delivered');
  assert.ok(history.body.events.length >= 6, 'every transition wrote an event');
  assert.equal(history.body.proofs.length, 3);
});

test('proofs are immutable', async () => {
  const { update, remove } = await import('../src/services/proofs.js');
  assert.throws(() => update(), /immutable/i);
  assert.throws(() => remove(), /immutable/i);
});

test('version conflict is detected', async () => {
  token = (await api('POST', '/api/v1/auth/signin', { email: 'admin@test.app', password: 'Admin@1234' })).body.token;
  const created = await asUser('/api/v1/orders', { customer: { name: 'Conflict Co' }, items: [{ name: 'X', qty: 1 }] });
  const id = created.body.order.id;
  const stale = created.body.order.version;
  await patch(`/api/v1/orders/${id}`, { notes: 'first edit' });
  const conflict = await asUser(`/api/v1/orders/${id}/transition`, { to: 'packing', expectedVersion: stale });
  // order is still 'new', so packing is legal; the version guard must trip first
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, 'VERSION_CONFLICT');
});

test('audit chain is tamper-evident', async () => {
  token = (await api('POST', '/api/v1/auth/signin', { email: 'admin@test.app', password: 'Admin@1234' })).body.token;
  const res = await get('/api/v1/audit?limit=500');
  assert.equal(res.body.chain.ok, true, 'chain verifies');
  assert.ok(res.body.entries.length > 5);

  const { getDb } = await import('../src/db/index.js');
  const db = getDb();
  const first = (await db.filter('audit')).sort((a, b) => a.at - b.at)[0];
  await db.update('audit', first.id, { detail: 'tampered' });
  const { verifyChain } = await import('../src/services/audit.js');
  const broken = await verifyChain();
  assert.equal(broken.ok, false, 'tampering breaks the chain');
  assert.equal(broken.brokenAt, first.id);
});

test('reports run server-side', async () => {
  token = (await api('POST', '/api/v1/auth/signin', { email: 'admin@test.app', password: 'Admin@1234' })).body.token;
  const summary = await get('/api/v1/reports/summary');
  assert.equal(summary.status, 200);
  assert.ok(summary.body.data.orders >= 1);
  assert.ok(summary.body.data.proofs >= 3);

  const throughput = await get('/api/v1/reports/throughput');
  assert.equal(throughput.body.data.length, 7);

  const perf = await get('/api/v1/reports/performance');
  assert.ok(Array.isArray(perf.body.data));
});

test('realtime stream emits order events', async () => {
  const res = await fetch(`${base}/api/v1/stream`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  const got = [];

  // trigger a change while the stream is open
  const created = await asUser('/api/v1/orders', { customer: { name: 'Stream Co' }, items: [{ name: 'Y', qty: 1 }] });
  const id = created.body.order.id;
  const proof = await asUser(`/api/v1/orders/${id}/proofs`, { stage: 'packed', dataUrl: TINY_PNG });
  await asUser(`/api/v1/orders/${id}/assign`, { field: 'packerId', userId: packer.id });

  const decoder = new TextDecoder();
  const deadline = Date.now() + 2500;
  while (got.length < 2 && Date.now() < deadline) {
    const next = await Promise.race([
      reader.read(),
      new Promise((r) => setTimeout(() => r({ value: null, done: true }), 400)),
    ]);
    if (!next.value) {
      if (got.length && Date.now() > deadline) break;
      if (got.includes('ready') && got.length >= 1 && next.done) break;
      continue;
    }
    const chunk = decoder.decode(next.value);
    if (chunk.includes('event: ')) for (const m of chunk.matchAll(/event: (\S+)/g)) got.push(m[1]);
  }
  await reader.cancel().catch(() => {});
  assert.ok(got.includes('ready'));
  assert.ok(got.includes('order.created') || got.includes('proof.created'), `stream carried events: ${got.join(',')}`);
});

test('sessions can be revoked', async () => {
  const victim = (await api('POST', '/api/v1/auth/signin', { email: 'packer@test.app', password: 'Pack@1234' })).body;
  await asUser(`/api/v1/users/${packer.id}/revoke`);
  const after = await api('GET', '/api/v1/auth/me', undefined, { token: victim.token });
  assert.equal(after.status, 401, 'revoked token stops working');
});

test('integration: client outbox pushes local changes to the server', async () => {
  // load the real client service layer (js/api.js) against this server
  const { readFileSync } = await import('node:fs');
  const vm = await import('node:vm');
  const sandbox = {
    console,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval,
    addEventListener: () => {},
    fetch: (url, opts) => fetch(url.startsWith('http') ? url : `${base}${url}`, opts),
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    navigator: { onLine: true },
    crypto: { getRandomValues: (a) => a.fill(11), randomUUID: () => `u${Math.floor(Math.random() * 1e9)}` },
    AbortController, URLSearchParams, EventSource: class { addEventListener() {} close() {} },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of ['js/util.js', 'js/store.js', 'js/api.js']) {
    vm.runInContext(readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8'), sandbox, { filename: f });
  }
  const SP = sandbox.SP;
  SP.store.state.settings.server = { url: base, token: '', user: null, connected: false, lastSync: null, error: null, health: null };

  // sign in through the client layer
  const me = await SP.api.auth.signIn({ email: 'admin@test.app', password: 'Admin@1234' });
  assert.equal(me.role, 'admin');
  assert.ok(SP.api.token());

  // queue a create exactly as the UI does, then flush
  SP.api.enqueue({ kind: 'order.create', id: 'x1', payload: { customer: { name: 'Outbox Co' }, items: [{ name: 'Pushed item', qty: 3 }] } });
  SP.api.enqueue({ kind: 'order.create', id: 'x2', payload: { customer: { name: 'Second Co' }, items: [{ name: 'Another', qty: 1 }] } });
  // enqueue() triggers a flush itself (mutex-guarded); drain explicitly
  await SP.api.flush();
  await SP.api.flush();
  assert.equal(SP.api.pendingCount(), 0, 'outbox drained');

  const listed = await SP.api.orders.list({ q: 'Outbox Co' });
  assert.equal(listed.orders.length, 1);
  assert.equal(listed.orders[0].items[0].qty, 3);

  // a blocked op stays queued with its reason (server is the authority)
  SP.api.enqueue({ kind: 'order.transition', id: listed.orders[0].id, payload: { id: listed.orders[0].id, to: 'delivered' } });
  await SP.api.flush();
  await SP.api.flush();
  assert.equal(SP.api.pendingCount(), 1, 'rejected op stays queued');
  assert.ok(SP.api.conflicts().length, 'blocked op is surfaced to the user');
});
