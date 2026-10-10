/**
 * index.js — LogiPilot API server.
 *
 *   node src/index.js
 *
 * Env: PORT, LP_SECRET, DATABASE_URL (optional Postgres), LP_DATA_DIR,
 *      LP_PROOFS_DIR, LP_CORS, NODE_ENV=production
 */
import { createServer } from 'node:http';
import { config } from './config.js';
import { openDb } from './db/index.js';
import { createRouter, HttpError, readBody, parseJson, corsHeaders, toHttp, rateLimit, traceId } from './http/router.js';
import * as auth from './services/auth.js';
import * as orders from './services/orders.js';
import * as proofs from './services/proofs.js';
import * as reports from './services/reports.js';
import * as audit from './services/audit.js';
import * as events from './services/events.js';
import { ROLES, PERMS } from './domain/permissions.js';
import { STATUSES, TRANSITIONS, PROOF_REQUIRED } from './domain/order-machine.js';

const router = createRouter();

/* ─────────────────────────────────────────────── middleware helpers */

const bearer = (req) => {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
};

async function authenticate(req) {
  const token = bearer(req) || req.headers['x-lp-token'];
  const ctx = await auth.resolveSession(token);
  if (!ctx) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue');
  return { token, ...ctx, actor: { id: ctx.user.id, name: ctx.user.name, email: ctx.user.email, role: ctx.user.role }, orgId: ctx.user.orgId };
}

/** Context factory: each handler gets a requireAuth bound to its own request. */
const withAuth = (req) => ({ requireAuth: () => authenticate(req) });

/** Idempotency: replay the stored response for a repeated key. */
const idemCache = new Map();
async function idempotent(req, key, fn) {
  if (!key) return fn();
  const id = `${bearer(req) || 'anon'}:${key}`;
  if (idemCache.has(id)) return idemCache.get(id);
  const result = await fn();
  idemCache.set(id, result);
  if (idemCache.size > 2000) idemCache.clear();
  return result;
}

/* ══════════════════════════════════════════════════════════ ROUTES */

// health & meta -------------------------------------------------------------
router.get('/api/v1/health', async () => ({
  ok: true,
  service: 'logipilot-api',
  version: '1.0.0',
  db: (await openDb()).kind,
  uptime: Math.round(process.uptime()),
  now: Date.now(),
}));

router.get('/api/v1/meta', async () => ({
  roles: ROLES,
  perms: PERMS,
  statuses: STATUSES,
  transitions: TRANSITIONS,
  proofRequired: PROOF_REQUIRED,
  reports: reports.KINDS,
}));

// auth ----------------------------------------------------------------------
router.post('/api/v1/auth/signin', async ({ req }) => {
  const ip = req.socket.remoteAddress || 'unknown';
  rateLimit(`auth:${ip}`, 20, 60e3);
  const body = parseJson(await readBody(req));
  return auth.signIn({
    email: body.email,
    password: body.password,
    totpCode: body.totpCode,
    remember: !!body.remember,
    device: req.headers['x-device'] || 'unknown',
  });
});

router.post('/api/v1/auth/signout', async ({ req }) => auth.signOut(bearer(req) || req.headers['x-lp-token']));

router.get('/api/v1/auth/me', async ({ req }, { requireAuth: ra }) => {
  const ctx = await ra();
  return { user: { id: ctx.user.id, name: ctx.user.name, email: ctx.user.email, role: ctx.user.role } };
}, { auth: true });

router.post('/api/v1/auth/password', async ({ req }, { requireAuth: ra }) => {
  const ctx = await ra();
  const body = parseJson(await readBody(req));
  return auth.changePassword(ctx.user.id, body.currentPassword, body.newPassword);
}, { auth: true });

router.post('/api/v1/auth/password/forgot', async ({ req }) => {
  rateLimit(`reset:${req.socket.remoteAddress}`, 5, 60e3);
  const body = parseJson(await readBody(req));
  const result = await auth.requestPasswordReset(body.email);
  return { ok: true, ...(config.isProd ? {} : { devToken: result.token }) }; // dev only exposes the token
}, { public: true });

router.post('/api/v1/auth/password/reset', async ({ req }) => {
  const body = parseJson(await readBody(req));
  return auth.completePasswordReset(body.token, body.newPassword);
}, { public: true });

router.post('/api/v1/auth/totp/enable', async ({ req }, { requireAuth: ra }) => {
  const ctx = await ra();
  return auth.enableTotp(ctx.user.id);
}, { auth: true });

router.post('/api/v1/auth/totp/confirm', async ({ req }, { requireAuth: ra }) => {
  const ctx = await ra();
  const body = parseJson(await readBody(req));
  return auth.confirmTotp(ctx.user.id, body.code);
}, { auth: true });

