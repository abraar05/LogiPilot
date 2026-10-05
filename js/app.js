/**
 * app.js — LogiPilot bootstrap, chrome, auth gate, palette and lifecycle.
 */
window.SP = window.SP || {};

SP.app = (() => {
  let navOpen = false;
  let paletteIndex = 0;

  const $ = (id) => document.getElementById(id);

  async function start() {
    hint('Loading your workspace…');
    try { SP.store.load(); } catch (e) { console.warn('[boot] store', e); }

    hint('Preparing accounts…');
    await SP.auth.ensureSeedUsers();

    // First run: demo workspace so every screen is explorable.
    if (!SP.store.state.orders.length) {
      hint('Loading demo orders…');
      try { SP.seedDemo.run(); SP.store.saveNow(); } catch (e) { console.warn('[seed]', e); }
    }

    hint('Restoring session…');
    const user = await SP.auth.restore();

    applyTheme();
    wireChrome();
    wireKeyboard();
    wireOnline();

    if (user) enterApp(user);
    else showAuth();

    setTimeout(() => document.getElementById('boot')?.classList.add('is-done'), 260);
  }

  function hint(text) {
    const n = document.getElementById('bootHint');
    if (n) n.textContent = text;
  }

  /* ═════════════════════════════════════════════════════════════ AUTH */

  function showAuth() {
    $('app').hidden = true;
    $('auth').hidden = false;
    document.documentElement.dataset.theme = currentTheme();
  }

  async function enterApp(user) {
    $('auth').hidden = true;
    $('app').hidden = false;
    $('app').classList.add('is-booting');
    document.getElementById('avatarInitials').textContent = SP.fmt.initials(user.name);

    SP.router.registerAll(SP.modules);
    buildNav();
    SP.router.start(paintChrome);
    requestAnimationFrame(() => { $('app').classList.remove('is-booting'); });

    refreshAlerts();
    SP.announce(`Signed in as ${user.name}`);
  }

  function signOut() {
    SP.auth.signOut();
    location.hash = '';
    showAuth();
    SP.ui.toast({ tone: 'info', title: 'Signed out' });
  }

  /* ═══════════════════════════════════════════════════════ NAV */

  function buildNav() {
    const navHost = document.getElementById('sidenavLinks');
    const tabHost = document.getElementById('tabbar');
    SP.clear(navHost);
    SP.clear(tabHost);

    for (const group of SP.NAV) {
      const visible = group.items.filter((i) => !i.perm || SP.auth.can(i.perm));
      if (!visible.length) continue;
      navHost.appendChild(SP.el('div.sidenav__group', group.group));
      for (const item of visible) {
        navHost.appendChild(SP.el('button.navlink', {
          type: 'button', dataset: { route: item.route },
          onclick: () => { SP.router.go(item.route); closeNav(); },
        },
          SP.icon(item.icon),
          SP.el('span.grow', item.label),
          SP.el('span.navlink__count', { dataset: { role: item.route }, hidden: true }, '')));
      }
    }

    for (const key of SP.TABS) {
      if (key === 'more') {
        tabHost.appendChild(SP.el('button.tab', { type: 'button', dataset: { tab: '__more' }, onclick: openMoreSheet }, SP.icon('menu'), SP.el('span', 'More')));
        continue;
      }
      const item = SP.NAV.flatMap((g) => g.items).find((i) => i.route === key && i.tab);
      if (!item) continue;
      if (item.perm && !SP.auth.can(item.perm)) continue;
      tabHost.appendChild(SP.el('button.tab', {
        type: 'button', dataset: { tab: key },
        onclick: () => { SP.router.go(key); },
      }, SP.icon(item.icon), SP.el('span', item.label)));
    }
  }

  function openMoreSheet() {
    const body = SP.el('div.stacklist');
    const shell = SP.sheet({ title: 'All modules', content: body });
    for (const group of SP.NAV) {
      const visible = group.items.filter((i) => !i.perm || SP.auth.can(i.perm));
      if (!visible.length) continue;
      body.appendChild(SP.el('div.sidenav__group', { style: { padding: '8px 4px 2px' } }, group.group));
      body.appendChild(SP.el('div.grid.grid--3.gap-2', ...visible.map((i) => SP.el('button.card.card--pad', {
        type: 'button', style: { textAlign: 'center' },
        onclick: () => { shell.close(); SP.router.go(i.route); },
      },
        SP.el('span.lrow__ico', { style: { margin: '0 auto var(--sp-2)' } }, SP.icon(i.icon)),
        SP.el('strong', { style: { fontSize: 'var(--fs-sm)', display: 'block' } }, i.label)))));
    }
  }

  const toggleNav = () => { navOpen ? closeNav() : openNav(); };
  function openNav() {
    navOpen = true;
    $('app').classList.add('is-nav-open');
    document.getElementById('navScrim').hidden = false;
    document.querySelector('.appbar__icon--menu').setAttribute('aria-expanded', 'true');
  }
  function closeNav() {
    navOpen = false;
    $('app').classList.remove('is-nav-open');
    document.getElementById('navScrim').hidden = true;
    document.querySelector('.appbar__icon--menu')?.setAttribute('aria-expanded', 'false');
  }

  /* ═════════════════════════════════════════════════════════ CHROME */

  function paintChrome() {
    const route = SP.router.route;
    const mod = SP.router.get(route);
    const s = SP.store.state;

    document.getElementById('appbarTitle').textContent = mod?.title || 'LogiPilot';
    const subtitle = typeof mod?.subtitle === 'function' ? mod.subtitle() : (mod?.subtitle || '');
    document.getElementById('appbarSub').textContent = subtitle;
    document.title = `${mod?.title || 'LogiPilot'} · LogiPilot`;

    SP.$$('.navlink').forEach((n) => n.classList.toggle('is-active', n.dataset.route === route));
    SP.$$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === route));

    const q = SP.orders.queues();
    const counts = { packing: q.toPack.length, qc: q.qcQueue.length, delivery: s.orders.filter((o) => o.status === 'out_for_delivery').length };
    SP.$$('.navlink__count').forEach((n) => {
      const v = counts[n.dataset.role] || 0;
      n.textContent = v ? SP.fmt.n(v) : '';
      n.hidden = !v;
      n.classList.toggle('navlink__count--alert', n.dataset.role === 'qc' && v > 0);
    });
    SP.$$('.tab').forEach((t) => {
      t.querySelector('.tab__dot')?.remove();
      const v = counts[t.dataset.tab] || 0;
      if (v > 0) t.appendChild(SP.el('span.tab__dot'));
    });
    paintConnection();
  }

  function paintConnection() {
    const pill = document.getElementById('connPill');
    if (!pill) return;
    const online = navigator.onLine;
    pill.dataset.state = online ? 'live' : 'offline';
    pill.querySelector('.conn__text').textContent = online ? 'On device' : 'Offline — saved locally';
  }

  function refreshAlerts() {
    const unread = SP.store.state.notifications.filter((n) => !n.read).length;
    const badge = document.getElementById('alertBadge');
    if (badge) {
      badge.textContent = SP.fmt.n(unread);
      badge.hidden = unread === 0;
    }
  }

  function openAlerts() {
    const s = SP.store.state;
    const body = SP.el('div.stacklist');
    const mine = s.notifications;
    if (!mine.length) {
      body.appendChild(SP.empty({ icon: 'bell', title: 'No notifications', body: 'Assignments and chain events land here.' }));
    } else {
      mine.forEach((n) => {
        body.appendChild(SP.el('button.lrow', {
          type: 'button',
          onclick: () => {
            shell.close();
            SP.store.update(['notifications'], (st) => { const t = st.notifications.find((x) => x.id === n.id); if (t) t.read = true; }, { silent: true });
            refreshAlerts();
            if (n.route) SP.router.go(n.route);
          },
        },
          SP.el('span.lrow__ico', { style: { background: n.read ? 'var(--surface-3)' : 'var(--info-soft, var(--accent-soft))' } }, SP.icon('bell')),
          SP.el('div.lrow__main', SP.el('strong', n.title), SP.el('small', n.body)),
          SP.el('span.tiny.mute', SP.fmt.ago(n.at))));
      });
      body.appendChild(SP.el('button.btn.btn--ghost.btn--block', {
        type: 'button',
        onclick: () => {
          SP.store.update(['notifications'], (st) => { st.notifications.forEach((n) => { n.read = true; }); });
          refreshAlerts();
          shell.close();
        },
      }, 'Mark all as read'));
    }
    const shell = SP.sheet({ title: 'Notifications', content: body });
  }

  function openAccount() {
    const u = SP.auth.currentUser;
    const info = SP.auth.sessionInfo();
    const shell = SP.sheet({
      title: 'Account',
      content: SP.el('div.stacklist',
        SP.el('div.row.gap-3',
          SP.avatar(u, 'xl'),
          SP.el('div.grow',
            SP.el('strong', { style: { fontSize: 'var(--fs-lg)' } }, u.name),
            SP.el('p.tiny.mute', u.email),
            SP.el('div.row.gap-1', { style: { marginTop: '6px' } }, SP.el('span.tag.tag--brand', SP.auth.roleDef(u.role).label)))),
        SP.el('dl.kv', { style: { marginTop: 'var(--sp-3)' } },
          SP.el('dt', 'Device'), SP.el('dd', info?.device || '—'),
          SP.el('dt', 'Session expires'), SP.el('dd', info ? SP.fmt.dateTime(info.expiresAt) : '—'),
          SP.el('dt', 'Security'), SP.el('dd', SP.crypto.isPBKDF2() ? 'PBKDF2-SHA256' : 'Fallback digest'))),
      actions: [
        SP.el('button.btn.btn--ghost', { type: 'button', onclick: () => { shell.close(); SP.router.go('settings'); } }, SP.icon('cog'), 'Settings'),
        SP.el('button.btn.btn--danger', { type: 'button', onclick: () => { shell.close(); signOut(); } }, SP.icon('logout'), 'Sign out'),
      ],
    });
  }

  /* ══════════════════════════════════════════════════════ THEME */

  const currentTheme = () => {
    const mode = localStorage.getItem('logipilot.themeMode') || SP.store.state.prefs.theme || 'dark';
    if (mode !== 'auto') return mode;
    return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  };

  function setThemeMode(mode) {
    localStorage.setItem('logipilot.themeMode', mode);
    SP.store.update(['prefs'], (st) => { st.prefs.theme = mode; }, { silent: true });
    applyTheme();
  }

  function applyTheme() {
    document.documentElement.dataset.theme = currentTheme();
  }

  /* ══════════════════════════════════════════════════ SEARCH / CMDS */

  function openPalette(initial = '') {
    $('palette').hidden = false;
    const input = $('paletteInput');
    input.value = initial;
    paletteIndex = 0;
    renderPalette(initial);
    setTimeout(() => input.focus(), 40);
  }
  function closePalette() { $('palette').hidden = true; }

  function renderPalette(query) {
    const results = $('paletteResults');
    SP.clear(results);
    const q = query.trim();
    const ql = q.toLowerCase();
    const groups = [];

    const pages = SP.NAV.flatMap((g) => g.items)
      .filter((i) => !i.perm || SP.auth.can(i.perm))
      .filter((i) => !q || SP.score(q, i.label) > 0)
      .map((i) => ({ label: i.label, sub: 'Module', icon: i.icon, run: () => SP.router.go(i.route) }));
    if (pages.length) groups.push({ name: 'Go to', items: pages.slice(0, 6) });

    if (q.length >= 1) {
      const orders = SP.store.state.orders
        .map((o) => ({ o, score: Math.max(SP.score(q, o.ref), SP.score(q, o.customer.name) * 0.9, SP.score(q, o.customer.phone) * 0.8, SP.score(q, o.items.map((i) => i.name).join(' ')) * 0.7) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 6)
        .map(({ o }) => ({
          label: `${o.ref} · ${o.customer.name}`,
          sub: `${SP.statusOf(o.status).label} · ${SP.sum(o.items, (i) => i.qty)} units`,
          icon: 'file',
          run: () => SP.modules.orders.openOrder(o.id),
        }));
      if (orders.length) groups.push({ name: 'Orders', items: orders });
    }

    const actions = [
      { label: 'Scan order / item', icon: 'target', run: async () => { const c = await SP.scan.open(); if (!c) return; const h = SP.scan.resolve(c); if (h.order) SP.modules.orders.openOrder(h.order.id); else SP.ui.toast({ tone: 'warn', title: 'Unknown code', body: c }); } },
      { label: 'New sales order', icon: 'plus', perm: 'orders:create', run: () => SP.modules.orders.createForm() },
      { label: 'My packing queue', icon: 'box', perm: 'pack:perform', run: () => SP.router.go('packing') },
      { label: 'QC queue', icon: 'checkCircle', perm: 'qc:perform', run: () => SP.router.go('qc') },
      { label: 'My deliveries', icon: 'truck', perm: 'deliver:perform', run: () => SP.router.go('delivery') },
      { label: 'Export orders CSV', icon: 'download', perm: 'orders:export', run: () => SP.router.go('orders') },
      { label: 'Download backup', icon: 'save', run: () => SP.download(JSON.stringify(SP.store.exportBackup(), null, 2), `logipilot-backup-${Date.now()}.json`) },
      { label: `Switch to ${currentTheme() === 'dark' ? 'light' : 'dark'} theme`, icon: currentTheme() === 'dark' ? 'sun' : 'moon', run: () => setThemeMode(currentTheme() === 'dark' ? 'light' : 'dark') },
      { label: 'Sign out', icon: 'logout', run: () => signOut() },
    ].filter((a) => !a.perm || SP.auth.can(a.perm))
      .filter((a) => !q || SP.score(q, a.label) > 0)
      .map((a) => ({ ...a, sub: 'Action' }));
    if (actions.length) groups.push({ name: 'Actions', items: actions.slice(0, 6) });

    if (!groups.length) {
      results.appendChild(SP.el('div.palette__empty', `No results for “${query}”`));
      return;
    }

    const items = [];
    for (const g of groups) {
      results.appendChild(SP.el('div.palette__group', g.name));
      for (const item of g.items) {
        items.push(item);
        results.appendChild(SP.el('button.pal-item', {
          type: 'button',
          onclick: () => { closePalette(); item.run(); },
        },
          SP.el('span.pal-item__ico', SP.icon(item.icon || 'file')),
          SP.el('div.pal-item__main', SP.el('strong', item.label), SP.el('small', item.sub))));
      }
    }
    highlight(0, items);
  }

  let paletteItems = [];
  function highlight(i, items) {
    paletteItems = items || paletteItems;
    const nodes = SP.$$('.pal-item', $('paletteResults'));
    nodes.forEach((n, k) => n.classList.toggle('is-sel', k === i));
    if (nodes[i]) nodes[i].scrollIntoView({ block: 'nearest' });
    paletteIndex = Math.max(0, Math.min(i, nodes.length - 1));
  }

  /* ═══════════════════════════════════════════════════════ WIRING */

  function wireChrome() {
    SP.on('[data-action="toggle-nav"]', 'click', toggleNav);
    SP.on('#navScrim', 'click', closeNav);
    SP.on('[data-action="open-search"]', 'click', () => openPalette());
    SP.on('[data-action="open-alerts"]', 'click', openAlerts);
    SP.on('[data-action="open-account"]', 'click', openAccount);
    SP.on('[data-action="scan"]', 'click', async () => {
      const c = await SP.scan.open();
      if (!c) return;
      const h = SP.scan.resolve(c);
      if (h.order) SP.modules.orders.openOrder(h.order.id);
      else SP.ui.toast({ tone: 'warn', title: 'Unknown code', body: c });
    });
    SP.on('[data-action="toggle-theme"]', 'click', () => setThemeMode(currentTheme() === 'dark' ? 'light' : 'dark'));
    SP.on('[data-action="open-request"]', 'click', () => {
      SP.ui.toast({ tone: 'info', title: 'Ask an administrator', body: 'Accounts are created in Users & Assignment.' });
    });

    SP.$$('[data-toggle-password]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.togglePassword);
        const on = input.type === 'password';
        input.type = on ? 'text' : 'password';
        SP.clear(btn);
        btn.appendChild(SP.icon(on ? 'eyeOff' : 'eye'));
      });
    });

    SP.$$('[data-authtab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        SP.$$('[data-authtab]').forEach((b) => {
          const on = b === btn;
          b.classList.toggle('is-active', on);
          b.setAttribute('aria-selected', String(on));
        });
        SP.$$('[data-authtabpanel]').forEach((p) => { p.hidden = p.dataset.authtabpanel !== btn.dataset.authtab; });
        document.getElementById('signinSubmit').hidden = btn.dataset.authtab === 'pin';
      });
    });

    wireSignIn();
    wirePinPad();
    wirePalette();
  }

  function wireSignIn() {
    const form = document.getElementById('signinForm');
    const email = document.getElementById('siEmail');
    const pass = document.getElementById('siPassword');
    const submit = document.getElementById('signinSubmit');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = (name, msg) => {
        const node = form.querySelector(`[data-error-for="${name}"]`);
        if (node) node.textContent = msg || '';
        document.getElementById(name)?.classList.toggle('is-invalid', !!msg);
      };
      err('siEmail'); err('siPassword');
      submit.setAttribute('aria-busy', 'true');

      const res = await SP.auth.signIn(email.value, pass.value, { remember: document.getElementById('siRemember').checked });

      submit.removeAttribute('aria-busy');
      if (!res.ok) {
        err('siPassword', res.error);
        SP.buzz([12, 60, 12]);
        return;
      }
      SP.buzz(10);
      SP.ui.toast({ tone: 'ok', title: `Welcome back, ${res.user.name.split(' ')[0]}` });
      await enterApp(res.user);
    });
  }

  function wirePinPad() {
    const users = SP.store.state.users.filter((u) => u.active && u.pin);
    const host = document.getElementById('pinUsers');
    SP.clear(host);
    if (!users.length) {
      host.appendChild(SP.el('p.tiny.mute', 'No profiles with a PIN yet. Use your password instead.'));
      return;
    }
    let selected = null;
    let pin = '';
    const dots = document.getElementById('pinDots');
    const nameNode = document.getElementById('pinName');
    const drawDots = () => {
      SP.clear(dots);
      for (let i = 0; i < 4; i += 1) dots.appendChild(SP.el('i', { class: i < pin.length ? 'on' : '' }));
    };
    const select = (u) => {
      selected = u; pin = ''; drawDots();
      nameNode.textContent = u.name;
      SP.$$('.pin-user', host).forEach((n) => n.classList.toggle('is-active', n.dataset.id === u.id));
    };
    for (const u of users) {
      host.appendChild(SP.el('button.pin-user', { type: 'button', dataset: { id: u.id }, onclick: () => select(u) }, SP.avatar(u), u.name.split(' ')[0]));
    }
    if (users.length === 1) select(users[0]);

    SP.on('#pinGrid', 'click', async (e) => {
      const key = e.target.closest('[data-pin]')?.dataset.pin;
      if (!key || !selected) return;
      if (key === 'clear') { pin = ''; drawDots(); return; }
      if (key === 'back') { pin = pin.slice(0, -1); drawDots(); return; }
      pin += key;
      if (pin.length > 4) pin = pin.slice(-4);
      drawDots();
      if (pin.length === 4) {
        const res = await SP.auth.signInWithPin(selected.id, pin);
        if (!res.ok) {
          document.getElementById('pinDots').classList.add('shake');
          setTimeout(() => document.getElementById('pinDots').classList.remove('shake'), 360);
          pin = ''; drawDots();
          return;
        }
        await enterApp(res.user);
      }
    });
  }

  function wirePalette() {
    const wrap = $('palette');
    const input = $('paletteInput');
    input.addEventListener('input', SP.debounce((e) => renderPalette(e.target.value), 110));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); highlight(paletteIndex + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(paletteIndex - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); SP.$$('.pal-item', $('paletteResults'))[paletteIndex]?.click(); }
      else if (e.key === 'Escape') closePalette();
    });
    wrap.addEventListener('click', (e) => { if (e.target === wrap) closePalette(); });
  }

  function wireKeyboard() {
    document.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (!$('app').hidden) openPalette();
      }
      if (typing) return;
    });
    matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      if ((localStorage.getItem('logipilot.themeMode') || 'auto') === 'auto') applyTheme();
    });
  }

  function wireOnline() {
    addEventListener('offline', paintConnection);
    addEventListener('online', paintConnection);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshAlerts(); });
  }

  return { start, signOut, applyTheme, setThemeMode, currentTheme, paintChrome, refreshAlerts, openPalette };
})();

/* ═══════════════════════════════════════════════════ OFFLINE SUPPORT */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;
  addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => console.info('[sw]', e.message));
  });
}

document.addEventListener('DOMContentLoaded', () => {
  SP.app.start().catch((e) => {
    console.error('[boot] fatal', e);
    const hint = document.getElementById('bootHint');
    if (hint) { hint.textContent = `Failed to start: ${e.message}`; hint.style.color = 'var(--danger)'; }
  });
  registerServiceWorker();
});
