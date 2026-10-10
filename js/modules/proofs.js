/**
 * modules/proofs.js — the photo proof gallery: filterable, immutable,
 * grouped by order, with full stamp detail on tap.
 */
window.SP = window.SP || {};
SP.modules = SP.modules || {};

SP.modules.proofs = (() => {
  const state = { q: '', stage: 'all' };
  const MOD = { title: 'Photo Proofs', subtitle: () => `${SP.fmt.pluralise(SP.store.state.proofs.length, 'stamped proof')}`, mount, perm: 'proofs:view' };

  function rows() {
    let list = [...SP.store.state.proofs].sort((a, b) => b.at - a.at);
    if (state.stage !== 'all') list = list.filter((p) => p.stage === state.stage);
    if (state.q) list = list.filter((p) => `${p.ref} ${p.orderRef} ${p.byName}`.toLowerCase().includes(state.q));
    return list;
  }

  function mount() {
    const root = SP.el('div.stack.gap-3');
    root.appendChild(SP.ui2.pageHead({
      title: 'Photo Proofs',
      sub: 'Immutable, stamped, and tied to the order chain of custody.',
    }));

    const host = SP.el('div.proofgrid');
    const draw = () => {
      SP.clear(host);
      const list = rows();
      if (!list.length) {
        host.appendChild(SP.empty({ icon: 'eye', title: 'No proofs yet', body: 'Stamped photos appear here as the chain moves.' }));
        return;
      }
      for (const p of list) {
        host.appendChild(SP.el('button.proofcard', { type: 'button', onclick: () => SP.ui2.viewProof(p) },
          SP.el('img', { src: p.dataUrl, alt: `Proof ${p.ref}`, loading: 'lazy' }),
          SP.el('div.proofcard__meta',
            SP.el('strong', p.orderRef),
            SP.el('small', `${SP.statusOf(p.stage).label || p.stage} · ${p.byName}`),
            SP.el('small.mute', SP.fmt.dateTime(p.at))),
          p.stamp.gps ? SP.el('span.proofcard__gps', { title: 'GPS stamped' }, SP.icon('pin')) : null));
      }
    };

    const search = SP.el('div.searchbar', SP.icon('search'),
      SP.el('input.input', { type: 'search', placeholder: 'Search ref, order, person…', oninput: SP.debounce((e) => { state.q = e.target.value.trim().toLowerCase(); draw(); }, 160) }));
    const chips = SP.chipRow(
      [{ value: 'all', label: 'All stages' },
        { value: 'packed', label: 'Packing' },
        { value: 'qc_approved', label: 'QC' },
        { value: 'delivered', label: 'Delivery' },
        { value: 'failed', label: 'Failed' }],
      state.stage, (v) => { state.stage = v; draw(); });

    root.append(search, chips, host);
    draw();
    return root;
  }

  return MOD;
})();

/* ═══════════════════════════════════════════════ USERS & ASSIGNMENT */

