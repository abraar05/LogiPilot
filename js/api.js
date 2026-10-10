/**
 * api.js — the service layer between the LogiPilot UI and the server.
 *
 * Design (offline-first, server-authoritative):
 *  • Reads: local cache first (instant), refreshed from the server when online.
 *  • Writes: applied locally first, pushed through an outbox in order, with
 *    idempotency keys so retries are safe and version checks so concurrent
 *    edits surface as conflicts instead of silent overwrites.
 *  • With no server configured the app is exactly as before: 100% local.
 */
window.SP = window.SP || {};

SP.api = (() => {
  const st = () => SP.store.state;

  /* ────────────────────────────────────────────────────────── config */

  const baseUrl = () => (st().settings.server?.url || '').replace(/\/+$/, '');
  const isConfigured = () => !!baseUrl();
  const token = () => st().settings.server?.token || '';

  /* ───────────────────────────────────────────────────────── outbox */

  /** Queue an operation for the server. Safe to call while offline. */
  function enqueue(op) {
    const item = {
      id: SP.uid('op'),
      key: `${op.kind}:${op.id}`,
      kind: op.kind,
      payload: op.payload,
      at: Date.now(),
      tries: 0,
      lastError: null,
    };
    SP.store.update(['pendingOps'], (s) => {
      s.pendingOps.push(item);
      if (s.pendingOps.length > 500) s.pendingOps.splice(0, s.pendingOps.length - 500);
    }, { silent: true });
    flush();
    return item;
  }

  const pendingCount = () => st().pendingOps.length;
  /** Queued ops the server refused for a non-transient reason. */
  const RETRYABLE = ['OFFLINE', 'TIMEOUT', 'RATE_LIMITED', 'INTERNAL', 'UNAUTHENTICATED', null, undefined];
  const conflicts = () => st().pendingOps.filter((o) => !RETRYABLE.includes(o.lastError));

  /* ─────────────────────────────────────────────────────── transport */

  async function request(method, path, { body, headers = {}, timeoutMs = 12000, raw = false } = {}) {
    const url = `${baseUrl()}${path}`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-device': SP.auth?.deviceLabel?.() || 'unknown',
          ...(token() ? { authorization: `Bearer ${token()}` } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctl.signal,
      });
      if (raw) return res;
      const text = await res.text();
      const json = text ? JSON.parse(text) : {};
      if (!res.ok) {
        const err = new Error(json?.error?.message || `Request failed (${res.status})`);
        err.code = json?.error?.code || 'HTTP_ERROR';
        err.status = res.status;
        throw err;
      }
      return json;
    } catch (e) {
      if (e.name === 'AbortError') { const err = new Error('The server took too long to answer.'); err.code = 'TIMEOUT'; throw err; }
      if (!e.code) { e.code = 'OFFLINE'; e.message = 'Could not reach the server — changes are queued.'; }
      throw e;
    } finally { clearTimeout(timer); }
  }

  /* ────────────────────────────────────────────────────────── auth */

  const auth = {
    async signIn({ email, password, totpCode, remember }) {
      const res = await request('POST', '/api/v1/auth/signin', {
        body: { email, password, totpCode, remember: !!remember },
      });
      SP.store.update(['settings'], (s) => {
        s.settings.server.token = res.token;
        s.settings.server.user = res.user;
        s.settings.server.lastSync = Date.now();
        s.settings.server.connected = true;
        s.settings.server.error = null;
      });
      SP.store.audit('server.signin', email, baseUrl());
      return res.user;
    },
    async signOut() {
      try { await request('POST', '/api/v1/auth/signout'); } catch { /* offline: drop locally anyway */ }
      SP.store.update(['settings'], (s) => { s.settings.server.token = ''; s.settings.server.connected = false; });
    },
    async me() { return (await request('GET', '/api/v1/auth/me')).user; },
    async changePassword(currentPassword, newPassword) {
      return request('POST', '/api/v1/auth/password', { body: { currentPassword, newPassword } });
    },
    async forgot(email) { return request('POST', '/api/v1/auth/password/forgot', { body: { email } }); },
    async reset(token, newPassword) { return request('POST', '/api/v1/auth/password/reset', { body: { token, newPassword } }); },
    async enableTotp() { return request('POST', '/api/v1/auth/totp/enable'); },
    async confirmTotp(code) { return request('POST', '/api/v1/auth/totp/confirm', { body: { code } }); },
  };

  /* ────────────────────────────────────────────────────────── data */

  const orders = {
    list: (params = {}) => request('GET', `/api/v1/orders?${new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''))}`),
    get: (id) => request('GET', `/api/v1/orders/${id}`),
    create: (data) => request('POST', '/api/v1/orders', { body: data, headers: { 'idempotency-key': SP.uid('idem') } }),
    update: (id, data) => request('PATCH', `/api/v1/orders/${id}`, { body: data }),
    assign: (id, field, userId) => request('POST', `/api/v1/orders/${id}/assign`, { body: { field, userId } }),
    packedQty: (id, itemId, qty) => request('POST', `/api/v1/orders/${id}/packed-qty`, { body: { itemId, qty } }),
    transition: (id, to, { proofId, note, expectedVersion } = {}) =>
      request('POST', `/api/v1/orders/${id}/transition`, { body: { to, proofId, note, expectedVersion }, headers: { 'idempotency-key': SP.uid('idem') } }),
    cod: (id, amount) => request('POST', `/api/v1/orders/${id}/cod`, { body: { amount } }),
  };

  const proofs = {
    list: (params = {}) => request('GET', `/api/v1/proofs?${new URLSearchParams(
      Object.entries(params).filter(([, v]) => v))}`),
    upload: (orderId, { stage, dataUrl, gps, note }) =>
      request('POST', `/api/v1/orders/${orderId}/proofs`, { body: { stage, dataUrl, gps, note }, headers: { 'idempotency-key': SP.uid('idem') } }),
    imageUrl: (id) => `${baseUrl()}/api/v1/proofs/${id}/image`,
  };

  const users = {
    list: () => request('GET', '/api/v1/users'),
    create: (data) => request('POST', '/api/v1/users', { body: data }),
    update: (id, patch) => request('PATCH', `/api/v1/users/${id}`, { body: patch }),
    revoke: (id) => request('POST', `/api/v1/users/${id}/revoke`),
  };

  const reports = {
    run: (kind, params = {}) => request('GET', `/api/v1/reports/${kind}?${new URLSearchParams(params)}`),
  };

  const audit = {
    list: (params = {}) => request('GET', `/api/v1/audit?${new URLSearchParams(params)}`),
  };

  /* ────────────────────────────────────────────────────────── push */

  const PUSHERS = {
    'order.create': (op) => orders.create(op.payload),
    'order.transition': (op) => orders.transition(op.payload.id, op.payload.to, op.payload),
    'order.assign': (op) => orders.assign(op.payload.id, op.payload.field, op.payload.userId),
    'order.cod': (op) => orders.cod(op.payload.id, op.payload.amount),
    'order.packedQty': (op) => orders.packedQty(op.payload.id, op.payload.itemId, op.payload.qty),
    'proof.submit': (op) => proofs.upload(op.payload.orderId, op.payload),
    'user.create': (op) => users.create(op.payload),
    'user.update': (op) => users.update(op.payload.id, op.payload.patch),
  };

  let flushing = null;

  /** Push queued operations in order. Stops at the first hard failure.
   *  Guarded by a mutex so two concurrent triggers cannot double-push. */
  function flush() {
    if (flushing) return flushing;
    flushing = _flush().finally(() => { flushing = null; });
    return flushing;
  }

  async function _flush() {
    if (!isConfigured() || !token()) return { pushed: 0 };
    const queue = [...st().pendingOps];
    let pushed = 0;
    if (!queue.length) { SP.api.status.set('online'); return { pushed: 0, pending: 0 }; }
    SP.api.status.set('syncing');

    for (const op of queue) {
      const pusher = PUSHERS[op.kind];
      if (!pusher) { drop(op); continue; }
      try {
        await pusher(op);
        drop(op);
        pushed += 1;
      } catch (e) {
        SP.store.update(['pendingOps'], (s) => {
          const t = s.pendingOps.find((x) => x.id === op.id);
          if (t) { t.tries += 1; t.lastError = e.code || 'ERROR'; }
        }, { silent: true });
        SP.store.update(['settings'], (s) => { s.settings.server.error = e.message; }, { silent: true });
        if (['OFFLINE', 'TIMEOUT', 'RATE_LIMITED', 'INTERNAL'].includes(e.code)) break; // retry later
        // Conflicts / validation stay queued with their reason for the user to resolve
        SP.store.notify({
          tone: e.code === 'CONFLICT' ? 'warn' : 'danger',
          kind: 'sync',
          title: e.code === 'CONFLICT' ? 'Sync conflict' : 'Sync blocked',
          body: `${op.kind}: ${e.message}`,
        });
        break;
      }
    }

    SP.store.update(['settings'], (s) => { s.settings.server.lastSync = Date.now(); }, { silent: true });
    SP.api.status.set(pendingCount() ? 'error' : 'online');
    return { pushed, pending: pendingCount() };
  }

  function drop(op) {
    SP.store.update(['pendingOps'], (s) => { s.pendingOps = s.pendingOps.filter((x) => x.id !== op.id); }, { silent: true });
  }

  function discard(opId) {
    drop({ id: opId });
  }

  /* ─────────────────────────────────────────────────────── realtime */

  let source = null;
  function connectStream() {
    disconnectStream();
    if (!isConfigured() || !token()) return null;
    try {
      source = new EventSource(`${baseUrl()}/api/v1/stream?token=${encodeURIComponent(token())}`);
      source.addEventListener('open', () => SP.api.status.set('online'));
      source.addEventListener('ready', () => SP.api.status.set('online'));
      for (const type of ['order.created', 'order.updated', 'order.transition', 'proof.created']) {
        source.addEventListener(type, (e) => {
          SP.api.status.set('online');
          SP.store.audit('sync.event', type, '', 'server');
          if (type === 'order.updated' || type === 'order.transition' || type === 'order.created') {
            SP.router.refresh?.();
          }
        });
      }
      source.addEventListener('error', () => SP.api.status.set('offline'));
      return source;
    } catch { SP.api.status.set('offline'); return null; }
  }
  function disconnectStream() { try { source?.close(); } catch { /* noop */ } source = null; }

  /* ───────────────────────────────────────────────────────── status */

  const status = {
    _state: isConfigured() ? 'connecting' : 'local',
    listeners: new Set(),
    set(s) {
      this._state = s;
      this.listeners.forEach((fn) => fn(s));
    },
    get() { return this._state; },
    label() {
      return ({
        local: 'Local only', connecting: 'Connecting…', online: 'Synced with server',
        syncing: 'Syncing…', offline: 'Offline — queued', error: 'Sync needs attention',
      })[this._state];
    },
    on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  };

  /* ────────────────────────────────────────────────────────── probe */

  async function health() {
    if (!isConfigured()) return { ok: false, reason: 'No server configured' };
    try {
      const res = await request('GET', '/api/v1/health', { timeoutMs: 6000 });
      return { ok: true, ...res };
    } catch (e) { return { ok: false, reason: e.message }; }
  }

  async function connect(url) {
    const probe = await (async () => {
      try {
        const res = await fetch(`${url.replace(/\/+$/, '')}/api/v1/health`, { headers: { accept: 'application/json' } });
        return res.ok ? await res.json() : null;
      } catch { return null; }
    })();
    if (!probe) {
      SP.store.update(['settings'], (s) => { s.settings.server.url = url; s.settings.server.connected = false; s.settings.server.error = 'Could not reach that URL.'; }, { silent: true });
      return { ok: false, error: 'Could not reach that URL.' };
    }
    SP.store.update(['settings'], (s) => {
      s.settings.server.url = url;
      s.settings.server.connected = true;
      s.settings.server.error = null;
      s.settings.server.health = probe;
    }, { silent: true });
    status.set('online');
    return { ok: true, health: probe };
  }

  async function disconnect() {
    disconnectStream();
    SP.store.update(['settings'], (s) => { s.settings.server.url = ''; s.settings.server.token = ''; s.settings.server.connected = false; }, { silent: true });
    status.set('local');
  }

  /* auto-retry + auto-reconnect on connectivity events */
  if (typeof addEventListener === 'function') {
    addEventListener('online', () => { if (isConfigured()) flush(); });
    setInterval(() => { if (isConfigured() && pendingCount()) flush(); }, 20000);
  }

  return {
    baseUrl, isConfigured, token, status, enqueue, flush, pendingCount, conflicts, discard,
    auth, orders, proofs, users, reports, audit,
    connect, disconnect, health, connectStream, disconnectStream,
  };
})();