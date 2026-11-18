/* =========================================================
   TREASURE HUNT APP — auth.js
   ---------------------------------------------------------
   Manages session lifecycle and the login / logout forms.

   Public surface:
     APP.auth.getUser()        → user object or null
     APP.auth.getRole()        → 'student' | 'teacher' | 'admin' | null
     APP.auth.isLoggedIn()     → bool
     APP.auth.hasRole(role)    → bool
     APP.auth.isLoading()      → bool
     APP.auth.getRestoreError() → '' | string

     APP.auth.bindForms()      → wire #login-form + #logout-btn (idempotent)
     APP.auth.restore()        → async; call once on boot
     APP.auth.login(email,pw)  → async; throws ApiError on failure
     APP.auth.logout()         → async; best-effort
     APP.auth.forceLogout(msg) → sync; used for auth-expired
     APP.auth.onAuthChanged(f) → subscribe; returns unsubscribe fn
     APP.auth.updateUser(u)    → replace user (after profile edit)

   Events:
     window 'app:auth-changed'
        detail = { user, reason }
        reason ∈ 'login' | 'logout' | 'restore' | 'restore-failed'
               | 'forced' | 'no-token' | 'profile-updated'

   Ownership split with app.js:
     - auth.js  → state + login form + logout button + restore()
     - app.js   → binds forms, calls restore(), reacts to auth-changed
                  by swapping login screen ↔ app shell.
     auth.js NEVER toggles #app / #login-screen / #app-loading.
   ========================================================= */

window.APP = window.APP || {};