SP.modules.users = (() => {
  const MOD = { title: 'Users & Assignment', subtitle: () => `${SP.fmt.pluralise(SP.store.state.users.length, 'account')}`, mount, perm: 'users:manage' };

  function mount() {
    const root = SP.el('div.stack.gap-4');
    root.appendChild(SP.ui2.pageHead({
      title: 'Users & Assignment',
      sub: 'Roles, permissions, and who is carrying what right now.',
      actions: [SP.el('button.btn.btn--primary.btn--sm', { type: 'button', onclick: () => editUser(null) }, SP.icon('plus'), 'New user')],
    }));

    /* users table */
    const table = SP.table.create({
      columns: [
        { key: 'name', label: 'User', value: (u) => u.name, render: (u) => SP.el('div.row.gap-2', { style: { alignItems: 'center' } }, SP.avatar(u), SP.el('div.stack', SP.el('strong', u.name), SP.el('small.mute', `${u.email}${u.phone ? ` · ${u.phone}` : ''}`))) },
        { key: 'role', label: 'Role', width: '130px', value: (u) => u.role, render: (u) => SP.ui2.tag(SP.auth.roleDef(u.role).label, 'brand') },
        { key: 'load', label: 'Current load', width: '150px', value: (u) => loadOf(u), render: (u) => SP.el('span.tiny', loadOf(u) || SP.el('span.mute', 'idle')) },
        { key: 'lastLoginAt', label: 'Last sign-in', width: '110px', value: (u) => u.lastLoginAt || 0, render: (u) => SP.el('span.tiny', u.lastLoginAt ? SP.fmt.ago(u.lastLoginAt) : 'never') },
        { key: 'active', label: 'Status', width: '80px', value: (u) => u.active, render: (u) => SP.ui2.tag(u.active ? 'Active' : 'Disabled', u.active ? 'ok' : 'mute') },
      ],
      rows: () => [...SP.store.state.users],
      rowId: (u) => u.id,
      empty: { icon: 'users', title: 'No users' },
      onRowClick: (u) => userSheet(u),
    });
    root.appendChild(table.el);

    /* ── bulk assignment ─────────────────────────────────────── */
    if (SP.auth.can('assign:packer')) {
      const unassigned = SP.store.state.orders.filter((o) => !o.packerId && ['new', 'assigned'].includes(o.status));
      const bulkHost = SP.el('div.stack.gap-2');
      const drawBulk = () => {
        SP.clear(bulkHost);
        const list = SP.store.state.orders.filter((o) => !o.packerId && ['new', 'assigned'].includes(o.status));
        if (!list.length) {
          bulkHost.appendChild(SP.el('p.tiny.mute', 'Every active order has a packer assigned.'));
          return;
        }
        const sel = SP.el('select.select', {},
          ...SP.auth.byRole('packer').map((u) => SP.el('option', { value: u.id }, u.name)));
        bulkHost.appendChild(SP.el('div.row.gap-2', { style: { alignItems: 'center', flexWrap: 'wrap' } },
          SP.el('strong.tiny', `${list.length} waiting for a packer`),
          sel,
          SP.el('button.btn.btn--primary.btn--sm', {
            type: 'button',
            onclick: async () => {
              if (!sel.value) { SP.ui.toast({ tone: 'warn', title: 'Choose a packer' }); return; }
              let n = 0;
              for (const o of list) {
                try { SP.orders.assign(o.id, 'packerId', sel.value); n += 1; } catch { /* skip */ }
              }
              SP.ui.toast({ tone: 'ok', title: `${n} orders assigned`, body: `${SP.auth.byId(sel.value)?.name} notified.` });
              SP.router.refresh();
            },
          }, SP.icon('users'), SP.t('act.bulk_assign'))));
      };
      drawBulk();
      root.appendChild(SP.el('section.section',
        SP.el('div.section__head', SP.el('div.grow', SP.el('h2', 'Unassigned orders'), SP.el('p', 'Send a batch to one packer'))),
        SP.el('div.card.card--pad', bulkHost)));
    }

    /* role cards */
    root.appendChild(SP.el('section.section',
      SP.el('div.section__head', SP.el('div.grow', SP.el('h2', 'Roles & permissions'), SP.el('p', 'What each role can do'))),
      SP.el('div.grid.grid--2.gap-3', ...SP.ROLES.map((r) => {
        const count = SP.store.state.users.filter((u) => u.role === r.id && u.active).length;
        return SP.el('button.card.card--pad', { type: 'button', style: { textAlign: 'left' }, onclick: () => permSheet(r) },
          SP.el('div.row', { style: { justifyContent: 'space-between' } }, SP.el('strong', r.label), SP.ui2.tag(`${count} active`, 'mute')),
          SP.el('p.tiny.mute', r.blurb),
          SP.el('p.tiny', { style: { marginTop: '4px' } }, r.perms.includes('*') ? 'All permissions' : `${r.perms.length} permissions`));
      }))));
    return root;
  }

  function loadOf(u) {
    const s = SP.store.state;
    const parts = [];
    const pack = s.orders.filter((o) => o.packerId === u.id && ['assigned', 'packing', 'qc_rejected'].includes(o.status)).length;
    const qc = s.orders.filter((o) => o.qcId === u.id && o.status === 'packed').length;
    const del = s.orders.filter((o) => (o.deliveryId === u.id || o.driverId === u.id) && o.status === 'out_for_delivery').length;
    if (pack) parts.push(`${pack} packing`);
    if (qc) parts.push(`${qc} QC`);
    if (del) parts.push(`${del} delivering`);
    return parts.join(' · ');
  }

  function permSheet(role) {
    const body = SP.el('div.stack.gap-1', ...Object.entries(SP.PERMS).map(([key, label]) => {
      const has = role.perms.includes('*') || role.perms.includes(key);
      return SP.el('div.row', { style: { justifyContent: 'space-between' } },
        SP.el('span.tiny', label), SP.icon(has ? 'check' : 'x', has ? '' : 'mute'));
    }));
    SP.sheet({ title: `${role.label} — permissions`, content: body });
  }

  function userSheet(u) {
    const me = SP.auth.current();
    const shell = SP.sheet({
      title: u.name, subtitle: u.email,
      content: SP.el('dl.kv',
        SP.el('dt', 'Role'), SP.el('dd', SP.auth.roleDef(u.role).label),
        SP.el('dt', 'Phone'), SP.el('dd', u.phone || '—'),
        SP.el('dt', 'PIN sign-in'), SP.el('dd', u.pin ? 'Enabled' : 'Not set'),
        SP.el('dt', 'Last sign-in'), SP.el('dd', u.lastLoginAt ? SP.fmt.dateTime(u.lastLoginAt) : 'Never'),
        SP.el('dt', 'Active sessions'), SP.el('dd', SP.fmt.n((u.sessions || []).filter((x) => x.expiresAt > Date.now()).length))),
      actions: [
        SP.el('button.btn.btn--ghost', { type: 'button', onclick: () => { shell.close(); editUser(u); } }, SP.icon('edit'), 'Edit'),
        u.id !== me?.id ? SP.el('button.btn.btn--ghost', { type: 'button', onclick: () => { SP.auth.revokeSessions(u.id); SP.ui.toast({ tone: 'ok', title: 'Sessions revoked' }); } }, SP.icon('logout'), 'Log out everywhere') : null,
        u.id !== me?.id ? SP.el('button.btn', {
          type: 'button', class: u.active ? 'btn--danger' : 'btn--ok',
          onclick: () => { try { SP.auth.toggleActive(u.id); shell.close(); SP.router.refresh(); } catch (e) { SP.ui.toast({ tone: 'danger', title: e.message }); } },
        }, u.active ? 'Disable' : 'Enable') : null,
        u.id !== me?.id ? SP.el('button.btn.btn--danger', {
          type: 'button',
          onclick: async () => {
            const ok = await SP.modal({ title: `Delete ${u.name}?`, body: 'Their proofs and history remain.', tone: 'danger', okLabel: 'Delete' });
            if (!ok) return;
            try { await SP.auth.deleteUser(u.id); shell.close(); SP.router.refresh(); } catch (e) { SP.ui.toast({ tone: 'danger', title: e.message }); }
          },
        }, SP.icon('trash'), 'Delete') : null,
      ],
    });
  }

  function editUser(u) {
    const isNew = !u;
    u = u || {};
    return SP.modal({
      title: isNew ? 'New user' : `Edit ${u.name}`, icon: 'users',
      okLabel: isNew ? 'Create account' : 'Save',
      fields: [
        { key: 'name', label: 'Full name', required: true, value: u.name },
        { key: 'email', label: 'Work email', type: 'email', required: true, value: u.email },
        { key: 'phone', label: 'Phone', inputmode: 'tel', value: u.phone },
        { key: 'role', label: 'Role', type: 'select', required: true, value: u.role || 'packer', options: SP.ROLES.map((r) => ({ value: r.id, label: `${r.label} — ${r.blurb}` })) },
        isNew ? { key: 'password', label: 'Password', type: 'password', required: true } : null,
        { key: 'pin', label: 'Quick PIN (4 digits, optional)', inputmode: 'numeric', validate: (raw) => raw && !/^\d{4}$/.test(raw) ? 'Exactly 4 digits' : null },
      ].filter(Boolean),
      onOk: async (v) => {
        if (isNew) {
          await SP.auth.createUser(v);
          SP.ui.toast({ tone: 'ok', title: 'Account created' });
        } else {
          await SP.auth.updateUser(u.id, { name: v.name, email: v.email, phone: v.phone, role: v.role });
          if (v.pin) await SP.auth.setPin(u.id, v.pin);
          SP.ui.toast({ tone: 'ok', title: 'Account saved' });
        }
        SP.router.refresh();
      },
    });
  }

  return MOD;
})();