// users ---------------------------------------------------------------------
router.get('/api/v1/users', async (_, { requireAuth: ra }) => {
  const ctx = await ra();
  return { users: await auth.listUsers(ctx.orgId) };
}, { auth: true });

router.post('/api/v1/users', async ({ req }, { requireAuth: ra }) => {
  const ctx = await ra();
  const { assertCan } = await import('./domain/permissions.js');
  assertCan(ctx.user.role, 'users:manage');
  const body = parseJson(await readBody(req));
  return { user: await auth.createUser({ orgId: ctx.orgId, ...body }) };
}, { auth: true });

router.patch('/api/v1/users/:id', async ({ req, params }, { requireAuth: ra }) => {
  const ctx = await ra();
  const { assertCan } = await import('./domain/permissions.js');
  assertCan(ctx.user.role, 'users:manage');
  const body = parseJson(await readBody(req));
  return { user: await auth.updateUser(params.id, body, ctx.user.email) };
}, { auth: true });

router.post('/api/v1/users/:id/revoke', async ({ params }, { requireAuth: ra }) => {
  const ctx = await ra();
  const { assertCan } = await import('./domain/permissions.js');
  assertCan(ctx.user.role, 'users:manage');
  return auth.revokeAll(params.id);
}, { auth: true });

// orders --------------------------------------------------------------------
router.get('/api/v1/orders', async ({ req, url }, { requireAuth: ra }) => {
  const ctx = await ra();
  const status = url.searchParams.get('status');
  const q = url.searchParams.get('q');
  const mine = url.searchParams.get('mine');
  const field = { packer: 'packerId', qc: 'qcId', delivery: 'deliveryId', driver: 'driverId' }[mine];
  const list = await orders.list({ orgId: ctx.orgId, status, q, assignee: field ? { id: ctx.user.id, field } : null });
  return { orders: list };
}, { auth: true });

router.post('/api/v1/orders', async ({ req }, { requireAuth: ra }) => {
  const ctx = await ra();
  rateLimit(`orders:${ctx.user.id}`, 60, 60e3);
  const body = parseJson(await readBody(req));
  const result = await idempotent(req, req.headers['idempotency-key'], () => orders.create(body, ctx.actor));
  return { order: result };
}, { auth: true });

router.get('/api/v1/orders/:id', async ({ params }, { requireAuth: ra }) => {
  const ctx = await ra();
  const result = await orders.history(params.id, ctx.orgId);
  if (!result.order) throw new HttpError(404, 'NOT_FOUND', 'Order not found');
  return { ...result, next: orders.allowedNext(result.order) };
}, { auth: true });

router.patch('/api/v1/orders/:id', async ({ req, params }, { requireAuth: ra }) => {
  const ctx = await ra();
  const body = parseJson(await readBody(req));
  return { order: await orders.update(params.id, body, ctx.orgId, ctx.actor) };
}, { auth: true });

router.post('/api/v1/orders/:id/assign', async ({ req, params }, { requireAuth: ra }) => {
  const ctx = await ra();
  const body = parseJson(await readBody(req));
  const { field, userId } = body;
  if (!['packerId', 'qcId', 'driverId', 'deliveryId'].includes(field)) {
    throw new HttpError(400, 'VALIDATION', 'Unknown assignment field');
  }
  return { order: await orders.assign(params.id, field, userId, ctx.orgId, ctx.actor) };
}, { auth: true });

router.post('/api/v1/orders/:id/packed-qty', async ({ req, params }, { requireAuth: ra }) => {
  const ctx = await ra();
  const body = parseJson(await readBody(req));
  return { order: await orders.setPackedQty(params.id, body.itemId, body.qty, ctx.orgId, ctx.actor) };
}, { auth: true });

router.post('/api/v1/orders/:id/transition', async ({ req, params }, { requireAuth: ra }) => {
  const ctx = await ra();
  const body = parseJson(await readBody(req));
  const result = await idempotent(req, req.headers['idempotency-key'], () => orders.transition(params.id, body.to, {
    orgId: ctx.orgId, actor: ctx.actor, proofId: body.proofId || null, note: body.note || '', expectedVersion: body.expectedVersion ?? null,
  }));
  return { order: result };
}, { auth: true });

router.post('/api/v1/orders/:id/cod', async ({ req, params }, { requireAuth: ra }) => {
  const ctx = await ra();
  const body = parseJson(await readBody(req));
  return { order: await orders.collectCOD(params.id, body.amount, ctx.orgId, ctx.actor) };
}, { auth: true });

// proofs --------------------------------------------------------------------
router.get('/api/v1/proofs', async ({ url }, { requireAuth: ra }) => {
  const ctx = await ra();
  const { assertCan } = await import('./domain/permissions.js');
  assertCan(ctx.user.role, 'proofs:view');
  return {
    proofs: await proofs.list({
      orgId: ctx.orgId,
      orderId: url.searchParams.get('orderId'),
      stage: url.searchParams.get('stage'),
      limit: Number(url.searchParams.get('limit') || 200),
    }),
  };
}, { auth: true });

