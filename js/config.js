/* =========================================================
   TREASURE HUNT APP — config.js
   ---------------------------------------------------------
   Single source of truth for frontend configuration.

   IMPORTANT: this file contains NO secrets.
   The only deployment value you must set is BACKEND_URL
   (the Google Apps Script Web App /exec URL).
   Everything here is safe to ship to the browser.

   Global namespace:
     window.APP = window.APP || {};
     APP.config = { ... }         // this object
     APP.config.buildChallengeUrl(token)
     APP.config.tokenLooksValid(token)
     APP.config.validate()        // logs warnings if unconfigured
   ========================================================= */

window.APP = window.APP || {};

(function () {
  'use strict';

  /* ---------------------------------------------------------
     BACKEND — set this after deploying Code.gs as a Web App.
     Format:
       https://script.google.com/macros/s/AKfycb....../exec
     Must end with /exec (NOT /dev).
     See SETUP.md for how to obtain it.
     --------------------------------------------------------- */
  const BACKEND_URL = 'https://script.google.com/macros/s/REPLACE_WITH_YOUR_DEPLOYMENT_ID/exec';

  /* ---------------------------------------------------------
     App identity
     --------------------------------------------------------- */
  const APP_NAME = 'Treasure Hunt';
  const APP_VERSION = '1.0.0';
  const SCHOOL_NAME = 'Your School'; // shown on printed QR cards
  const EVENT_NAME = 'School Treasure Hunt';

  /* ---------------------------------------------------------
     Local storage / session keys
     --------------------------------------------------------- */
  const STORAGE = {
    TOKEN: 'th_token',
    USER: 'th_user',
    LAST_ROUTE: 'th_last_route'
  };

  /* ---------------------------------------------------------
     Network / polling behaviour
     --------------------------------------------------------- */
  const NETWORK = {
    REQUEST_TIMEOUT_MS: 30000,      // hard timeout for any API call
    RETRY_ATTEMPTS: 2,              // retries for transient failures
    RETRY_BACKOFF_MS: 800,          // base delay between retries
    LEADERBOARD_POLL_MS: 30000,     // auto-refresh interval for leaderboard
    DASHBOARD_POLL_MS: 60000        // dashboard refresh interval
  };

  /* ---------------------------------------------------------
     QR codes
     Format: the QR payload is a front-end URL, not a backend URL.
     Example:
       https://school.example/treasure-hunt/?challenge=qr_abc123...
     The frontend reads ?challenge=<token> on load (after auth)
     and asks the backend to validate it.
     --------------------------------------------------------- */
  const QR = {
    ERROR_CORRECTION_LEVEL: 'H',    // highest = survives printing
    RENDER_SIZE_PX: 320,            // rendered image size
    QUIET_ZONE_MODULES: 4,          // spec says leave a quiet zone
    DARK_COLOR: '#0f2a44',          // navy
    LIGHT_COLOR: '#ffffff',
    PRINT_CARD_COPIES_DEFAULT: 1
  };

  /* ---------------------------------------------------------
     Scanner behaviour
     --------------------------------------------------------- */
  const SCANNER = {
    FPS: 10,
    QRBOX_PX: 240,
    SUPPORTED_FORMATS: ['qr_code'],
    STOP_DELAY_AFTER_SCAN_MS: 350,  // brief pause before we route
    // Token format issued by the backend: qr_<32 hex chars>
    TOKEN_REGEX: /^qr_[a-f0-9]{32}$/i
  };

  /* ---------------------------------------------------------
     Quiz behaviour (frontend only; scoring is server-side)
     --------------------------------------------------------- */
  const QUIZ = {
    AUTO_SUBMIT_ON_TIMEOUT: true,
    WARN_SECONDS_REMAINING: 30,
    // Never trust these client-side; backend enforces real rules:
    DEFAULT_PASSING_PERCENT: 60
  };

  /* ---------------------------------------------------------
     Leaderboard
     --------------------------------------------------------- */
  const LEADERBOARD = {
    SCOPES: ['school', 'class', 'hunt'],
    DEFAULT_SCOPE: 'school',
    MAX_ROWS_RENDERED: 200
  };

  /* ---------------------------------------------------------
     NAVIGATION (from the project spec, verbatim per role)
     ---------------------------------------------------------
     Each item:
       key      – route key (used by app.js / ROUTES)
       label    – sidebar text
       title    – topbar page title
       icon     – short inline SVG path data (see icons below)
     --------------------------------------------------------- */

  const ICONS = {
    home:    'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
    camera:  'M4 7h3l2-2h6l2 2h3v12H4zm8 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    map:     'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z',
    chart:   'M4 20V10h4v10zm6 0V4h4v16zm6 0v-7h4v7z',
    trophy:  'M7 4h10v3a5 5 0 0 1-10 0zM5 6h2v1a2 2 0 0 1-2-2zm12 0h2a2 2 0 0 1-2 2zM9 15h6v3H9zM7 20h10v2H7z',
    star:    'M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5L2.6 9.8l6.5-.9z',
    user:    'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 9a8 8 0 0 1 16 0z',
    grid:    'M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z',
    qr:      'M3 3h6v6H3zm12 0h6v6h-6zM3 15h6v6H3zm9 0h3v3h-3zm3 3h3v3h-3zm0-3h3v3h-3z',
    quiz:    'M4 4h16v16H4zm4 4h8v2H8zm0 4h8v2H8zm0 4h5v2H8z',
    users:   'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 21a7 7 0 0 1 14 0zm13.5 0a6 6 0 0 0-3-5.2A5 5 0 0 1 22 21z',
    report:  'M6 3h9l5 5v13H6zM14 3v6h6M9 13h6M9 17h6',
    plug:    'M9 3v5m6-5v5M7 8h10v3a5 5 0 0 1-10 0zM12 16v5',
    cog:     'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm9 4l-2-1 1-3-3-1-1-2-3 1-1-2-1 2-3-1-1 2-3 1 1 3-2 1 2 1-1 3 3 1 1 2 3-1 1 2 1-2 3 1 1-2 3-1-1-3z',
    list:    'M4 6h16M4 12h16M4 18h16',
    shield:  'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z'
  };

  const NAV = {
    student: [
      { key: 'student.home',          label: 'Home',           title: 'Home',            icon: ICONS.home },
      { key: 'student.scan',          label: 'Scan QR Code',   title: 'Scan QR Code',    icon: ICONS.camera },
      { key: 'student.hunts',         label: 'Treasure Hunts', title: 'Treasure Hunts',  icon: ICONS.map },
      { key: 'student.progress',      label: 'My Progress',    title: 'My Progress',     icon: ICONS.chart },
      { key: 'student.leaderboard',   label: 'Leaderboard',    title: 'Leaderboard',     icon: ICONS.trophy },
      { key: 'student.achievements',  label: 'Achievements',   title: 'Achievements',    icon: ICONS.star },
      { key: 'student.profile',       label: 'My Profile',     title: 'My Profile',      icon: ICONS.user }
    ],
    teacher: [
      { key: 'teacher.dashboard',     label: 'Dashboard',      title: 'Dashboard',       icon: ICONS.grid },
      { key: 'teacher.hunts',         label: 'Treasure Hunts', title: 'Treasure Hunts',  icon: ICONS.map },
      { key: 'teacher.challenges',    label: 'Challenges',     title: 'Challenges',      icon: ICONS.list },
      { key: 'teacher.qrGenerator',   label: 'QR Generator',   title: 'QR Generator',    icon: ICONS.qr },
      { key: 'teacher.quizManager',   label: 'Quiz Manager',   title: 'Quiz Manager',    icon: ICONS.quiz },
      { key: 'teacher.students',      label: 'Students',       title: 'Students',        icon: ICONS.users },
      { key: 'teacher.leaderboards',  label: 'Leaderboards',   title: 'Leaderboards',    icon: ICONS.trophy },
      { key: 'teacher.reports',       label: 'Reports',        title: 'Reports',         icon: ICONS.report },
      { key: 'teacher.integrations',  label: 'Google Integrations', title: 'Google Integrations', icon: ICONS.plug },
      { key: 'teacher.settings',      label: 'Settings',       title: 'Settings',        icon: ICONS.cog }
    ],
    admin: [
      { key: 'admin.dashboard',       label: 'Dashboard',      title: 'Dashboard',       icon: ICONS.grid },
      { key: 'admin.users',           label: 'Users',          title: 'Users',           icon: ICONS.users },
      { key: 'admin.classes',         label: 'Classes',        title: 'Classes',         icon: ICONS.list },
      { key: 'admin.hunts',           label: 'Treasure Hunts', title: 'Treasure Hunts',  icon: ICONS.map },
      { key: 'admin.reports',         label: 'Reports',        title: 'Reports',         icon: ICONS.report },
      { key: 'admin.integrations',    label: 'Integrations',   title: 'Integrations',    icon: ICONS.plug },
      { key: 'admin.audit',           label: 'Audit Logs',     title: 'Audit Logs',      icon: ICONS.shield },
      { key: 'admin.settings',        label: 'Settings',       title: 'Settings',        icon: ICONS.cog }
    ]
  };

  const DEFAULT_ROUTE = {
    student: 'student.home',
    teacher: 'teacher.dashboard',
    admin: 'admin.dashboard'
  };

  /* ---------------------------------------------------------
     ROUTE TABLE
     ---------------------------------------------------------
     Maps every NAV key to the render function that `app.js`
     will call. Render functions live on APP.views (attached by
     dashboard.js, qr-scanner.js, leaderboard.js, teacher.js,
     admin.js, etc.).

     A render function signature:
       async function render(container, ctx) { ... }
       - container: HTMLElement (the #view element)
       - ctx: { user, route, params }
     --------------------------------------------------------- */
  const ROUTES = {
    // Student
    'student.home':         { view: 'renderStudentHome',      requiresRole: 'student' },
    'student.scan':         { view: 'renderStudentScan',      requiresRole: 'student' },
    // Sub-route (NOT in student NAV): reached via
    //   ctx.navigate('student.quiz', { challengeId })
    // from the QR scanner (after a successful token lookup)
    // and from hunt cards ("Continue" / "Start" button).
    // Rendered by quizzes.js.
    'student.quiz':         { view: 'renderStudentQuiz',      requiresRole: 'student' },
    'student.hunts':        { view: 'renderStudentHunts',     requiresRole: 'student' },
    'student.progress':     { view: 'renderStudentProgress',  requiresRole: 'student' },
    'student.leaderboard':  { view: 'renderStudentLeaderboard', requiresRole: 'student' },
    'student.achievements': { view: 'renderStudentAchievements', requiresRole: 'student' },
    'student.profile':      { view: 'renderStudentProfile',   requiresRole: 'student' },

    // Teacher
    'teacher.dashboard':    { view: 'renderTeacherDashboard', requiresRole: 'teacher' },
    'teacher.hunts':        { view: 'renderTeacherHunts',     requiresRole: 'teacher' },
    'teacher.challenges':   { view: 'renderTeacherChallenges', requiresRole: 'teacher' },
    'teacher.qrGenerator':  { view: 'renderTeacherQRGenerator', requiresRole: 'teacher' },
    'teacher.quizManager':  { view: 'renderTeacherQuizManager', requiresRole: 'teacher' },
    'teacher.students':     { view: 'renderTeacherStudents',  requiresRole: 'teacher' },
    'teacher.leaderboards': { view: 'renderTeacherLeaderboards', requiresRole: 'teacher' },
    'teacher.reports':      { view: 'renderTeacherReports',   requiresRole: 'teacher' },
    'teacher.integrations': { view: 'renderTeacherIntegrations', requiresRole: 'teacher' },
    'teacher.settings':     { view: 'renderTeacherSettings',  requiresRole: 'teacher' },

    // Admin
    'admin.dashboard':      { view: 'renderAdminDashboard',   requiresRole: 'admin' },
    'admin.users':          { view: 'renderAdminUsers',       requiresRole: 'admin' },
    'admin.classes':        { view: 'renderAdminClasses',     requiresRole: 'admin' },
    'admin.hunts':          { view: 'renderAdminHunts',       requiresRole: 'admin' },
    'admin.reports':        { view: 'renderAdminReports',     requiresRole: 'admin' },
    'admin.integrations':   { view: 'renderAdminIntegrations', requiresRole: 'admin' },
    'admin.audit':          { view: 'renderAdminAudit',       requiresRole: 'admin' },
    'admin.settings':       { view: 'renderAdminSettings',    requiresRole: 'admin' }
  };

  /* ---------------------------------------------------------
     Helpers
     --------------------------------------------------------- */

  /**
   * Build the URL embedded inside a QR code for a challenge token.
   * This is a FRONTEND URL. The frontend reads ?challenge=<token>
   * after auth and asks the backend to validate it.
   * @param {string} token - qr_<hex> from backend
   * @returns {string}
   */
  function buildChallengeUrl(token) {
    const base = window.location.origin + window.location.pathname;
    const clean = base.split('?')[0].split('#')[0];
    return clean + '?challenge=' + encodeURIComponent(String(token || ''));
  }

  /**
   * Read the ?challenge=<token> query param, if present.
   * @returns {string} token or ''
   */
  function readChallengeParam() {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('challenge') || '';
    } catch (e) {
      return '';
    }
  }

  /**
   * Remove ?challenge= from the address bar without reloading.
   */
  function clearChallengeParam() {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('challenge');
      window.history.replaceState({}, '', url.pathname + (url.search ? url.search : '') + url.hash);
    } catch (e) { /* no-op */ }
  }

  /**
   * Validate the shape of a QR token client-side (fast fail).
   * The backend still validates existence/active/availability.
   */
  function tokenLooksValid(token) {
    return SCANNER.TOKEN_REGEX.test(String(token || '').trim());
  }

  /**
   * Are we on https:// or localhost? (camera + fetch cookies safety)
   */
  function isSecureContextOk() {
    return window.isSecureContext === true ||
      location.hostname === 'localhost' ||
      location.hostname === '127.0.0.1';
  }

  /**
   * Warn in the console if the backend URL has not been configured.
   * Called by app.js at boot. Never throws.
   */
  function validate() {
    const problems = [];
    if (!BACKEND_URL || /REPLACE_WITH_YOUR_DEPLOYMENT_ID/.test(BACKEND_URL)) {
      problems.push('BACKEND_URL is not configured. Deploy Code.gs and paste the /exec URL into js/config.js.');
    } else if (!/\/exec(\?|$)/.test(BACKEND_URL)) {
      problems.push('BACKEND_URL should end with /exec, not /dev.');
    }
    if (!isSecureContextOk()) {
      problems.push('Camera access requires HTTPS (or localhost). The QR scanner will be unavailable.');
    }
    if (problems.length) {
      console.warn('[Treasure Hunt] Configuration warnings:\n - ' + problems.join('\n - '));
    }
    return { ok: problems.length === 0, problems: problems };
  }

  /* ---------------------------------------------------------
     Public config object
     --------------------------------------------------------- */
  const config = {
    BACKEND_URL: BACKEND_URL,
    APP_NAME: APP_NAME,
    APP_VERSION: APP_VERSION,
    SCHOOL_NAME: SCHOOL_NAME,
    EVENT_NAME: EVENT_NAME,

    STORAGE: STORAGE,
    NETWORK: NETWORK,
    QR: QR,
    SCANNER: SCANNER,
    QUIZ: QUIZ,
    LEADERBOARD: LEADERBOARD,

    NAV: NAV,
    DEFAULT_ROUTE: DEFAULT_ROUTE,
    ROUTES: ROUTES,

    ICONS: ICONS,

    buildChallengeUrl: buildChallengeUrl,
    readChallengeParam: readChallengeParam,
    clearChallengeParam: clearChallengeParam,
    tokenLooksValid: tokenLooksValid,
    isSecureContextOk: isSecureContextOk,
    validate: validate
  };

  window.APP.config = config;

  // Friendly banner in the console (useful when debugging)
  try {
    console.log('%cTreasure Hunt ' + APP_VERSION, 'color:#1f9d55;font-weight:bold', 'frontend loaded');
  } catch (e) { /* no-op */ }
})();
