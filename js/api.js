/* =========================================================
   TREASURE HUNT APP — api.js
   ---------------------------------------------------------
   Transport + typed helpers for every backend action
   defined in backend/Code.gs.

   Public surface:  APP.api.<method>(...)
   Config deps:     APP.config.BACKEND_URL
                    APP.config.NETWORK.*
                    APP.config.STORAGE.TOKEN

   Error model:
     APP.api.ApiError  { name, message, code, status }
     APP.api.isAuthError(err)

   Events:
     window 'app:auth-expired'  — token rejected; app.js
                                  should return to login.

   Rules:
     - Only this file performs fetch() for backend data.
     - Token is read from localStorage on every call.
     - No action mutates localStorage except login/logout.
   ========================================================= */

window.APP = window.APP || {};

(function () {
  'use strict';

  const cfg = window.APP.config;
  const TOKEN_KEY = cfg.STORAGE.TOKEN;

  /* =========================================================
     Token storage (only place that touches localStorage)
     ========================================================= */
  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }
  function setToken(token) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* storage blocked — proceed without persistence */ }
  }
  function hasToken() { return !!getToken(); }
  function clearToken() { setToken(''); }

  /* =========================================================
     Errors
     ========================================================= */
  class ApiError extends Error {
    constructor(message, code, status) {
      super(message || 'Request failed.');
      this.name = 'ApiError';
      this.code = code || '';
      this.status = Number(status) || 0;
    }
  }
  function isAuthError(err) {
    return !!err && (err.code === 'AUTH_REQUIRED' || err.status === 401);
  }
  function isNetworkError(err) {
    return !!err && (err.code === 'NETWORK' || err.code === 'TIMEOUT' || err.code === 'BAD_JSON');
  }
  /** Safe message for UI. Never leaks stack traces. */
  function safeMessage(err) {
    if (!err) return 'Something went wrong.';
    if (err instanceof ApiError) return err.message;
    if (typeof err.message === 'string' && err.message.length < 200) return err.message;
    return 'Something went wrong. Please try again.';
  }

  /* =========================================================
     Idempotency helper for quiz submissions
     ========================================================= */
  function generateSubmissionId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return 'sub_' + window.crypto.randomUUID().replace(/-/g, '');
      }
    } catch (e) { /* fall through */ }
    // Fallback: timestamp + random hex
    const rnd = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
    return 'sub_' + Date.now().toString(16) + rnd;
  }

  /* =========================================================
     Retry policy
     ========================================================= */
  function isRetryable(err) {
    if (!err) return false;
    if (err.code === 'NETWORK' || err.code === 'TIMEOUT') return true;
    if (err.code === 'BAD_JSON') return true;              // transient proxy hiccup
    if (err.status >= 500) return true;
    if (err.status === 429) return true;
    return false;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  /* =========================================================
     Core raw call — one attempt, no retry
     ========================================================= */
  async function rawCall(action, payload, opts) {
    opts = opts || {};
    const url = cfg.BACKEND_URL;

    if (!url || /REPLACE_WITH_YOUR_DEPLOYMENT_ID/.test(url)) {
      throw new ApiError(
        'Backend is not configured. Set APP.config.BACKEND_URL in js/config.js.',
        'NOT_CONFIGURED',
        0
      );
    }

    const body = Object.assign({}, payload || {}, { action: action });
    if (opts.authenticated !== false) {
      const t = getToken();
      if (t) body.token = t;
    }

    const controller = new AbortController();
    const timeoutMs = opts.timeoutMs || cfg.NETWORK.REQUEST_TIMEOUT_MS || 30000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        // text/plain is REQUIRED: Apps Script cannot answer a CORS preflight,
        // and application/json would trigger one.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        redirect: 'follow',
        credentials: 'omit',
        signal: controller.signal
      });
    } catch (e) {
      clearTimeout(timer);
      if (e && e.name === 'AbortError') {
        throw new ApiError('Request timed out. Check your connection and try again.', 'TIMEOUT', 0);
      }
      throw new ApiError('Network error. Check your connection and try again.', 'NETWORK', 0);
    }
    clearTimeout(timer);

    if (!response.ok) {
      // Apps Script normally returns 200 even for logical errors,
      // so a non-200 here is usually infrastructure (proxy, 5xx).
      throw new ApiError(
        'Server is unavailable right now (' + response.status + ').',
        'HTTP_' + response.status,
        response.status
      );
    }

    let json;
    try {
      json = await response.json();
    } catch (e) {
      throw new ApiError('Unexpected response from server.', 'BAD_JSON', response.status);
    }

    if (!json || json.ok !== true) {
      const msg  = (json && typeof json.error === 'string') ? json.error : 'Request failed.';
      const code = (json && json.code) ? String(json.code) : '';

      if (code === 'AUTH_REQUIRED') {
        clearToken();
        try { window.dispatchEvent(new CustomEvent('app:auth-expired')); } catch (e2) {}
      }
      throw new ApiError(msg, code, response.status);
    }

    return json.data;
  }

  /* =========================================================
     Core call with retry
     ========================================================= */
  async function call(action, payload, opts) {
    opts = opts || {};
    const maxAttempts = 1 + (opts.retry === false ? 0 : (cfg.NETWORK.RETRY_ATTEMPTS || 0));
    let lastErr = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await rawCall(action, payload, opts);
      } catch (err) {
        lastErr = err;
        const isLast = attempt === maxAttempts - 1;
        if (isLast || !isRetryable(err)) throw err;
        await sleep((cfg.NETWORK.RETRY_BACKOFF_MS || 800) * (attempt + 1));
      }
    }
    throw lastErr || new ApiError('Request failed.', 'UNKNOWN', 0);
  }

  /* =========================================================
     AUTH
     ========================================================= */

  /**
   * login — public, no token required, no retry (avoids lockout).
   * @returns {Promise<{token:string, user:object}>}
   */
  async function login(email, password) {
    const data = await call(
      'login',
      { email: email, password: password },
      { authenticated: false, retry: false }
    );
    if (data && data.token) setToken(data.token);
    return data; // { token, user }
  }

  /** logout — best-effort; clears local token regardless. */
  async function logout() {
    try {
      if (hasToken()) {
        await call('logout', {}, { retry: false });
      }
    } catch (e) {
      // ignore — server-side session is cleaned up on expiry
    } finally {
      clearToken();
    }
  }

  /** me — refresh the current user profile from the backend. */
  async function me() {
    return call('me', {}, {});
  }

  /* =========================================================
     STUDENT
     ========================================================= */
  function getStudentDashboard() {
    return call('getStudentDashboard', {}, {});
  }
  function getTreasureHunts() {
    return call('getTreasureHunts', {}, {});
  }
  function getHunt(huntId) {
    return call('getHunt', { huntId: huntId }, {});
  }
  function getChallengeByToken(qrToken) {
    return call('getChallengeByToken', { qrToken: qrToken }, {});
  }
  function getQuizForStudent(challengeId) {
    return call('getQuizForStudent', { challengeId: challengeId }, {});
  }
  /**
   * submitQuiz — idempotent.
   * Always pass a submissionId. If the network fails and this is
   * retried, the backend will return the SAME result (no double points).
   * Use generateSubmissionId() once per attempt-cycle.
   */
  function submitQuiz(challengeId, answers, submissionId) {
    if (!submissionId) {
      throw new ApiError('submissionId is required (idempotency key).', 'BAD_REQUEST', 0);
    }
    return call('submitQuiz', {
      challengeId: challengeId,
      answers: answers || {},
      submissionId: submissionId
    }, {});
  }
  function getLeaderboard(params) {
    params = params || {};
    return call('getLeaderboard', {
      scope: params.scope || 'school',
      classId: params.classId || '',
      huntId: params.huntId || ''
    }, {});
  }
  function getMyProgress() {
    return call('getMyProgress', {}, {});
  }
  function getMyAchievements() {
    return call('getMyAchievements', {}, {});
  }
  function getMyProfile() {
    return call('getMyProfile', {}, {});
  }
  function updateMyProfile(displayName) {
    return call('updateMyProfile', { displayName: displayName }, {});
  }

  /* =========================================================
     TEACHER
     ========================================================= */
  const teacher = {
    getOverview:      function () { return call('teacher.getOverview', {}, {}); },

    getHunts:         function () { return call('teacher.getHunts', {}, {}); },
    createHunt:       function (h) { return call('teacher.createHunt', h || {}, {}); },
    updateHunt:       function (h) { return call('teacher.updateHunt', h || {}, {}); },
    deleteHunt:       function (huntId) { return call('teacher.deleteHunt', { huntId: huntId }, {}); },

    getChallenges:    function (huntId) {
      return call('teacher.getChallenges', { huntId: huntId || '' }, {});
    },
    createChallenge:  function (c) { return call('teacher.createChallenge', c || {}, {}); },
    updateChallenge:  function (c) { return call('teacher.updateChallenge', c || {}, {}); },
    regenerateToken:  function (challengeId) {
      return call('teacher.regenerateToken', { challengeId: challengeId }, {});
    },
    disableChallenge: function (challengeId) {
      return call('teacher.disableChallenge', { challengeId: challengeId }, {});
    },

    getQuizzes:       function () { return call('teacher.getQuizzes', {}, {}); },
    getQuiz:          function (quizId) {
      return call('teacher.getQuiz', { quizId: quizId }, {});
    },
    saveQuiz:         function (quiz) { return call('teacher.saveQuiz', quiz || {}, {}); },
    deleteQuiz:       function (quizId) {
      return call('teacher.deleteQuiz', { quizId: quizId }, {});
    },

    getStudents:      function () { return call('teacher.getStudents', {}, {}); },
    getStudentReport: function (studentId) {
      return call('teacher.getStudentReport', { studentId: studentId }, {});
    },
    getReports:       function (params) {
      params = params || {};
      return call('teacher.getReports', {
        classId: params.classId || '',
        huntId:  params.huntId  || ''
      }, {});
    },
    getAudit:         function (limit) {
      return call('teacher.getAudit', { limit: limit || 100 }, {});
    },
    getClasses:       function () { return call('teacher.getClasses', {}, {}); }
  };

  /* =========================================================
     ADMIN
     ========================================================= */
  const admin = {
    getUsers:         function () { return call('admin.getUsers', {}, {}); },
    createTeacher:    function (t) { return call('admin.createTeacher', t || {}, {}); },
    createStudent:    function (s) { return call('admin.createStudent', s || {}, {}); },
    updateUserStatus: function (p) { return call('admin.updateUserStatus', p || {}, {}); },
    updateUserClass:  function (p) { return call('admin.updateUserClass', p || {}, {}); },
    resetPassword:    function (p) { return call('admin.resetPassword', p || {}, {}); },

    getClasses:       function () { return call('admin.getClasses', {}, {}); },
    createClass:      function (p) { return call('admin.createClass', p || {}, {}); },
    assignTeacherToClass: function (p) {
      return call('admin.assignTeacherToClass', p || {}, {});
    },

    getAudit:         function (limit) {
      return call('admin.getAudit', { limit: limit || 100 }, {});
    },
    getStats:         function () { return call('admin.getStats', {}, {}); }
  };

  /* =========================================================
     PUBLIC
     ========================================================= */
  window.APP.api = {
    // diagnostics
    ApiError: ApiError,
    isAuthError: isAuthError,
    isNetworkError: isNetworkError,
    safeMessage: safeMessage,
    generateSubmissionId: generateSubmissionId,

    // token helpers (rarely needed outside this module)
    getToken: getToken,
    hasToken: hasToken,
    clearToken: clearToken,

    // low-level escape hatch (avoid in UI code)
    call: call,

    // auth
    login: login,
    logout: logout,
    me: me,

    // student
    getStudentDashboard: getStudentDashboard,
    getTreasureHunts: getTreasureHunts,
    getHunt: getHunt,
    getChallengeByToken: getChallengeByToken,
    getQuizForStudent: getQuizForStudent,
    submitQuiz: submitQuiz,
    getLeaderboard: getLeaderboard,
    getMyProgress: getMyProgress,
    getMyAchievements: getMyAchievements,
    getMyProfile: getMyProfile,
    updateMyProfile: updateMyProfile,

    // namespaced
    teacher: teacher,
    admin: admin
  };
})();
