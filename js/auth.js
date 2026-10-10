/**
 * auth.js — users, roles, sessions, lockout and the sign-in gate.
 * Passwords and PINs are stored only as PBKDF2-SHA256 verifiers.
 */
window.SP = window.SP || {};

SP.auth = (() => {
  const SESSION_KEY = SP.SESSION_KEY;
  const MAX_ATTEMPTS = 5;
  const LOCK_MS = 60 * 1000;
  const SESSION_MS = 12 * 60 * 60 * 1000;
  const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;

  let current = null;
  let session = null;
  const failures = new Map();

  /* ─────────────────────────────────────────────────────── bootstrap */

  async function ensureSeedUsers() {
    const s = SP.store.state;
    if (s.users.length) return;
    const mk = async (name, email, role, password, pin, phone = '') => ({
      id: SP.uid('usr'),
      name,
      email: email.toLowerCase(),
      phone,
      role,
      password: await SP.crypto.hashPassword(password),
      pin: pin ? await SP.crypto.hashPin(pin) : null,
      active: true,
      createdAt: Date.now(),
      lastLoginAt: null,
      failedCount: 0,
      lockedUntil: 0,
      sessions: [],
      colour: randomColour(),
    });
    s.users.push(
      await mk('Admin', 'admin@logipilot.app', 'admin', 'Admin@1234', null, '01700000001'),
      await mk('Supervisor', 'super@logipilot.app', 'supervisor', 'Super@1234', '2468', '01700000002'),
      await mk('Packer One', 'packer@logipilot.app', 'packer', 'Pack@1234', '1357', '01700000003'),
      await mk('QC Approver', 'qc@logipilot.app', 'approver', 'Qc@12345', '9753', '01700000004'),
      await mk('Driver One', 'driver@logipilot.app', 'driver', 'Drive@1234', '1111', '01700000005'),
      await mk('Delivery Man', 'delivery@logipilot.app', 'delivery', 'Deliver@123', '2222', '01700000006'),
    );
    SP.store.saveNow();
    console.info('[auth] seeded demo accounts — delete before production use.');
  }

  /* ─────────────────────────────────────────────────────── lookup */

  const byEmail = (email) => SP.store.state.users.find((u) => u.email === String(email || '').trim().toLowerCase());
  const byId = (id) => SP.store.state.users.find((u) => u.id === id);
  const byRole = (role) => SP.store.state.users.filter((u) => u.role === role && u.active);

  const current_ = () => current;
  const isSignedIn = () => !!current;
  const roleOf = (user) => SP.store.state.users.find((u) => u.id === user.id)?.role || user?.role || 'packer';
  const roleDef = (roleId) => {
    const def = SP.ROLES.find((r) => r.id === roleId) || SP.ROLES[0];
    return { ...def, get label() { return SP.i18n ? SP.i18n.roleLabel(def.id) : def.label; } };
  };
  const permsOf = (roleId) => roleDef(roleId).perms;

  const can = (perm, user = current) => {
    if (!user) return false;
    const perms = permsOf(roleOf(user));
    return perms.includes('*') || perms.includes(perm);
  };

  /* ────────────────────────────────────────────────────── sessions */

  function persistSession() {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* noop */ }
    try { if (session.remember) localStorage.setItem(`${SESSION_KEY}.remember`, JSON.stringify(session)); } catch { /* noop */ }
  }

  function readSession(remember) {
    const raw = (remember ? localStorage : sessionStorage).getItem(`${SESSION_KEY}${remember ? '.remember' : ''}`);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  function clearStoredSession() {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(`${SESSION_KEY}.remember`);
  }

  function deviceLabel() {
    const ua = navigator.userAgent;
    const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'macOS' : 'Linux';
    const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Firefox';
    return `${os} · ${br}`;
  }

  async function restore() {
    const s = readSession(false) || readSession(true);
    if (!s || !s.expiresAt) return null;
    if (s.expiresAt < Date.now()) { clearStoredSession(); return null; }
    const user = byId(s.userId);
    if (!user || !user.active) { clearStoredSession(); return null; }
    if (Array.isArray(user.sessions) && user.sessions.length && !user.sessions.some((x) => x.token === s.token)) {
      clearStoredSession(); return null;
    }
    current = user;
    session = s;
    return user;
  }

  /* ─────────────────────────────────────────────────────── sign in */

  async function signIn(email, password, opts = {}) {
    const mail = String(email || '').trim().toLowerCase();
    const fail = failures.get(mail) || { count: 0, until: 0 };
    if (fail.until > Date.now()) {
      return { ok: false, error: `Too many attempts. Try again in ${Math.ceil((fail.until - Date.now()) / 1000)}s.` };
    }
    const user = byEmail(mail);
    const generic = 'Email or password is incorrect.';
    if (!user) {
      await SP.crypto.hashPassword(password || '', 'AAAAAAAAAAAAAAAAAAAAAA==');
      bumpFailure(mail);
      return { ok: false, error: generic };
    }
    if (!user.active) return { ok: false, error: 'This account has been deactivated.' };
    if (user.lockedUntil && user.lockedUntil > Date.now()) {
      return { ok: false, error: `Account locked. Try again in ${Math.ceil((user.lockedUntil - Date.now()) / 1000)}s.` };
    }
    const ok = await SP.crypto.verifyRecord(user.password, password);
    if (!ok) {
      bumpFailure(mail);
      return { ok: false, error: (failures.get(mail)?.count || 0) >= MAX_ATTEMPTS - 1 ? 'Too many failed attempts. Account locked for 60s.' : generic };
    }
    failures.delete(mail);
    return { ok: true, user: await completeSignIn(user, { remember: opts.remember }) };
  }

  function bumpFailure(mail) {
    const rec = failures.get(mail) || { count: 0, until: 0 };
    rec.count += 1;
    if (rec.count >= MAX_ATTEMPTS) {
      rec.until = Date.now() + LOCK_MS;
      rec.count = 0;
      SP.store.audit('auth.lockout', mail, `Locked after ${MAX_ATTEMPTS} failed attempts`);
      SP.store.notify({ tone: 'danger', title: 'Repeated sign-in failures', body: `${mail} was locked after ${MAX_ATTEMPTS} attempts.` });
    }
    failures.set(mail, rec);
  }

  async function completeSignIn(user, { remember, viaPin = false } = {}) {
    const token = SP.crypto.randomToken();
    const now = Date.now();
    const lifetime = remember ? REMEMBER_MS : SESSION_MS;
    session = { token, userId: user.id, startedAt: now, expiresAt: now + lifetime, device: deviceLabel(), viaPin, remember: !!remember };
    current = user;
    persistSession();
    SP.store.update(['users'], (st) => {
      const t = st.users.find((x) => x.id === user.id);
      if (!t) return;
      t.lastLoginAt = now;
      t.lockedUntil = 0;
      t.sessions = (t.sessions || []).filter((x) => x.expiresAt > now);
      t.sessions.push({ token, startedAt: now, expiresAt: now + lifetime, device: session.device });
      if (t.sessions.length > 8) t.sessions = t.sessions.slice(-8);
    });
    SP.store.audit('auth.signin', user.email, `${session.device}${viaPin ? ' · PIN' : ''}`);
    return current;
  }

  async function signInWithPin(userId, pin) {
    const user = byId(userId);
    if (!user) return { ok: false, error: 'Profile not found.' };
    if (!user.pin) return { ok: false, error: 'No PIN is set for this profile.' };
    if (!user.active) return { ok: false, error: 'This account has been deactivated.' };
    if (user.lockedUntil && user.lockedUntil > Date.now()) return { ok: false, error: 'Account locked. Use your password.' };
    const ok = await SP.crypto.verifyRecord(user.pin, pin);
    if (!ok) { bumpFailure(user.email); return { ok: false, error: 'Incorrect PIN.' }; }
    failures.delete(user.email);
    return { ok: true, user: await completeSignIn(user, { remember: true, viaPin: true }) };
  }

  function signOut({ all = false } = {}) {
    const user = current;
    if (user) {
      SP.store.update(['users'], (st) => {
        const t = st.users.find((x) => x.id === user.id);
        if (!t) return;
        if (all) t.sessions = [];
        else t.sessions = (t.sessions || []).filter((x) => x.token !== session?.token);
      });
      SP.store.audit('auth.signout', user.email, all ? 'All devices' : session?.device || '');
    }
    clearStoredSession();
    current = null;
    session = null;
  }

  /* ──────────────────────────────────────────────── user management */

  async function createUser(data) {
    const email = String(data.email || '').trim().toLowerCase();
    if (byEmail(email)) throw new Error('A user with that email already exists.');
    if (!data.name?.trim()) throw new Error('Name is required.');
    const strength = SP.crypto.strength(data.password);
    if (strength.score < 2) throw new Error('Choose a stronger password (at least 8 characters).');
    const user = {
      id: SP.uid('usr'),
      name: data.name.trim(),
      email,
      phone: data.phone || '',
      role: data.role || 'packer',
      password: await SP.crypto.hashPassword(data.password),
      pin: /^\d{4}$/.test(String(data.pin || '')) ? await SP.crypto.hashPin(String(data.pin)) : null,
      active: true,
      createdAt: Date.now(),
      lastLoginAt: null,
      failedCount: 0,
      lockedUntil: 0,
      sessions: [],
      colour: data.colour || randomColour(),
    };
    SP.store.update(['users'], (st) => { st.users.push(user); });
    SP.store.audit('user.create', email, `role=${user.role}`);
    SP.api?.enqueue?.({ kind: 'user.create', id: user.id, payload: { name: user.name, email: user.email, phone: user.phone, role: user.role, password: data.password } });
    return user;
  }

  async function updateUser(id, patch) {
    const u = byId(id);
    if (!u) throw new Error('User not found.');
    if (patch.email && patch.email !== u.email && byEmail(patch.email)) throw new Error('That email is already in use.');
    if (patch.password) {
      const s = SP.crypto.strength(patch.password);
      if (s.score < 2) throw new Error('Choose a stronger password.');
      patch.password = await SP.crypto.hashPassword(patch.password);
    }
    if (patch.pin !== undefined) {
      patch.pin = patch.pin === '' || patch.pin === null ? null : await SP.crypto.hashPin(String(patch.pin));
    }
    if (patch.role && u.id === current?.id && patch.role !== 'admin') {
      const admins = SP.store.state.users.filter((x) => x.role === 'admin' && x.active);
      if (admins.length <= 1) throw new Error('You cannot demote the last active admin.');
    }
    SP.store.update(['users'], (st) => {
      const t = st.users.find((x) => x.id === id);
      if (t) Object.assign(t, patch);
    });
    SP.store.audit('user.update', u.email, Object.keys(patch).filter((k) => !['password', 'pin'].includes(k)).join(', '));
    return byId(id);
  }

  function revokeSessions(id) {
    SP.store.update(['users'], (st) => {
      const t = st.users.find((x) => x.id === id);
      if (t) t.sessions = [];
    });
    SP.store.audit('user.revoke', (byId(id) || {}).email, 'All sessions revoked');
    if (id === current?.id) { clearStoredSession(); current = null; session = null; }
  }

  async function deleteUser(id) {
    const u = byId(id);
    if (!u) return;
    if (u.id === current?.id) throw new Error('You cannot delete your own account.');
    const admins = SP.store.state.users.filter((x) => x.role === 'admin' && x.active);
    if (u.role === 'admin' && admins.length <= 1) throw new Error('You cannot delete the last active admin.');
    SP.store.update(['users'], (st) => { st.users = st.users.filter((x) => x.id !== id); });
    SP.store.audit('user.delete', u.email, 'Account removed');
  }

  function toggleActive(id) {
    const u = byId(id);
    if (!u) return;
    if (u.id === current?.id) throw new Error('You cannot deactivate your own account.');
    const next = !u.active;
    updateUser(id, { active: next });
    if (!next) revokeSessions(id);
  }

  async function setPin(id, pin) {
    const clean = String(pin || '').replace(/\D/g, '');
    if (clean.length !== 4) throw new Error('PIN must be exactly 4 digits.');
    return updateUser(id, { pin: clean });
  }

  async function changeOwnPassword(oldPassword, newPassword) {
    if (!current) throw new Error('Not signed in.');
    const ok = await SP.crypto.verifyRecord(current.password, oldPassword);
    if (!ok) throw new Error('Your current password is incorrect.');
    const s = SP.crypto.strength(newPassword);
    if (s.score < 2) throw new Error('Choose a stronger password.');
    await updateUser(current.id, { password: newPassword });
    SP.store.audit('user.password', current.email, 'Password changed');
    return true;
  }

  /* ──────────────────────────────────────────────────── misc helpers */

  const PALETTE = ['#5b8cff', '#a78bfa', '#34d399', '#fbbf24', '#f87171', '#38bdf8', '#fb7185', '#4ade80'];
  const randomColour = () => PALETTE[Math.floor(Math.random() * PALETTE.length)];

  const sessionInfo = () => (session ? { ...session, ageMs: Date.now() - session.startedAt, remainingMs: session.expiresAt - Date.now() } : null);

  return {
    ensureSeedUsers, restore, signIn, signInWithPin, signOut,
    current: current_, isSignedIn, can, roleOf, roleDef, permsOf,
    byEmail, byId, byRole, createUser, updateUser, deleteUser, toggleActive,
    changeOwnPassword, setPin, revokeSessions, sessionInfo, deviceLabel, randomColour,
    get session() { return session; },
    get currentUser() { return current; },
  };
})();