router.post('/api/v1/orders/:id/proofs', async ({ req, params }, { requireAuth: ra }) => {
  const ctx = await ra();
  const { assertCan } = await import('./domain/permissions.js');
  assertCan(ctx.user.role, 'proofs:submit');
  const body = parseJson(await readBody(req));
  const result = await idempotent(req, req.headers['idempotency-key'], () => proofs.create({
    orgId: ctx.orgId, orderId: params.id, stage: body.stage, dataUrl: body.dataUrl,
    gps: body.gps || null, device: body.device || req.headers['x-device'] || 'unknown', note: body.note || '',
  }, ctx.actor));
  return { proof: result };
}, { auth: true });

router.get('/api/v1/proofs/:id/image', async ({ params, res }, { requireAuth: ra }) => {
  await ra();
  const image = await proofs.readImage(params.id);
  if (!image) throw new HttpError(404, 'NOT_FOUND', 'Proof image not found');
  res.writeHead(200, { 'content-type': image.mime, 'cache-control': 'private, max-age=31536000, immutable' });
  res.end(image.buffer);
}, { auth: true, raw: true });

// audit --------------------------------------------------------------------
router.get('/api/v1/audit', async ({ url }, { requireAuth: ra }) => {
  const ctx = await ra();
  const { assertCan } = await import('./domain/permissions.js');
  assertCan(ctx.user.role, 'audit:view');
  const entries = await audit.query({
    orgId: ctx.orgId,
    limit: Number(url.searchParams.get('limit') || 100),
    action: url.searchParams.get('action') || undefined,
    q: url.searchParams.get('q') || undefined,
  });
  return { entries, chain: await audit.verifyChain(ctx.orgId) };
}, { auth: true });

// reports ------------------------------------------------------------------
router.get('/api/v1/reports/:kind', async ({ params, url }, { requireAuth: ra }) => {
  const ctx = await ra();
  const { assertCan } = await import('./domain/permissions.js');
  assertCan(ctx.user.role, params.kind === 'audit' ? 'audit:view' : 'orders:view');
  const from = url.searchParams.get('from') ? Number(url.searchParams.get('from')) : undefined;
  const to = url.searchParams.get('to') ? Number(url.searchParams.get('to')) : undefined;
  const data = await reports.run(params.kind, { orgId: ctx.orgId, from, to });
  if (url.searchParams.get('format') === 'csv') {
    return { __csv: reports.toCsv(Array.isArray(data) ? data : Object.values(data).flat()) };
  }
  return { kind: params.kind, data };
}, { auth: true });

// realtime -----------------------------------------------------------------
router.get('/api/v1/stream', async ({ req, res }, { requireAuth: ra }) => {
  const ctx = await ra();
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  const off = events.subscribe(ctx.orgId, res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 25000);
  req.on('close', () => { clearInterval(ping); off(); });
}, { auth: true, stream: true });

/* ═══════════════════════════════════════════════════════ SERVER */

export async function createApp() {
  await openDb();
  return createServer(async (req, res) => {
    const id = traceId();
    const origin = req.headers.origin;
    const cors = corsHeaders(origin);
    res.setHeader('x-trace-id', id);

    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    const match = router.routes.find((r) => r.method === req.method && r.regex.test(path));
    if (!match) {
      res.writeHead(404, { ...cors, 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${path}`, traceId: id } }));
      return;
    }

    const params = {};
    const values = path.match(match.regex).slice(1);
    match.keys.forEach((k, i) => { params[k] = decodeURIComponent(values[i]); });

    try {
      const context = withAuth(req);
      if (match.opts.auth && !match.opts.stream) await authenticate(req); // fail fast before the body is read
      const result = await match.handler({ req, res, url, params }, context);

      if (match.opts.raw || match.opts.stream) return;   // handler wrote the response
      if (result && result.__csv !== undefined) {
        res.writeHead(200, { ...cors, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="logipilot-report.csv"' });
        res.end(result.__csv);
        return;
      }
      res.writeHead(200, { ...cors, 'content-type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      const { status, body } = toHttp(err, id);
      if (status >= 500) console.error(`[api] ${req.method} ${path}`, err);
      res.writeHead(status, { ...cors, 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    }
  });
}

export async function start() {
  const app = await createApp();
  app.listen(config.port, config.host, () => {
    console.log(`[logipilot-api] listening on http://${config.host}:${config.port} (${config.isProd ? 'production' : 'development'})`);
  });
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start().catch((e) => { console.error('[logipilot-api] failed to start:', e); process.exit(1); });
}