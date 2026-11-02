/* =========================================================
   TREASURE HUNT APP — qr-scanner.js
   ---------------------------------------------------------
   View: student.scan  →  APP.views.renderStudentScan

   Entry paths:
     1. Live camera scan (html5-qrcode, loaded in index.html)
     2. Manual token entry (fallback / no camera)
     3. Deep link: ctx.params.pendingToken from ?challenge=qr_xxx

   Flow on success:
     stopCamera()  →  APP.api.getChallengeByToken(token)
        ├── hasQuiz  → "Start quiz"  → navigate('student.quiz')
        ├── formUrl  → "Open Google Form" (new tab, teacher verifies)
        ├── completed→ "View in My Progress"
        └── neither  → "Contact your teacher"

   Security notes:
     - Frontend only extracts/validates token SHAPE. The backend
       validates existence, active status, date window, class.
     - QR codes prove possession of the code, NOT physical presence.
       A photo of a code works — that's inherent to QR, not a bug
       we can fix client-side. Teachers may rotate tokens.

   Cleanup:
     ctx.onCleanup fires on route change AND on logout
     (via APP.auth.onAuthChanged). Both paths stop the camera.
   ========================================================= */

window.APP = window.APP || {};
window.APP.views = window.APP.views || {};

(function () {
  'use strict';

  const cfg = window.APP.config;

  /* ---------------------------------------------------------
     One-time style injection to tame html5-qrcode's default UI
     --------------------------------------------------------- */
  let styleInjected = false;
  function injectScannerStyles() {
    if (styleInjected) return;
    styleInjected = true;
    const style = document.createElement('style');
    style.textContent = [
      '#qr-reader { width: 100% !important; height: 100% !important; }',
      '#qr-reader video { width: 100% !important; height: 100% !important;',
      '  object-fit: cover !important; border-radius: 12px !important; }',
      '#qr-reader canvas { display: none !important; }',
      '#qr-reader img { display: none !important; }',
      '#qr-reader__dashboard,',
      '#qr-reader__dashboard_section,',
      '#qr-reader__dashboard_section_csr,',
      '#qr-reader__dashboard_section_swaplink,',
      '#qr-reader__status_span,',
      '#qr-reader__header_message { display: none !important; }',
      '#qr-reader__scan_region { border: none !important; box-shadow: none !important; }'
    ].join('\n');
    document.head.appendChild(style);
  }

  /* ---------------------------------------------------------
     Small helpers (self-sufficient; delegate to APP.ui when ready)
     --------------------------------------------------------- */
  function el(tag, attrs, children) {
    if (window.APP.ui && typeof window.APP.ui.el === 'function') {
      return window.APP.ui.el(tag, attrs, children);
    }
    // Minimal fallback (should not be reached once app.js has loaded)
    const node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      const v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'className') node.className = v;
      else if (k === 'textContent') node.textContent = v;
      else if (k === 'innerHTML') node.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k.indexOf('on') === 0 && typeof v === 'function') {
        node.addEventListener(k.substring(2).toLowerCase(), v);
      } else node.setAttribute(k, String(v));
    });
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c == null || c === false) return;
        if (typeof c === 'string' || typeof c === 'number') {
          node.appendChild(document.createTextNode(String(c)));
        } else if (c instanceof Node) node.appendChild(c);
      });
    }
    return node;
  }

  function toast(msg, type, timeout) {
    if (window.APP.ui && typeof window.APP.ui.toast === 'function') {
      window.APP.ui.toast(msg, type, timeout);
    } else {
      try { console.log('[toast]', type || '', msg); } catch (e) {}
    }
  }

  /* ---------------------------------------------------------
     Token extraction — accept raw token, URL, or URL-with-param
     --------------------------------------------------------- */
  function extractToken(text) {
    if (!text) return '';
    const t = String(text).trim();
    if (cfg.SCANNER.TOKEN_REGEX.test(t)) return t;
    try {
      const u = new URL(t);
      const c = u.searchParams.get('challenge');
      if (c && cfg.SCANNER.TOKEN_REGEX.test(c)) return c;
    } catch (e) { /* not a URL */ }
    const m = /[?&#]challenge=([^&\s#]+)/i.exec(t);
    if (m) {
      try {
        const c = decodeURIComponent(m[1]);
        if (cfg.SCANNER.TOKEN_REGEX.test(c)) return c;
      } catch (e) { /* ignore */ }
    }
    return '';
  }

  /* =========================================================
     VIEW
     ========================================================= */
  function renderStudentScan(container, ctx) {
    container.innerHTML = '';
    injectScannerStyles();

    const api = window.APP.api;

    /* ---------- Local state ---------- */
    let scanner = null;
    let isScanning = false;
    let isLookingUp = false;
    let isMounted = true;
    let cameras = [];
    let currentCameraIndex = 0;
    let lastScanTime = 0;
    let lastScanToken = '';

    /* ---------- Screens (only one visible at a time) ---------- */
    const screens = {};
    function makeScreen(name) {
      const s = el('div', {
        className: 'scan-screen' + (name === 'scanner' ? '' : ' hidden'),
        'data-screen': name
      });
      screens[name] = s;
      container.appendChild(s);
      return s;
    }
    function showScreen(name) {
      Object.keys(screens).forEach(function (k) {
        if (k === name) screens[k].classList.remove('hidden');
        else screens[k].classList.add('hidden');
      });
    }

    /* =========================================================
       SCREEN: scanner (camera + manual entry)
       ========================================================= */
    const scannerScreen = makeScreen('scanner');
    const scannerWrap = el('div', { className: 'scanner-wrap' });

    // --- stage: video + overlay + idle placeholder ---
    const stage = el('div', { className: 'scanner-stage', id: 'scanner-stage' });
    const qrReader = el('div', { id: 'qr-reader' });
    qrReader.style.width = '100%';
    qrReader.style.height = '100%';
    const overlay = el('div', { className: 'scanner-overlay hidden' });

    const idlePlaceholder = el('div', { className: 'scanner-idle' });
    idlePlaceholder.style.cssText = [
      'position:absolute; inset:0;',
      'background:#0f2a44; color:#c7d5e5;',
      'border-radius:12px;',
      'display:flex; flex-direction:column;',
      'align-items:center; justify-content:center;',
      'padding:24px; text-align:center;'
    ].join('');
    idlePlaceholder.appendChild(el('div', {
      textContent: 'Camera is off',
      style: { fontWeight: '600', marginBottom: '6px' }
    }));
    idlePlaceholder.appendChild(el('p', {
      textContent: 'Tap "Start camera" below to begin scanning.',
      style: { color: '#8fa9c4', fontSize: '.85rem', margin: '0' }
    }));

    stage.appendChild(qrReader);
    stage.appendChild(overlay);
    stage.appendChild(idlePlaceholder);

    scannerWrap.appendChild(stage);

    // --- hint line ---
    const hint = el('div', {
      className: 'scanner-hint hidden',
      textContent: 'Point your camera at a Treasure Hunt QR code'
    });
    scannerWrap.appendChild(hint);

    // --- controls ---
    const controls = el('div', {
      className: 'scanner-controls',
      style: { display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '14px', flexWrap: 'wrap' }
    });
    const startBtn = el('button', { type: 'button', className: 'btn btn-primary', textContent: 'Start camera' });
    const stopBtn  = el('button', { type: 'button', className: 'btn btn-outline hidden', textContent: 'Stop camera' });
    const switchBtn= el('button', { type: 'button', className: 'btn btn-outline hidden', textContent: 'Switch camera' });
    controls.appendChild(startBtn);
    controls.appendChild(stopBtn);
    controls.appendChild(switchBtn);
    scannerWrap.appendChild(controls);

    // --- manual entry ---
    scannerWrap.appendChild(el('div', { className: 'divider' }));
    const manualWrap = el('div', { className: 'manual-entry' });
    manualWrap.appendChild(el('p', {
      className: 'muted',
      style: { marginBottom: '8px' },
      textContent: 'Or enter the code printed on the QR card:'
    }));
    const manualForm = el('form', { className: 'manual-code', id: 'manual-form' });
    const manualInput = el('input', {
      type: 'text',
      id: 'manual-input',
      placeholder: 'Enter code',
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
      inputmode: 'text'
    });
    const manualBtn = el('button', { type: 'submit', className: 'btn btn-secondary', textContent: 'Look up' });
    manualForm.appendChild(manualInput);
    manualForm.appendChild(manualBtn);
    manualWrap.appendChild(manualForm);
    const manualError = el('div', { className: 'error-text hidden', id: 'manual-error' });
    manualWrap.appendChild(manualError);
    scannerWrap.appendChild(manualWrap);

    scannerScreen.appendChild(scannerWrap);

    /* =========================================================
       SCREEN: lookup (loading)
       ========================================================= */
    const lookupScreen = makeScreen('lookup');
    const lookupCard = el('div', { className: 'card' });
    const lookupBody = el('div', { className: 'card-body', style: { textAlign: 'center', padding: '48px 24px' } });
    lookupBody.appendChild(el('div', { className: 'spinner', style: { margin: '0 auto 16px' } }));
    lookupBody.appendChild(el('h3', { textContent: 'Looking up challenge\u2026' }));
    lookupBody.appendChild(el('p', { className: 'muted', textContent: 'Verifying this code with the server.' }));
    lookupCard.appendChild(lookupBody);
    lookupScreen.appendChild(lookupCard);

    /* =========================================================
       SCREEN: challenge (success)
       ========================================================= */
    const challengeScreen = makeScreen('challenge');

    /* =========================================================
       SCREEN: error
       ========================================================= */
    const errorScreen = makeScreen('error');

    /* =========================================================
       UI state helpers
       ========================================================= */
    function setIdleUI() {
      idlePlaceholder.classList.remove('hidden');
      overlay.classList.add('hidden');
      hint.classList.add('hidden');
      startBtn.classList.remove('hidden');
      stopBtn.classList.add('hidden');
      switchBtn.classList.add('hidden');
      startBtn.disabled = false;
    }
    function setStartingUI() {
      idlePlaceholder.classList.add('hidden');
      overlay.classList.add('hidden');
      hint.classList.add('hidden');
      startBtn.classList.add('hidden');
      stopBtn.classList.add('hidden');
      switchBtn.classList.add('hidden');
    }
    function setScanningUI() {
      idlePlaceholder.classList.add('hidden');
      overlay.classList.remove('hidden');
      hint.classList.remove('hidden');
      startBtn.classList.add('hidden');
      stopBtn.classList.remove('hidden');
      updateSwitchButton();
    }
    function updateSwitchButton() {
      if (isScanning && cameras.length > 1) switchBtn.classList.remove('hidden');
      else switchBtn.classList.add('hidden');
    }

    /* =========================================================
       Camera lifecycle
       ========================================================= */
    function cleanupScanner() {
      if (!scanner) { isScanning = false; return; }
      const s = scanner;
      scanner = null;
      isScanning = false;
      try { s.stop().catch(function () {}); } catch (e) {}
      try { s.clear(); } catch (e) {}
    }

    function qrboxFor(vfW, vfH) {
      const minEdge = Math.min(vfW, vfH);
      const size = Math.floor(minEdge * 0.7);
      return { width: size, height: size };
    }

    function cameraStartConfig() {
      // Prefer rear camera; fall back to any.
      if (cameras.length && cameras[currentCameraIndex]) {
        return { deviceId: { exact: cameras[currentCameraIndex].id } };
      }
      return { facingMode: 'environment' };
    }

    async function startCamera() {
      if (isScanning || !isMounted) return;

      if (typeof window.Html5Qrcode === 'undefined') {
        showCameraError({ kind: 'unsupported' });
        return;
      }
      if (!cfg.isSecureContextOk()) {
        showCameraError({ kind: 'insecure' });
        return;
      }

      setStartingUI();
      try {
        // Prime the camera list first (this prompts for permission once,
        // and gives us labels so we can pick "rear" if available).
        try {
          const list = await window.Html5Qrcode.getCameras();
          cameras = Array.isArray(list) ? list : [];
          if (cameras.length) {
            const rearIdx = cameras.findIndex(function (c) {
              return /back|rear|environment/i.test(c.label || '');
            });
            currentCameraIndex = rearIdx >= 0 ? rearIdx : 0;
          }
        } catch (permErr) {
          cameras = [];
          // If permission was denied, we'll still attempt start() and let it
          // produce the canonical NotAllowedError for a consistent message.
        }

        if (!isMounted) return;

        scanner = new window.Html5Qrcode('qr-reader', { verbose: false });
        await scanner.start(
          cameraStartConfig(),
          {
            fps: cfg.SCANNER.FPS || 10,
            qrbox: qrboxFor
          },
          onScanSuccess,
          function onScanError() { /* no QR in frame — ignore */ }
        );

        if (!isMounted) { cleanupScanner(); return; }
        isScanning = true;
        setScanningUI();
        updateSwitchButton();
      } catch (err) {
        scanner = null;
        isScanning = false;
        showCameraError(err || {});
      }
    }

    async function stopCamera() {
      if (!scanner) { setIdleUI(); return; }
      const s = scanner;
      scanner = null;
      isScanning = false;
      try { await s.stop(); } catch (e) {}
      try { s.clear(); } catch (e) {}
      if (isMounted) setIdleUI();
    }

    async function switchCamera() {
      if (!scanner || !isScanning || cameras.length < 2) return;
      try {
        switchBtn.disabled = true;
        currentCameraIndex = (currentCameraIndex + 1) % cameras.length;
        await scanner.stop();
        await scanner.start(
          { deviceId: { exact: cameras[currentCameraIndex].id } },
          { fps: cfg.SCANNER.FPS || 10, qrbox: qrboxFor },
          onScanSuccess,
          function onScanError() {}
        );
      } catch (err) {
        toast('Could not switch camera. Try again.', 'error');
      } finally {
        switchBtn.disabled = false;
      }
    }

    /* =========================================================
       Error display
       ========================================================= */
    function showCameraError(err) {
      isScanning = false;
      setIdleUI();

      const name = err && (err.name || err.code) ? String(err.name || err.code) : '';
      const kind = err && err.kind ? err.kind : '';
      let message = 'Could not start the camera.';

      if (kind === 'insecure' || /NotSupportedError/i.test(name)) {
        message = 'Camera access requires a secure HTTPS connection. Use manual entry below.';
      } else if (kind === 'unsupported') {
        message = 'The QR scanner library failed to load. Use manual entry below.';
      } else if (/NotAllowedError|PermissionDeniedError/i.test(name)) {
        message = 'Camera permission was denied. Allow camera access in your browser settings and try again.';
      } else if (/NotFoundError|DevicesNotFoundError/i.test(name)) {
        message = 'No camera was found on this device. Use manual entry below.';
      } else if (/NotReadableError|TrackStartError/i.test(name)) {
        message = 'The camera is being used by another app. Close it and try again.';
      } else if (/OverconstrainedError|ConstraintNotSatisfiedError/i.test(name)) {
        message = 'This camera does not support the required settings. Try switching cameras.';
      } else if (err && typeof err.message === 'string' && err.message.length < 200) {
        message = err.message;
      }

      showErrorScreen('Camera unavailable', message);
    }

    function showErrorScreen(title, message) {
      errorScreen.innerHTML = '';
      const card = el('div', { className: 'card' });
      const body = el('div', { className: 'card-body', style: { textAlign: 'center', padding: '36px 24px' } });
      body.appendChild(el('h3', { textContent: title || 'Something went wrong' }));
      body.appendChild(el('p', { className: 'muted', textContent: message || '' }));
      const backBtn = el('button', {
        type: 'button',
        className: 'btn btn-primary',
        textContent: 'Back to scanner',
        onClick: function () {
          showScreen('scanner');
          setIdleUI();
        }
      });
      body.appendChild(backBtn);
      card.appendChild(body);
      errorScreen.appendChild(card);
      showScreen('error');
    }

    /* =========================================================
       Scan → lookup → challenge
       ========================================================= */
    function onScanSuccess(decodedText) {
      if (!isScanning) return;
      isScanning = false; // synchronous guard against repeat fire

      const now = Date.now();
      if (now - lastScanTime < 1500 && decodedText === lastScanToken) return;
      lastScanTime = now;
      lastScanToken = decodedText;

      const token = extractToken(decodedText);
      if (!token) {
        toast('That QR code is not a Treasure Hunt code.', 'warn', 2500);
        // Resume scanning: start() is still running on the instance;
        // flip isScanning back on if the stream is alive.
        if (scanner) { isScanning = true; }
        return;
      }

      stopCamera();
      lookupToken(token);
    }

    async function lookupToken(token) {
      if (isLookingUp) return;
      isLookingUp = true;
      showScreen('lookup');

      try {
        const data = await api.getChallengeByToken(token);
        if (!isMounted) return;
        if (!data || !data.challenge) {
          showErrorScreen(
            'Challenge not found',
            'This code did not match any challenge. It may have been disabled.'
          );
          return;
        }
        renderChallenge(data.challenge);
      } catch (err) {
        if (!isMounted) return;
        const msg = api.safeMessage ? api.safeMessage(err) : 'Could not look up this challenge.';
        showErrorScreen('Challenge unavailable', msg);
      } finally {
        isLookingUp = false;
      }
    }

    /* =========================================================
       Challenge card
       ========================================================= */
    function renderChallenge(ch) {
      challengeScreen.innerHTML = '';
      const wrap = el('div', {
        className: 'challenge-view',
        style: { maxWidth: '640px', margin: '0 auto' }
      });

      // Back link
      const back = el('button', {
        type: 'button',
        className: 'btn btn-outline btn-sm',
        textContent: '\u2190 Back to scanner',
        onClick: function () {
          showScreen('scanner');
          setIdleUI();
        }
      });
      back.style.marginBottom = '14px';
      wrap.appendChild(back);

      // Card
      const card = el('div', { className: 'card' });
      const body = el('div', { className: 'card-body' });

      if (ch.huntName) {
        const huntLabel = el('div', {
          className: 'muted',
          textContent: String(ch.huntName),
          style: {
            fontSize: '.8rem',
            textTransform: 'uppercase',
            letterSpacing: '.05em',
            fontWeight: '600',
            marginBottom: '4px'
          }
        });
        body.appendChild(huntLabel);
      }
      body.appendChild(el('h2', { textContent: ch.name || 'Challenge', style: { marginBottom: '8px' } }));

      if (ch.description) {
        body.appendChild(el('p', { className: 'text-soft', textContent: ch.description }));
      }

      // Badges
      const badges = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '12px 0' } });
      if (ch.maxPoints) {
        badges.appendChild(el('span', { className: 'badge badge-gold', textContent: ch.maxPoints + ' points' }));
      }
      if (ch.passingPercent) {
        badges.appendChild(el('span', { className: 'badge badge-grey', textContent: 'Pass at ' + ch.passingPercent + '%' }));
      }
      if (ch.completed) {
        badges.appendChild(el('span', { className: 'badge badge-green', textContent: 'Completed' }));
      }
      body.appendChild(badges);

      // Actions
      if (ch.completed) {
        const note = el('div', {
          className: 'success-text',
          textContent: 'You\u2019ve already earned points for this challenge.',
          style: { marginBottom: '12px' }
        });
        body.appendChild(note);
        body.appendChild(el('button', {
          type: 'button',
          className: 'btn btn-primary',
          textContent: 'View in My Progress',
          onClick: function () { ctx.navigate('student.progress'); }
        }));
      } else if (ch.hasQuiz) {
        body.appendChild(el('p', {
          className: 'muted',
          textContent: 'Complete the quiz to earn these points.'
        }));
        body.appendChild(el('button', {
          type: 'button',
          className: 'btn btn-primary btn-lg',
          textContent: 'Start quiz',
          onClick: function () {
            ctx.navigate('student.quiz', { challengeId: ch.challengeId });
          }
        }));
      } else if (ch.formUrl) {
        body.appendChild(el('p', {
          className: 'muted',
          textContent: 'This challenge uses an external Google Form.'
        }));
        const info = el('span', {
          className: 'badge badge-navy',
          textContent: 'Teacher verification required',
          style: { marginBottom: '10px', display: 'inline-flex' }
        });
        body.appendChild(info);

        const openBtn = el('a', {
          href: ch.formUrl,
          target: '_blank',
          rel: 'noopener noreferrer',
          className: 'btn btn-primary btn-lg',
          textContent: 'Open Google Form'
        });
        openBtn.style.display = 'inline-flex';
        openBtn.style.textDecoration = 'none';
        body.appendChild(openBtn);

        body.appendChild(el('p', {
          className: 'muted',
          style: { fontSize: '.85rem', marginTop: '12px' },
          textContent: 'After you submit the form, your teacher will verify your answers and award points. You will not receive points automatically.'
        }));
      } else {
        body.appendChild(el('p', {
          className: 'muted',
          textContent: 'No quiz or form is configured for this challenge yet. Please contact your teacher.'
        }));
      }

      card.appendChild(body);
      wrap.appendChild(card);
      challengeScreen.appendChild(wrap);
      showScreen('challenge');
    }

    /* =========================================================
       Manual entry handler
       ========================================================= */
    manualForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      manualError.classList.add('hidden');
      manualError.textContent = '';

      const token = extractToken(manualInput.value || '');
      if (!token) {
        manualError.textContent = 'That doesn\u2019t look like a valid challenge code. Check the code on your QR card.';
        manualError.classList.remove('hidden');
        return;
      }

      manualBtn.disabled = true;
      try {
        if (isScanning) await stopCamera();
        await lookupToken(token);
      } finally {
        manualBtn.disabled = false;
      }
    });

    /* =========================================================
       Button wiring
       ========================================================= */
    startBtn.addEventListener('click', startCamera);
    stopBtn.addEventListener('click', function () { stopCamera(); });
    switchBtn.addEventListener('click', switchCamera);

    /* =========================================================
       Stop the camera when the user logs out
       (logout does not trigger a route change, so we can't rely on
        ctx.onCleanup alone)
       ========================================================= */
    const unsubAuth = window.APP.auth.onAuthChanged(function (detail) {
      if (!detail || !detail.user) cleanupScanner();
    });

    /* =========================================================
       Initial action
       ========================================================= */
    if (ctx.params && ctx.params.pendingToken) {
      // Deep link path — clear the param from URL so refresh / back-button
      // don't repeat the lookup, then process the token once.
      const pt = String(ctx.params.pendingToken || '');
      try { history.replaceState(null, '', '#student.scan'); } catch (e) {}

      const token = extractToken(pt);
      if (token) {
        lookupToken(token);
      } else {
        showErrorScreen(
          'Invalid challenge link',
          'The link you followed does not contain a valid challenge code.'
        );
      }
    } else {
      showScreen('scanner');
      setIdleUI();
    }

    /* =========================================================
       Teardown — always release the camera
       ========================================================= */
    ctx.onCleanup(function () {
      isMounted = false;
      try { unsubAuth(); } catch (e) {}
      cleanupScanner();
    });
  }

  /* =========================================================
     Register
     ========================================================= */
  window.APP.views.renderStudentScan = renderStudentScan;
})();