/* ═══════════════════════════════════════════════════════════ AUDIT */

SP.modules.audit = (() => {
  const state = { q: '' };
  const MOD = { title: 'Audit Log', subtitle: () => `${SP.fmt.pluralise(SP.store.state.audit.length, 'records')}`, mount, perm: 'audit:view' };

  function mount() {
    const root = SP.el('div.stack.gap-3');
    const rows = () => SP.store.state.audit
      .filter((a) => !state.q || `${a.action} ${a.by} ${a.target} ${a.detail}`.toLowerCase().includes(state.q));

    const table = SP.table.create({
      columns: [
        { key: 'at', label: 'When', width: '140px', value: (a) => a.at, render: (a) => SP.el('span.tiny', SP.fmt.dateTime(a.at)) },
        { key: 'by', label: 'Who', width: '120px', value: (a) => a.by },
        { key: 'action', label: 'Action', width: '150px', value: (a) => a.action, render: (a) => SP.el('code.tiny', a.action) },
        { key: 'target', label: 'Target', width: '110px', value: (a) => a.target },
        { key: 'detail', label: 'Detail', value: (a) => a.detail, render: (a) => SP.el('span.tiny', a.detail || '—') },
      ],
      rows, rowId: (a) => a.id, pageSize: 50,
      empty: { icon: 'database', title: 'No audit records' },
    });

    const search = SP.el('div.searchbar', SP.icon('search'),
      SP.el('input.input', { type: 'search', placeholder: 'Search who, action, order…', oninput: SP.debounce((e) => { state.q = e.target.value.trim().toLowerCase(); table.refresh(); }, 160) }));

    root.append(SP.ui2.pageHead({ title: 'Audit Log', sub: 'Immutable — never edited or deleted through the app.' }), search, table.el);
    return root;
  }

  return MOD;
})();
