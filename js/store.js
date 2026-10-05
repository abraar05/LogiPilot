/**
 * store.js — reactive application state with persistence and audit trail.
 *
 * Schema v1:
 *   users, orders (with items/history/assignments), proofs (immutable
 *   stamped photos), notifications, audit, settings, prefs.
 */
window.SP = window.SP || {};

SP.store = (() => {
  const KEY = SP.STORAGE_KEY;
  const listeners = new Set();
  let saveTimer = null;
  let lastError = null;

  function defaultSettings() {
    return {
      company: { name: 'LogiPilot Workspace', address: '', phone: '' },
      numbering: { order: 'SO', proof: 'PRF' },
      requireGps: false,          // when true, proofs without GPS are rejected
      allowSelfAssign: true,      // staff may claim open orders
      qcRequiresPhoto: true,
      deliveryRequiresPhoto: true,
      demo: false,
    };
  }

  function defaultState() {
    return {
      schema: 1,
      rev: 0,
      createdAt: Date.now(),
      onboarded: false,
      prefs: { theme: 'dark', density: 'comfortable', accent: '#5b8cff', seenTips: [] },
      settings: defaultSettings(),

      users: [],       // { id, name, email, phone, role, active, password, pin, createdAt, lastLoginAt, sessions[], colour }
      orders: [],      // { id, ref, customer{name,phone,address}, items[{id,name,sku,qty,packedQty,barcode}], status, packerId, qcId, driverId, deliveryId, notes, priority, history[{at,by,action,note,proofId}], createdAt, updatedAt, dueAt }
      proofs: [],      // { id, ref, orderId, orderRef, stage, byId, byName, role, at, dataUrl, stamp{text,gps,device}, note, immutable }
      notifications: [],
      audit: [],
      counters: { order: 0, proof: 0 },
    };
  }

  let state = defaultState();

  /* ─────────────────────────────────────────────────────── persistence */

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return false;
      state = migrate({ ...defaultState(), ...parsed });
      return true;
    } catch (e) {
      lastError = e;
      console.warn('[store] load failed, starting fresh:', e);
      return false;
    }
  }

  function migrate(s) {
    const base = defaultState();
    for (const k of Object.keys(base)) {
      if (s[k] === undefined) s[k] = base[k];
      else if (!Array.isArray(base[k]) && typeof base[k] === 'object' && base[k] !== null) {
        s[k] = { ...base[k], ...s[k] };
      }
    }
    s.prefs = { ...base.prefs, ...s.prefs };
    s.settings = { ...base.settings, ...s.settings, company: { ...base.settings.company, ...(s.settings?.company || {}) } };
    s.schema = 1;
    return s;
  }

  function saveNow() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      lastError = null;
      return true;
    } catch (e) {
      lastError = e;
      // Photo proofs are the biggest payload. Never drop them silently —
      // warn loudly so the user can export a backup and purge old proofs.
      SP.ui?.toast({ tone: 'danger', title: 'Local storage is full', body: 'Export a backup, then purge old proofs in Settings → Data.' });
      return false;
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 180);
  }

  /* ────────────────────────────────────────────────────── subscriptions */

  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  function emit(changed) {
    const set = new Set(changed && changed.length ? changed : ['*']);
    for (const fn of listeners) {
      try { fn(state, set); } catch (e) { console.error('[store] subscriber failed', e); }
    }
  }

  function update(keys, mutator, opts = {}) {
    if (typeof keys === 'function') { mutator = keys; keys = null; opts = {}; }
    const result = mutator ? mutator(state) : undefined;
    state.rev += 1;
    scheduleSave();
    if (!opts.silent) emit(keys);
    return result;
  }

  /* ─────────────────────────────────────────────── references & audit */

  function nextRef(kind) {
    const prefix = state.settings.numbering[kind] || kind.toUpperCase().slice(0, 3);
    state.counters[kind] = (state.counters[kind] || 0) + 1;
    return `${prefix}-${String(state.counters[kind]).padStart(4, '0')}`;
  }

  function audit(action, target, detail, by) {
    state.audit.unshift({
      id: SP.uid('aud'),
      at: Date.now(),
      by: by || SP.auth?.current()?.name || 'system',
      userId: SP.auth?.current()?.id || null,
      action, target: target || '', detail: detail || '',
    });
    if (state.audit.length > 8000) state.audit.length = 8000;
    return state.audit[0];
  }

  function notify(n) {
    const note = {
      id: SP.uid('ntf'), at: Date.now(), read: false,
      tone: 'info', title: '', body: '', route: null, ...n,
    };
    state.notifications.unshift(note);
    if (state.notifications.length > 200) state.notifications.length = 200;
    return note;
  }

  /* ─────────────────────────────────────────────────────── backup/restore */

  function exportBackup() {
    return {
      app: 'LogiPilot', version: SP.VERSION, schema: 1,
      exportedAt: new Date().toISOString(),
      state,
    };
  }

  function importBackup(payload) {
    if (!payload || payload.app !== 'LogiPilot' || !payload.state) throw new Error('Not a LogiPilot backup file.');
    state = migrate(payload.state);
    scheduleSave();
    emit(['*']);
    return true;
  }

  function reset({ keepUsers = true } = {}) {
    const users = keepUsers ? state.users : [];
    state = defaultState();
    state.users = users;
    saveNow();
    emit(['*']);
  }

  return {
    get state() { return state; },
    get rev() { return state.rev; },
    get lastError() { return lastError; },
    load, saveNow, subscribe, update, audit, notify, nextRef,
    exportBackup, importBackup, reset, migrate, defaultState,
  };
})();