(function () {
  'use strict';

  const getApi = function () { return window.APP.api; };

  /* ============================ STATE ============================ */
  const state = {
    user: null,
    loading: false,
    restoreError: ''
  };

  const listeners = new Set();
  let restoreInFlight = null;
  let bound = false;

  /* ============================ GETTERS ============================ */
  function getUser()         { return state.user; }
  function getRole()         { return state.user ? state.user.role : null; }
  function isLoggedIn()      { return !!state.user; }
  function hasRole(role)     { return !!state.user && state.user.role === role; }
  function isLoading()       { return state.loading; }
  function getRestoreError() { return state.restoreError; }

  /* ============================ EVENTS ============================ */
  function emit(reason) {
    const detail = { user: state.user, reason: reason || '' };
    listeners.forEach(function (fn) {
      try { fn(detail); } catch (e) { console.error('[auth] listener failed', e); }
    });
    try {
      window.dispatchEvent(new CustomEvent('app:auth-changed', { detail: detail }));
    } catch (e) { /* very old browsers */ }
  }

  function onAuthChanged(fn) {
    if (typeof fn !== 'function') return function () {};
    listeners.add(fn);
    return function unsubscribe() { listeners.delete(fn); };
  }

  function setUser(user, reason) {
    state.user = user || null;
    emit(reason);
  }

  /* ============================ RESTORE ============================ */
  /**
   * restore()
   *   - If a token is present, call APP.api.me() to validate it server-side.
   *   - On auth error   → clear token, set restoreError, user=null.
   *   - On network error → clear token (we can't verify it), set restoreError.
   *   - On success      → set user, clear restoreError.
   * Safe to call repeatedly; concurrent calls share one promise.
   */
  async function restore() {
    if (state.user) return state.user;
    if (restoreInFlight) return restoreInFlight;

    const api = getApi();
    if (!api) {
      state.restoreError = 'Application error: API not loaded.';
      setUser(null, 'restore-failed');
      return null;
    }

    if (!api.hasToken()) {
      setUser(null, 'no-token');
      return null;
    }

    state.loading = true;
    restoreInFlight = (async function () {
      try {
        const data = await api.me();
        state.restoreError = '';
        setUser(data && data.user ? data.user : null, 'restore');
        return state.user;
      } catch (err) {
        if (api.isAuthError(err)) {
          api.clearToken();
          state.restoreError = 'Your session has expired. Please sign in again.';
        } else if (api.isNetworkError(err)) {
          // We can't verify the token, so don't keep it around.
          api.clearToken();
          state.restoreError = 'Could not connect to the server. Please try again.';
        } else if (err && err.code === 'NOT_CONFIGURED') {
          state.restoreError = 'The server is not configured. Please contact your teacher.';
        } else {
          state.restoreError = api.safeMessage ? api.safeMessage(err) : 'Could not restore session.';
        }
        setUser(null, 'restore-failed');
        return null;
      } finally {
        state.loading = false;
      }
    })();

    try {
      return await restoreInFlight;
    } finally {
      restoreInFlight = null;
    }
  }

  /* ============================ LOGIN / LOGOUT ============================ */
  async function login(email, password) {
    const api = getApi();
    if (!api) throw new Error('Application error: API not loaded.');
    const data = await api.login(email, password);
    if (!data || !data.user) throw new Error('Sign in failed. Please try again.');
    state.restoreError = '';
    setUser(data.user, 'login');
    return data.user;
  }

  async function logout() {
    const api = getApi();
    state.restoreError = '';
    clearFormError();
    clearPassword();
    try {
      if (api) await api.logout();
    } catch (e) {
      /* best-effort — token is cleared locally regardless */
    } finally {
      setUser(null, 'logout');
    }
  }

  function forceLogout(reason) {
    const api = getApi();
    if (api) api.clearToken();
    state.restoreError = reason || 'Your session expired. Please sign in again.';
    setUser(null, 'forced');
  }

  /* ============================ LOGIN FORM HELPERS ============================ */
  function clearFormError() {
    const el = document.getElementById('login-error');
    if (el) { el.textContent = ''; el.classList.add('hidden'); }
  }

  function showFormError(msg) {
    const el = document.getElementById('login-error');
    if (!el) return;
    el.textContent = msg || 'Sign in failed. Please try again.';
    el.classList.remove('hidden');
  }

  function clearPassword() {
    const el = document.getElementById('login-password');
    if (el) el.value = '';
  }

  function setSubmitting(isSubmitting) {
    const form = document.getElementById('login-form');
    if (!form) return;
    const btn = form.querySelector('button[type="submit"]');
    if (!btn) return;
    if (isSubmitting) {
      if (!btn.dataset.originalText) btn.dataset.originalText = btn.textContent || 'Sign in';
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-sm"></span>Signing in\u2026';
    } else {
      btn.disabled = false;
      btn.textContent = btn.dataset.originalText || 'Sign in';
    }
  }

  /* ============================ FORM BINDINGS ============================ */
  /**
   * bindForms() — idempotent. app.js calls this once during bootstrap,
   * after DOM is ready. If auth.js is reused without app.js (tests),
   * callers can invoke it directly.
   */
  function bindForms() {
    if (bound) return;
    bound = true;

    /* ---- Login form ---- */
    const form = document.getElementById('login-form');
    if (form) {
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        clearFormError();

        const emailEl = document.getElementById('login-email');
        const pwdEl   = document.getElementById('login-password');
        const email    = emailEl ? String(emailEl.value || '').trim() : '';
        const password = pwdEl   ? String(pwdEl.value || '') : '';

        if (!email || !password) {
          showFormError('Enter your school email and password.');
          return;
        }

        setSubmitting(true);
        try {
          await login(email, password);
          clearPassword();
        } catch (err) {
          const api = getApi();
          showFormError(api && api.safeMessage ? api.safeMessage(err) : 'Sign in failed.');
          if (pwdEl) { pwdEl.focus(); pwdEl.select(); }
        } finally {
          setSubmitting(false);
        }
      });
    }

    /* ---- Logout button (sidebar) ---- */
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async function () {
        if (!window.confirm('Sign out of Treasure Hunt?')) return;
        logoutBtn.disabled = true;
        try {
          await logout();
        } finally {
          logoutBtn.disabled = false;
        }
      });
    }

    /* ---- Session expired from api.js ---- */
    window.addEventListener('app:auth-expired', function () {
      if (state.user) {
        forceLogout('Your session expired. Please sign in again.');
      }
    });
  }

  /* ============================ PUBLIC ============================ */
  window.APP.auth = {
    /* state */
    getUser: getUser,
    getRole: getRole,
    isLoggedIn: isLoggedIn,
    hasRole: hasRole,
    isLoading: isLoading,
    getRestoreError: getRestoreError,

    /* lifecycle */
    bindForms: bindForms,
    restore: restore,
    login: login,
    logout: logout,
    forceLogout: forceLogout,

    /* events */
    onAuthChanged: onAuthChanged,

    /* profile edit hook */
    updateUser: function (user) { setUser(user, 'profile-updated'); }
  };
})();
