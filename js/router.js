/**
 * router.js — hash routing with per-module lifecycle.
 *
 * A module is an object shaped like:
 *   { title, subtitle, perm?, mount(root, params) → HTMLElement | Promise, destroy?() }
 */
window.SP = window.SP || {};

SP.router = (() => {
  const registry = new Map();
  let currentRoute = null;
  let currentParams = {};
  let mounted = null;
  let onChange = null;

  function register(route, mod) { registry.set(route, mod); }
  function registerAll(mods) { Object.entries(mods).forEach(([k, v]) => register(k, v)); }
  function get(route) { return registry.get(route); }
  const routes = () => [...registry.keys()];

  function parse() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [path, qs] = raw.split('?');
    const params = {};
    if (qs) new URLSearchParams(qs).forEach((v, k) => { params[k] = v; });
    return { route: path || 'dashboard', params };
  }

  function href(route, params) {
    const qs = params && Object.keys(params).length
      ? `?${new URLSearchParams(params)}` : '';
    return `#/${route}${qs}`;
  }

  async function resolve(route) {
    const { route: r, params } = parse();
    const mod = registry.get(r) || registry.get('dashboard');
    const target = registry.has(r) ? r : 'dashboard';

    // Permission gate.
    if (mod.perm && SP.auth && !SP.auth.can(mod.perm)) {
      SP.ui?.toast({ tone: 'warn', title: 'Not available on your role', body: 'Ask an administrator if you need access.' });
      location.hash = href('dashboard');
      return;
    }

    if (mounted === target && mounted && registry.get(target)?.noRemount) return;

    try { mounted?.destroy?.(); } catch (e) { console.warn('[router] destroy failed', e); }

    currentRoute = target;
    currentParams = params;
    mounted = target;

    const root = document.getElementById('viewInner');
    SP.clear(root);

    // Guard against a slow module rendering after the user has moved on.
    const token = SP.uid('nav');

    try {
      const node = await registry.get(target).mount(params, { token, root });
      if (token !== (registry.get(target)._token || token)) { /* stale */ }
      if (node) root.appendChild(node);
    } catch (e) {
      console.error('[router] module failed', e);
      root.appendChild(SP.el('div.callout', { dataset: { tone: 'danger' } },
        SP.el('span.callout__ico', SP.icon('alert')),
        SP.el('div.callout__body',
          SP.el('strong', 'This module could not be displayed'),
          SP.el('p', e.message),
        ),
      ));
    }

    root.scrollTop = 0;
    const view = document.getElementById('view');
    if (view) view.scrollTop = 0;
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });

    onChange?.(target, params);
    SP.app?.paintChrome?.();
  }

  function go(route, params) {
    const h = href(route, params);
    if (location.hash === h) resolve(route);
    else location.hash = h;
  }

  function refresh() { resolve(currentRoute); }

  function start(onChanged) {
    onChange = onChanged;
    addEventListener('hashchange', () => resolve());
    resolve();
  }

  return {
    register, registerAll, get, routes, start, go, refresh, resolve,
    get route() { return currentRoute; },
    get params() { return currentParams; },
    href,
  };
})();