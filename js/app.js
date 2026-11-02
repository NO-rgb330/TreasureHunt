/* =========================================================
   TREASURE HUNT APP — app.js
   ========================================================= */

window.APP = window.APP || {};
window.APP.views = window.APP.views || {};

(function () {
  'use strict';

  const cfg = window.APP.config;

  /* ============================ STATE ============================ */
  let bound = false;
  let currentRoute = null;
  let currentParams = {};
  let renderGeneration = 0;
  let unsubAuth = null;
  const cleanups = []; // view-provided teardown hooks (optional)

  /* ============================ DOM HELPERS ============================ */
  function $(id) { return document.getElementById(id); }
  function show(el) { if (el) el.classList.remove('hidden'); }
  function hide(el) { if (el) el.classList.add('hidden'); }

  /* ============================ UI HELPERS ============================ */

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        const v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'className') node.className = v;
        else if (k === 'textContent') node.textContent = v;
        else if (k === 'innerHTML') node.innerHTML = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k.indexOf('on') === 0 && typeof v === 'function') {
          node.addEventListener(k.substring(2).toLowerCase(), v);
        } else {
          node.setAttribute(k, String(v));
        }
      });
    }
    if (children) {
      if (!Array.isArray(children)) children = [children];
      children.forEach(function (c) {
        if (c == null || c === false) return;
        if (typeof c === 'string' || typeof c === 'number') {
          node.appendChild(document.createTextNode(String(c)));
        } else if (c instanceof Node) {
          node.appendChild(c);
        }
      });
    }
    return node;
  }

  function toast(message, type, timeout) {
    const c = $('toast-container');
    if (!c) return;
    const t = el('div', { className: 'toast ' + (type || 'success'), textContent: String(message || '') });
    c.appendChild(t);
    const ms = (timeout == null ? 3000 : timeout);
    setTimeout(function () {
      t.style.opacity = '0';
      t.style.transition = 'opacity .25s ease';
      setTimeout(function () { t.remove(); }, 260);
    }, ms);
  }

  /* ---- Modal ---- */
  let escHandler = null;

  function showModal(opts) {
    opts = opts || {};
    const backdrop = $('modal-backdrop');
    const modal = $('modal');
    if (!backdrop || !modal) return;

    modal.className = 'modal' + (opts.wide ? ' wide' : '');
    modal.innerHTML = '';

    if (opts.title) {
      const header = el('div', { className: 'modal-header' });
      header.appendChild(el('h2', { textContent: String(opts.title) }));
      if (opts.closable !== false) {
        header.appendChild(el('button', {
          type: 'button', className: 'icon-btn',
          'aria-label': 'Close', textContent: '\u00d7',
          onClick: closeModal
        }));
      }
      modal.appendChild(header);
    }

    const body = el('div', { className: 'modal-body' });
    if (opts.body instanceof Node) body.appendChild(opts.body);
    else body.innerHTML = opts.body || '';
    modal.appendChild(body);

    if (opts.footer && opts.footer.length) {
      const footer = el('div', { className: 'modal-footer' });
      opts.footer.forEach(function (b) {
        const btn = el('button', {
          type: 'button',
          className: 'btn btn-' + (b.variant || 'outline'),
          textContent: b.label
        });
        if (b.disabled) btn.disabled = true;
        btn.addEventListener('click', function () {
          try { b.onClick && b.onClick(); } catch (e) { console.error('[modal]', e); }
        });
        footer.appendChild(btn);
      });
      modal.appendChild(footer);
    }

    modal._onClose = opts.onClose || null;
    show(backdrop);
    document.body.style.overflow = 'hidden';

    backdrop.onclick = (opts.closable === false)
      ? null
      : function (e) { if (e.target === backdrop) closeModal(); };

    escHandler = function (e) {
      if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', escHandler);

    setTimeout(function () {
      const f = modal.querySelector('input, textarea, select, button');
      if (f) { try { f.focus(); } catch (e) {} }
    }, 30);
  }

  function closeModal() {
    const backdrop = $('modal-backdrop');
    const modal = $('modal');
    if (!backdrop) return;
    hide(backdrop);
    document.body.style.overflow = '';
    if (escHandler) { document.removeEventListener('keydown', escHandler); escHandler = null; }
    const cb = modal && modal._onClose;
    if (modal) { modal._onClose = null; modal.innerHTML = ''; }
    if (typeof cb === 'function') { try { cb(); } catch (e) { console.error('[modal close]', e); } }
  }

  function confirm(message, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      let settled = false;
      showModal({
        title: opts.title || 'Confirm',
        body: '<p>' + escapeHtml(message || '') + '</p>',
        footer: [
          { label: opts.cancelLabel || 'Cancel', variant: 'outline',
            onClick: function () { if (!settled) { settled = true; closeModal(); resolve(false); } } },
          { label: opts.confirmLabel || 'Confirm',
            variant: opts.danger ? 'danger' : 'primary',
            onClick: function () { if (!settled) { settled = true; closeModal(); resolve(true); } } }
        ],
        onClose: function () { if (!settled) { settled = true; resolve(false); } }
      });
    });
  }

  function alert(message, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      let settled = false;
      showModal({
        title: opts.title || 'Notice',
        body: '<p>' + escapeHtml(message || '') + '</p>',
        footer: [
          { label: opts.okLabel || 'OK', variant: 'primary',
            onClick: function () { if (!settled) { settled = true; closeModal(); resolve(); } } }
        ],
        onClose: function () { if (!settled) { settled = true; resolve(); } }
      });
    });
  }

  function setTitle(text) {
    const el = $('page-title');
    if (el) el.textContent = String(text || '');
    try { document.title = text ? (String(text) + ' \u2014 ' + cfg.APP_NAME) : cfg.APP_NAME; }
    catch (e) { /* ignore */ }
  }

  function showLoading(on) {
    const el = $('app-loading');
    if (!el) return;
    if (on) show(el); else hide(el);
  }

  function formatDate(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (e) { return String(iso); }
  }

  function formatDateTime(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      return d.toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch (e) { return String(iso); }
  }

  function relativeTime(iso) {
    if (!iso) return '';
    try {
      const t = new Date(iso).getTime();
      if (isNaN(t)) return String(iso);
      const s = Math.round((Date.now() - t) / 1000);
      if (s < 45) return 'just now';
      if (s < 3600) return Math.floor(s / 60) + ' min ago';
      if (s < 86400) return Math.floor(s / 3600) + ' hr ago';
      if (s < 604800) {
        const days = Math.floor(s / 86400);
        return days + (days === 1 ? ' day ago' : ' days ago');
      }
      return formatDate(iso);
    } catch (e) { return String(iso); }
  }

  function formatPoints(n) {
    const num = Number(n) || 0;
    try { return num.toLocaleString(); } catch (e) { return String(num); }
  }

  /* ============================ NAV ============================ */
  function renderNav(role) {
    const nav = $('nav');
    if (!nav) return;
    nav.innerHTML = '';
    const items = (cfg.NAV && cfg.NAV[role]) || [];

    items.forEach(function (item) {
      const btn = el('button', {
        type: 'button',
        className: 'nav-item',
        'data-route': item.key,
        'aria-label': item.label
      });
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('width', '18');
      svg.setAttribute('height', '18');
      svg.setAttribute('class', 'nav-icon');
      svg.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('fill', 'currentColor');
      path.setAttribute('d', item.icon || '');
      svg.appendChild(path);
      btn.appendChild(svg);
      btn.appendChild(el('span', { textContent: item.label || item.key }));
      btn.addEventListener('click', function () {
        navigate(item.key);
        closeDrawer();
      });
      nav.appendChild(btn);
    });
  }

  function setActiveNav(routeKey) {
    const nav = $('nav');
    if (!nav) return;
    nav.querySelectorAll('.nav-item').forEach(function (item) {
      if (item.getAttribute('data-route') === routeKey) item.classList.add('active');
      else item.classList.remove('active');
    });
  }

  function updateUserChip(user) {
    const name   = $('user-name');
    const role   = $('user-role');
    const avatar = $('user-avatar');
    const display = user && user.displayName ? String(user.displayName) : 'User';
    if (name)   name.textContent = display;
    if (role)   role.textContent = (user && user.role) ? String(user.role) : '';
    if (avatar) avatar.textContent = display.trim().charAt(0).toUpperCase() || '?';
  }

  function updateRoleBadge(role) {
    const el = $('role-badge');
    if (!el) return;
    const r = String(role || '').toLowerCase();
    el.textContent = r || '';
    el.className = 'role-badge' +
      (r === 'teacher' ? ' teacher' : r === 'admin' ? ' admin' : '');
  }

  /* ============================ DRAWER ============================ */
  function openDrawer() {
    const sb = $('sidebar');
    if (sb) sb.classList.add('open');
    document.body.classList.add('menu-open');
  }
  function closeDrawer() {
    const sb = $('sidebar');
    if (sb) sb.classList.remove('open');
    document.body.classList.remove('menu-open');
  }
  function bindDrawer() {
    const t = $('menu-toggle');
    const c = $('sidebar-close');
    if (t) t.addEventListener('click', openDrawer);
    if (c) c.addEventListener('click', closeDrawer);
    window.addEventListener('resize', function () {
      if (window.innerWidth > 768) closeDrawer();
    });
  }

  /* ============================ ROUTING ============================ */
  function parseHash() {
    const raw = String(location.hash || '').replace(/^#/, '');
    if (!raw) return { route: '', params: {} };
    const qi = raw.indexOf('?');
    if (qi < 0) return { route: raw, params: {} };
    const params = {};
    try {
      new URLSearchParams(raw.slice(qi + 1)).forEach(function (v, k) { params[k] = v; });
    } catch (e) { /* ignore */ }
    return { route: raw.slice(0, qi), params: params };
  }

  function serializeHash(route, params) {
    let h = '#' + String(route || '');
    if (params) {
      const keys = Object.keys(params).filter(function (k) { return params[k] !== undefined && params[k] !== ''; });
      if (keys.length) {
        const q = new URLSearchParams();
        keys.forEach(function (k) { q.append(k, params[k]); });
        h += '?' + q.toString();
      }
    }
    return h;
  }

  function navigate(route, params) {
    if (!route) return;
    const hash = serializeHash(route, params);
    if (location.hash === hash) {
      handleRoute(); // force re-render
    } else {
      location.hash = hash;
    }
  }

  async function handleRoute() {
    const user = window.APP.auth.getUser();
    if (!user) return; // login screen handles itself

    const parsed = parseHash();
    let routeKey = parsed.route;
    let params = parsed.params;

    if (!routeKey) {
      routeKey = cfg.DEFAULT_ROUTE[user.role] || 'student.home';
      params = {};
      try { history.replaceState({}, '', serializeHash(routeKey, params)); } catch (e) {}
    }
    await renderRoute(routeKey, params);
  }

  function runCleanups() {
    while (cleanups.length) {
      const fn = cleanups.pop();
      try { fn(); } catch (e) { console.error('[view cleanup]', e); }
    }
  }

  async function renderRoute(routeKey, params) {
    const user = window.APP.auth.getUser();
    const view = $('view');
    if (!view) return;

    // Tear down any previous view
    runCleanups();

    const route = cfg.ROUTES && cfg.ROUTES[routeKey];
    if (!route) {
      renderFallback(view, 'Page not found', 'The page "' + routeKey + '" does not exist.');
      setTitle('Not found');
      return;
    }
    if (route.requiresRole &&
        user.role !== route.requiresRole &&
        user.role !== 'admin') {
      renderFallback(view, 'Access denied', 'You do not have permission to view this page.');
      setTitle('Access denied');
      return;
    }

    const renderFn = window.APP.views && window.APP.views[route.view];
    if (typeof renderFn !== 'function') {
      renderFallback(view, 'Coming soon', 'This page is not available yet.');
      setTitle(routeKey);
      return;
    }

    currentRoute = routeKey;
    currentParams = params || {};
    const myGen = ++renderGeneration;

    setActiveNav(routeKey);
    const navItems = cfg.NAV[user.role] || [];
    const navItem = navItems.find(function (n) { return n.key === routeKey; });
    setTitle(navItem ? navItem.title : routeKey);

    // Loading placeholder
    view.innerHTML = '';
    const placeholder = el('div', { className: 'empty-state' });
    placeholder.appendChild(el('div', { className: 'spinner', style: { margin: '0 auto 12px' } }));
    placeholder.appendChild(el('p', { textContent: 'Loading\u2026' }));
    view.appendChild(placeholder);

    const ctx = {
      user: user,
      route: routeKey,
      params: currentParams,
      navigate: navigate,
      // Views may register cleanup (stop camera, clear intervals)
      onCleanup: function (fn) { if (typeof fn === 'function') cleanups.push(fn); }
    };

    try {
      await Promise.resolve(renderFn(view, ctx));
      if (myGen !== renderGeneration) return; // stale — user already navigated away
      try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch (e) { window.scrollTo(0, 0); }
    } catch (err) {
      if (myGen !== renderGeneration) return;
      const api = window.APP.api;
      const msg = api && api.safeMessage ? api.safeMessage(err) : (err && err.message) || 'Something went wrong.';
      view.innerHTML = '';
      const card = el('div', { className: 'card' });
      const body = el('div', { className: 'card-body' });
      body.appendChild(el('h3', { textContent: 'Could not load this page' }));
      body.appendChild(el('p', { className: 'muted', textContent: msg }));
      body.appendChild(el('button', {
        type: 'button', className: 'btn btn-primary', textContent: 'Retry',
        onClick: function () { renderRoute(routeKey, currentParams); }
      }));
      card.appendChild(body);
      view.appendChild(card);

      if (api && api.isAuthError && api.isAuthError(err)) {
        window.APP.auth.forceLogout('Your session expired. Please sign in again.');
      }
    }
  }

  function renderFallback(view, title, message) {
    view.innerHTML = '';
    const box = el('div', { className: 'empty-state' });
    box.appendChild(el('h3', { textContent: title }));
    box.appendChild(el('p', { textContent: message }));
    view.appendChild(box);
  }

  /* ============================ AUTH HANDLING ============================ */
  function showLoginScreen(message) {
    hide($('app-loading'));
    hide($('app'));
    show($('login-screen'));
    closeDrawer();

    const err = $('login-error');
    if (err) {
      err.textContent = message || '';
      if (message) err.classList.remove('hidden');
      else err.classList.add('hidden');
    }
    setTimeout(function () {
      const email = $('login-email');
      if (email) { try { email.focus(); } catch (e) {} }
    }, 50);
  }

  function showAppShell(user) {
    hide($('app-loading'));
    hide($('login-screen'));
    show($('app'));

    renderNav(user.role);
    updateUserChip(user);
    updateRoleBadge(user.role);
    closeDrawer();
  }

  function handleAuthChange(detail) {
    const user = detail && detail.user;
    const reason = detail && detail.reason;

    if (user) {
      showAppShell(user);

      // Deep link: ?challenge=qr_xxx
      const token = cfg.readChallengeParam();
      if (token && user.role === 'student') {
        cfg.clearChallengeParam();
        navigate('student.scan', { pendingToken: token });
        return;
      }
      if (token) cfg.clearChallengeParam(); // non-student: drop it

      if (!currentRoute) {
        navigate(cfg.DEFAULT_ROUTE[user.role] || 'student.home');
      }
    } else {
      const msg = (reason === 'restore-failed') ? window.APP.auth.getRestoreError() : '';
      showLoginScreen(msg || '');
      currentRoute = null;
      currentParams = {};
    }
  }

  /* ============================ BOOTSTRAP ============================ */
  function boot() {
    if (bound) return;
    bound = true;

    cfg.validate();
    show($('app-loading'));

    window.APP.auth.bindForms();
    bindDrawer();

    if (unsubAuth) unsubAuth();
    unsubAuth = window.APP.auth.onAuthChanged(function (detail) {
      // Defer so auth state is fully settled before we touch the DOM
      Promise.resolve().then(function () { handleAuthChange(detail); });
    });

    window.addEventListener('hashchange', function () { handleRoute(); });

    window.APP.auth.restore().catch(function () {
      showLoginScreen('Could not restore session. Please sign in.');
    });
  }

  /* ============================ PUBLIC ============================ */
  window.APP.ui = {
    toast: toast,
    showModal: showModal,
    closeModal: closeModal,
    confirm: confirm,
    alert: alert,
    setTitle: setTitle,
    showLoading: showLoading,
    escapeHtml: escapeHtml,
    formatDate: formatDate,
    formatDateTime: formatDateTime,
    relativeTime: relativeTime,
    formatPoints: formatPoints,
    el: el
  };

  window.APP.app = {
    navigate: navigate,
    getRoute: function () { return currentRoute; },
    getParams: function () { return currentParams; },
    refresh: function () { if (currentRoute) renderRoute(currentRoute, currentParams); },
    boot: boot
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    setTimeout(boot, 0);
  }
})();
