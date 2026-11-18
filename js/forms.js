/* =========================================================
   TREASURE HUNT APP — forms.js
   ---------------------------------------------------------
   Forms Builder (admin) + public form page (opened by QR).

   Admin route : admin.forms  → APP.views.renderAdminForms
   Public page : <site>/?form=<token> → APP.forms.mountPublic(token)

   Backend contract (see Code.gs, "FORMS BUILDER"):
     api.forms.getForms()            → [form + responseCount]
     api.forms.saveForm(form)        → form          (create if no formId)
     api.forms.deleteForm(id)        → { ok }
     api.forms.regenerateToken(id)   → { token }
     api.forms.getResponses(id)      → { form, responses[] }
     api.forms.deleteResponse(id)    → { ok }
     api.forms.publicGet(token)      → { state: open|closed|login|already, ... }
     api.forms.publicSubmit(t,a,sid) → { ok, message }

   All user-supplied text is inserted with textContent (never
   innerHTML), so form titles / answers cannot inject markup.
   ========================================================= */

window.APP = window.APP || {};
window.APP.views = window.APP.views || {};

(function () {
  'use strict';

  const cfg = window.APP.config;

  function api() { return window.APP.api; }
  function ui() { return window.APP.ui; }
  function el(tag, attrs, children) { return ui().el(tag, attrs, children); }
  function safeMsg(err) {
    const a = api();
    return a && a.safeMessage ? a.safeMessage(err) : ((err && err.message) || 'Something went wrong.');
  }

  /* =========================================================
     FIELD TYPES
     ========================================================= */
  const TYPES = [
    { type: 'text',      label: 'Short answer' },
    { type: 'paragraph', label: 'Paragraph' },
    { type: 'choice',    label: 'Multiple choice (pick one)', options: true },
    { type: 'multi',     label: 'Checkboxes (pick many)',     options: true },
    { type: 'dropdown',  label: 'Dropdown',                   options: true },
    { type: 'rating',    label: 'Rating scale' },
    { type: 'number',    label: 'Number' },
    { type: 'email',     label: 'Email address' },
    { type: 'date',      label: 'Date' },
    { type: 'heading',   label: 'Section heading / text' }
  ];
  function typeMeta(t) { return TYPES.find(function (x) { return x.type === t; }) || TYPES[0]; }
  function hasOptions(t) { return !!typeMeta(t).options; }

  function uid() {
    let r = Math.random().toString(36).slice(2, 10);
    while (r.length < 6) r += Math.floor(Math.random() * 36).toString(36);
    return 'f_' + r;
  }

  function newField(type) {
    const f = { id: uid(), type: type, label: '', help: '', required: false };
    if (hasOptions(type)) f.options = ['Option 1', 'Option 2'];
    if (type === 'rating') f.scale = 5;
    return f;
  }

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /* =========================================================
     SHARED FORM RENDERER (public page + admin preview)
     ========================================================= */
  function renderFormFields(container, fields) {
    const controls = []; // { field, wrap, errEl, get() }

    fields.forEach(function (f) {
      if (f.type === 'heading') {
        const h = el('div', { className: 'ff-heading' });
        h.appendChild(el('h3', { textContent: f.label }));
        if (f.help) h.appendChild(el('p', { className: 'muted', textContent: f.help }));
        container.appendChild(h);
        return;
      }

      const wrap = el('div', { className: 'ff' });
      const label = el('div', { className: 'ff-label' });
      label.appendChild(document.createTextNode(f.label));
      if (f.required) label.appendChild(el('span', { className: 'ff-req', textContent: ' *' }));
      wrap.appendChild(label);
      if (f.help) wrap.appendChild(el('div', { className: 'ff-help', textContent: f.help }));

      let get;
      let focusEl = null;

      if (f.type === 'text' || f.type === 'email' || f.type === 'date' || f.type === 'number') {
        const input = el('input', {
          type: f.type === 'text' ? 'text' : f.type,
          autocomplete: 'off'
        });
        if (f.type === 'text') input.setAttribute('maxlength', '500');
        if (f.type === 'number') {
          input.setAttribute('step', 'any');
          input.setAttribute('inputmode', 'decimal');
          if (f.min != null) input.setAttribute('min', String(f.min));
          if (f.max != null) input.setAttribute('max', String(f.max));
        }
        wrap.appendChild(input);
        focusEl = input;
        get = function () { return input.value.trim(); };

      } else if (f.type === 'paragraph') {
        const ta = el('textarea', { maxlength: '1500', rows: '4' });
        wrap.appendChild(ta);
        focusEl = ta;
        get = function () { return ta.value.trim(); };

      } else if (f.type === 'choice' || f.type === 'multi') {
        const group = 'q_' + f.id;
        const isMulti = f.type === 'multi';
        const list = el('div', { className: 'ff-options' });
        (f.options || []).forEach(function (o) {
          const input = el('input', { type: isMulti ? 'checkbox' : 'radio', name: group });
          input.value = o;
          const row = el('label', { className: 'ff-option' });
          row.appendChild(input);
          row.appendChild(el('span', { textContent: o }));
          list.appendChild(row);
        });
        wrap.appendChild(list);
        focusEl = list.querySelector('input');
        get = function () {
          const checked = Array.prototype.map.call(list.querySelectorAll('input:checked'), function (i) { return i.value; });
          return isMulti ? checked : (checked[0] || '');
        };

      } else if (f.type === 'dropdown') {
        const sel = el('select');
        const ph = el('option', { textContent: 'Select\u2026' });
        ph.value = '';
        sel.appendChild(ph);
        (f.options || []).forEach(function (o) {
          const opt = el('option', { textContent: o });
          opt.value = o;
          sel.appendChild(opt);
        });
        wrap.appendChild(sel);
        focusEl = sel;
        get = function () { return sel.value; };

      } else if (f.type === 'rating') {
        const scale = f.scale || 5;
        let val = 0;
        const row = el('div', { className: 'ff-rating' });
        const btns = [];
        function paint() {
          btns.forEach(function (b, i) { b.classList.toggle('on', i + 1 <= val); });
        }
        for (let n = 1; n <= scale; n++) {
          (function (n) {
            const b = el('button', {
              type: 'button', className: 'ff-rate', textContent: String(n),
              'aria-label': 'Rate ' + n + ' out of ' + scale,
              onClick: function () { val = (val === n) ? 0 : n; paint(); }
            });
            btns.push(b);
            row.appendChild(b);
          })(n);
        }
        wrap.appendChild(row);
        wrap.appendChild(el('div', { className: 'ff-help', textContent: '1 = lowest, ' + scale + ' = highest' }));
        focusEl = btns[0];
        get = function () { return val || ''; };
      }

      const errEl = el('div', { className: 'error-text hidden' });
      wrap.appendChild(errEl);
      container.appendChild(wrap);
      controls.push({ field: f, wrap: wrap, errEl: errEl, get: get, focusEl: focusEl });
    });

    function setError(c, msg) {
      c.errEl.textContent = msg || '';
      c.errEl.classList.toggle('hidden', !msg);
      c.wrap.classList.toggle('ff-invalid', !!msg);
    }

    return {
      /** Validates and returns { ok, answers }. Shows inline errors. */
      collect: function () {
        const answers = {};
        let firstBad = null;
        controls.forEach(function (c) {
          const f = c.field;
          const v = c.get();
          const empty = v === '' || v == null || (Array.isArray(v) && !v.length);
          let msg = '';
          if (empty) {
            if (f.required) msg = 'This question is required.';
          } else if (f.type === 'email' && !EMAIL_RE.test(String(v))) {
            msg = 'Enter a valid email address.';
          } else if (f.type === 'number') {
            const n = Number(v);
            if (!isFinite(n)) msg = 'Enter a number.';
            else if (f.min != null && n < f.min) msg = 'Must be at least ' + f.min + '.';
            else if (f.max != null && n > f.max) msg = 'Must be at most ' + f.max + '.';
          }
          setError(c, msg);
          if (msg && !firstBad) firstBad = c;
          if (!msg && !empty) answers[f.id] = (f.type === 'number') ? Number(v) : v;
        });
        if (firstBad) {
          try { firstBad.wrap.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
          try { if (firstBad.focusEl) firstBad.focusEl.focus({ preventScroll: true }); } catch (e) {}
          return { ok: false, answers: answers };
        }
        return { ok: true, answers: answers };
      }
    };
  }

  /* =========================================================
     QR HELPERS
     ========================================================= */
  function qrLibReady() { return typeof window.QRCode === 'function'; }

  /** Draw a QR into `target` (cleared first). Returns true on success. */
  function drawQr(target, text, size) {
    target.innerHTML = '';
    if (!qrLibReady()) {
      target.appendChild(el('p', {
        className: 'muted',
        textContent: 'The QR library could not load (check the network / content filter). The link above still works.'
      }));
      return false;
    }
    try {
      new window.QRCode(target, {
        text: text,
        width: size,
        height: size,
        colorDark: (cfg.QR && cfg.QR.DARK_COLOR) || '#0f2a44',
        colorLight: (cfg.QR && cfg.QR.LIGHT_COLOR) || '#ffffff',
        correctLevel: window.QRCode.CorrectLevel.M
      });
      return true;
    } catch (e) {
      target.appendChild(el('p', { className: 'muted', textContent: 'Could not draw the QR code.' }));
      return false;
    }
  }

  /** PNG data URL with a white quiet-zone margin, rendered at print size. */
  function qrPngDataUrl(text, size) {
    if (!qrLibReady()) return '';
    const tmp = document.createElement('div');
    if (!drawQr(tmp, text, size)) return '';
    const c = tmp.querySelector('canvas');
    if (!c) return '';
    const m = Math.round(size * 0.08);
    const out = document.createElement('canvas');
    out.width = c.width + m * 2;
    out.height = c.height + m * 2;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(c, m, m);
    return out.toDataURL('image/png');
  }

  function slug(s) {
    return String(s || 'form').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'form';
  }

  function downloadDataUrl(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function downloadText(text, filename, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    downloadDataUrl(url, filename);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function printPoster(form, url) {
    const png = qrPngDataUrl(url, 600);
    if (!png) { ui().toast('QR code is not available to print.', 'error'); return; }
    const w = window.open('', '_blank');
    if (!w) { ui().toast('Pop-up blocked. Allow pop-ups to print, or use Download PNG.', 'error', 5000); return; }
    w.document.open();
    w.document.write(
      '<!doctype html><html><head><meta charset="utf-8"><title>' + escHtml(form.title) + '</title><style>' +
      'body{font-family:Segoe UI,system-ui,Arial,sans-serif;text-align:center;margin:0;padding:48px 32px;color:#0f2a44}' +
      'h1{font-size:34px;margin:0 0 8px}p{font-size:18px;color:#475569;margin:0 0 24px}' +
      'img{width:min(70vw,520px);height:auto}.scan{font-size:22px;font-weight:600;margin-top:12px}' +
      '.url{font-size:12px;color:#64748b;word-break:break-all;margin-top:24px}' +
      '@media print{body{padding:24px}}</style></head><body>' +
      '<h1>' + escHtml(form.title) + '</h1>' +
      (form.description ? '<p>' + escHtml(form.description) + '</p>' : '<p>&nbsp;</p>') +
      '<img alt="QR code" src="' + png + '">' +
      '<div class="scan">Scan to open the form</div>' +
      '<div class="url">' + escHtml(url) + '</div>' +
      '</body></html>'
    );
    w.document.close();
    w.focus();
    setTimeout(function () { try { w.print(); } catch (e) {} }, 400);
  }

  /* =========================================================
     PUBLIC FORM PAGE  (?form=<token>)
     ========================================================= */
  function mountPublic(formToken) {
    const root = document.getElementById('form-screen');
    if (!root) return;
    ['app-loading', 'login-screen', 'app'].forEach(function (id) {
      const n = document.getElementById(id);
      if (n) n.classList.add('hidden');
    });
    root.className = 'form-public-screen';
    runForm(root, formToken, {});
  }

  /** Student route: the same form UI, rendered inside the app shell. */
  function renderStudentForm(container, ctx) {
    container.innerHTML = '';
    const token = String((ctx.params && ctx.params.token) || '');
    if (!/^frm_[a-f0-9]{32}$/i.test(token)) {
      const e = el('div', { className: 'empty-state' });
      e.appendChild(el('h3', { textContent: 'Form not found' }));
      e.appendChild(el('p', { textContent: 'That form link is not valid.' }));
      e.appendChild(el('button', { type: 'button', className: 'btn btn-primary', textContent: 'Open scanner', onClick: function () { ctx.navigate('student.scan'); } }));
      container.appendChild(e);
      return;
    }
    const holder = el('div');
    container.appendChild(holder);
    runForm(holder, token, {
      embedded: true,
      onHunts: function () { ctx.navigate('student.hunts'); },
      onLeaderboard: function () { ctx.navigate('student.leaderboard'); }
    });
  }

  function runForm(root, formToken, opts) {
    opts = opts || {};
    const doneKey = 'th_form_done_' + formToken;
    let submissionId = api().generateSubmissionId();

    function deviceDone() { try { return localStorage.getItem(doneKey) === '1'; } catch (e) { return false; } }
    function markDeviceDone() { try { localStorage.setItem(doneKey, '1'); } catch (e) {} }

    function card(title, description) {
      root.innerHTML = '';
      const page = el('div', { className: 'form-public' });
      const c = el('div', { className: 'card form-card' });
      const head = el('div', { className: 'form-card-head' });
      head.appendChild(el('h1', { textContent: title || 'Form' }));
      if (description) head.appendChild(el('p', { textContent: description }));
      c.appendChild(head);
      const body = el('div', { className: 'form-card-body' });
      c.appendChild(body);
      page.appendChild(c);
      root.appendChild(page);
      if (opts.embedded) { try { ui().setTitle(title || 'Form'); } catch (e) {} }
      else { try { document.title = (title || 'Form') + ' \u2014 ' + cfg.APP_NAME; } catch (e) {} }
      return body;
    }

    function messageCard(title, text, extra) {
      const body = card(title);
      body.appendChild(el('p', { textContent: text }));
      if (extra) body.appendChild(extra);
    }

    function showLoading() {
      root.innerHTML = '';
      const box = el('div', { className: 'empty-state', style: { paddingTop: '80px' } });
      box.appendChild(el('div', { className: 'spinner', style: { margin: '0 auto 12px' } }));
      box.appendChild(el('p', { textContent: 'Loading form\u2026' }));
      root.appendChild(box);
    }

    function showError(msg) {
      const retry = el('button', { type: 'button', className: 'btn btn-primary', textContent: 'Try again', onClick: load });
      messageCard('Could not open this form', msg, retry);
    }

    function showLogin(data, errorText) {
      const body = card(data.title, data.description);
      body.appendChild(el('p', { className: 'muted', textContent: 'Sign in with your school account to fill in this form.' }));
      const email = el('input', { type: 'email', autocomplete: 'username', required: 'required' });
      const pw = el('input', { type: 'password', autocomplete: 'current-password', required: 'required' });
      const err = el('div', { className: 'error-text' + (errorText ? '' : ' hidden'), textContent: errorText || '' });
      const btn = el('button', { type: 'submit', className: 'btn btn-primary btn-block', textContent: 'Sign in' });
      const form = el('form', { className: 'form' });
      form.appendChild(el('label', null, [el('span', { textContent: 'School email' }), email]));
      form.appendChild(el('label', null, [el('span', { textContent: 'Password' }), pw]));
      form.appendChild(btn);
      form.appendChild(err);
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        btn.disabled = true;
        btn.textContent = 'Signing in\u2026';
        try {
          await api().login(email.value.trim(), pw.value);
          load();
        } catch (ex) {
          btn.disabled = false;
          btn.textContent = 'Sign in';
          err.textContent = safeMsg(ex);
          err.classList.remove('hidden');
        }
      });
      body.appendChild(form);
    }

    function showDone(data, out) {
      out = out || {};
      const body = card(data.title);
      body.appendChild(el('div', { className: 'form-done-icon', textContent: '\u2713' }));
      body.appendChild(el('h2', { textContent: 'Response submitted', style: { textAlign: 'center' } }));
      body.appendChild(el('p', { textContent: out.message || 'Thank you! Your response has been recorded.', style: { textAlign: 'center' } }));
      if (out.pointsAwarded > 0) {
        body.appendChild(el('div', { className: 'form-points-earned', textContent: '\u2605 You earned ' + out.pointsAwarded + ' point' + (out.pointsAwarded === 1 ? '' : 's') + '!' }));
      }
      if (out.totalPoints != null && out.totalPoints !== '') {
        body.appendChild(el('p', { className: 'muted', style: { textAlign: 'center' }, textContent: 'Your total points: ' + out.totalPoints }));
      }
      if (opts.embedded) {
        const acts = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '12px' } });
        acts.appendChild(el('button', { type: 'button', className: 'btn btn-primary', textContent: 'Back to my hunts', onClick: opts.onHunts }));
        acts.appendChild(el('button', { type: 'button', className: 'btn btn-outline', textContent: 'View leaderboard', onClick: opts.onLeaderboard }));
        body.appendChild(acts);
      } else if (data.respondent) {
        body.appendChild(el('a', {
          className: 'btn btn-outline btn-block', textContent: 'Open the Treasure Hunt app',
          href: window.location.origin + window.location.pathname,
          style: { marginTop: '12px', textDecoration: 'none', display: 'flex', justifyContent: 'center' }
        }));
      }
      if (data.allowMultiple) {
        body.appendChild(el('button', {
          type: 'button', className: 'btn btn-outline btn-block', textContent: 'Submit another response',
          onClick: function () { submissionId = api().generateSubmissionId(); showForm(data); }
        }));
      }
    }

    function showForm(data) {
      const body = card(data.title, data.description);
      if (data.respondent) {
        body.appendChild(el('p', { className: 'muted', textContent: 'Signed in as ' + data.respondent }));
      }
      if (data.earnsPoints) {
        body.appendChild(el('div', { className: 'form-points-banner', textContent: '\u2605 Complete this form to earn ' + data.points + ' point' + (data.points === 1 ? '' : 's') }));
      }
      const fieldsBox = el('div');
      body.appendChild(fieldsBox);
      const r = renderFormFields(fieldsBox, data.fields || []);

      const err = el('div', { className: 'error-text hidden' });
      const btn = el('button', { type: 'button', className: 'btn btn-primary btn-block', textContent: 'Submit' });
      btn.addEventListener('click', async function () {
        const res = r.collect();
        if (!res.ok) return;
        err.classList.add('hidden');
        btn.disabled = true;
        btn.textContent = 'Submitting\u2026';
        try {
          const out = await api().forms.publicSubmit(formToken, res.answers, submissionId);
          if (!data.allowMultiple && !data.requireLogin) markDeviceDone();
          submissionId = api().generateSubmissionId();
          showDone(data, out);
        } catch (ex) {
          btn.disabled = false;
          btn.textContent = 'Submit';
          const m = safeMsg(ex);
          if (/sign in/i.test(m)) { load(); return; }
          err.textContent = m;
          err.classList.remove('hidden');
        }
      });
      body.appendChild(el('div', { style: { marginTop: '18px' } }, [btn, err]));
    }

    async function load() {
      showLoading();
      try {
        const data = await api().forms.publicGet(formToken);
        if (data.state === 'closed') {
          messageCard(data.title, 'This form is closed and is no longer accepting responses.');
        } else if (data.state === 'already') {
          messageCard(data.title, 'You have already submitted this form. Thank you!');
        } else if (data.state === 'login') {
          showLogin(data);
        } else if (data.state === 'open') {
          if (!opts.embedded && !data.allowMultiple && !data.requireLogin && deviceDone()) {
            messageCard(data.title, 'A response has already been submitted from this device. Thank you!');
          } else {
            showForm(data);
          }
        } else {
          showError('Unexpected response from the server.');
        }
      } catch (err) {
        showError(safeMsg(err));
      }
    }

    load();
  }

  /* =========================================================
     ADMIN: FORMS BUILDER
     ========================================================= */
  async function renderAdminForms(container, ctx) {
    const S = {
      mounted: true,
      mode: 'list',            // list | edit | responses
      forms: [],
      loading: true,
      error: '',
      draft: null,
      saving: false,
      resp: null,              // { form, responses }
      respLoading: false,
      respError: ''
    };
    ctx.onCleanup(function () { S.mounted = false; });

    /* ---------- generic bits ---------- */
    function box(msg) {
      const b = el('div', { className: 'empty-state' });
      b.appendChild(el('div', { className: 'spinner', style: { margin: '0 auto 12px' } }));
      b.appendChild(el('p', { textContent: msg || 'Loading\u2026' }));
      return b;
    }
    function errBox(title, msg, retry) {
      const c = el('div', { className: 'card' });
      const bd = el('div', { className: 'card-body', style: { textAlign: 'center', padding: '36px 24px' } });
      bd.appendChild(el('h3', { textContent: title }));
      bd.appendChild(el('p', { className: 'muted', textContent: msg }));
      if (retry) bd.appendChild(el('button', { type: 'button', className: 'btn btn-primary', textContent: 'Retry', onClick: retry }));
      c.appendChild(bd);
      return c;
    }
    function header(title, subtitle, actions) {
      const row = el('div', {
        style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }
      });
      const left = el('div');
      left.appendChild(el('h2', { textContent: title, style: { marginBottom: '4px' } }));
      if (subtitle) left.appendChild(el('p', { className: 'muted', style: { margin: '0' }, textContent: subtitle }));
      row.appendChild(left);
      const right = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } });
      (actions || []).forEach(function (a) { right.appendChild(a); });
      row.appendChild(right);
      return row;
    }
    function btn(label, cls, fn, extra) {
      return el('button', Object.assign({ type: 'button', className: 'btn ' + cls, textContent: label, onClick: fn }, extra || {}));
    }
    function badge(text, cls) { return el('span', { className: 'badge ' + cls, textContent: text }); }

    function paint() {
      if (!S.mounted) return;
      const y = window.scrollY;
      container.innerHTML = '';
      if (S.mode === 'edit') paintEditor();
      else if (S.mode === 'responses') paintResponses();
      else paintList();
      try { window.scrollTo(0, y); } catch (e) {}
    }

    /* =====================================================
       LIST
       ===================================================== */
    async function loadForms() {
      S.loading = true; S.error = '';
      paint();
      try {
        const list = await api().forms.getForms();
        if (!S.mounted) return;
        S.forms = Array.isArray(list) ? list : [];
        S.loading = false;
      } catch (err) {
        if (!S.mounted) return;
        if (api().isAuthError && api().isAuthError(err)) return;
        S.loading = false;
        S.error = safeMsg(err);
      }
      paint();
    }

    function paintList() {
      container.appendChild(header(
        'Forms Builder',
        'Build forms, share them with a link or QR code, and collect responses.',
        [
          btn('+ New form', 'btn-primary', function () { openEditor(null); }),
          btn('Refresh', 'btn-outline btn-sm', loadForms)
        ]
      ));
      if (S.loading) { container.appendChild(box('Loading forms\u2026')); return; }
      if (S.error) { container.appendChild(errBox('Could not load forms', S.error, loadForms)); return; }
      if (!S.forms.length) {
        const e = el('div', { className: 'empty-state' });
        e.appendChild(el('h3', { textContent: 'No forms yet' }));
        e.appendChild(el('p', { textContent: 'Create a form, then print its QR code so anyone can scan and fill it in.' }));
        e.appendChild(btn('Create your first form', 'btn-primary', function () { openEditor(null); }, { style: { marginTop: '12px' } }));
        container.appendChild(e);
        return;
      }

      S.forms.forEach(function (f) {
        const c = el('div', { className: 'card', style: { marginBottom: '12px' } });
        const bd = el('div', { className: 'card-body' });

        const top = el('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-start' } });
        const info = el('div', { style: { minWidth: '0', flex: '1 1 260px' } });
        info.appendChild(el('h3', { textContent: f.title, style: { margin: '0 0 6px' } }));
        const badges = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '6px' } });
        badges.appendChild(badge(f.status === 'open' ? 'Open' : 'Closed', f.status === 'open' ? 'badge-green' : 'badge-grey'));
        const loginReq = f.requireLogin || f.points > 0 || (f.hunts && f.hunts.length);
        badges.appendChild(badge(loginReq ? 'Sign-in required' : 'Anyone with link', loginReq ? 'badge-navy' : 'badge-gold'));
        if (f.points > 0) badges.appendChild(badge(f.points + ' pts', 'badge-gold'));
        if (f.hunts && f.hunts.length) badges.appendChild(badge('In ' + f.hunts.length + ' hunt' + (f.hunts.length === 1 ? '' : 's'), 'badge-green'));
        info.appendChild(badges);
        info.appendChild(el('div', {
          className: 'muted', style: { fontSize: '.85rem' },
          textContent: f.fieldCount + ' question' + (f.fieldCount === 1 ? '' : 's') + ' \u00b7 ' +
            f.responseCount + ' response' + (f.responseCount === 1 ? '' : 's') +
            (f.updatedAt ? ' \u00b7 updated ' + ui().relativeTime(f.updatedAt) : '')
        }));
        top.appendChild(info);

        const actions = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } });
        actions.appendChild(btn('QR & link', 'btn-primary btn-sm', function () { openShare(f); }));
        actions.appendChild(btn('Responses', 'btn-outline btn-sm', function () { openResponses(f); }));
        actions.appendChild(btn('Edit', 'btn-outline btn-sm', function () { openEditor(f); }));
        actions.appendChild(btn('Duplicate', 'btn-outline btn-sm', function () { duplicateForm(f); }));
        actions.appendChild(btn('Delete', 'btn-danger btn-sm', function () { deleteForm(f); }));
        top.appendChild(actions);

        bd.appendChild(top);
        c.appendChild(bd);
        container.appendChild(c);
      });
    }

    async function duplicateForm(f) {
      try {
        const copy = Object.assign({}, f, { formId: '', title: (f.title + ' (copy)').slice(0, 150), status: 'closed' });
        await api().forms.saveForm(copy);
        ui().toast('Form duplicated (saved as closed).');
        loadForms();
      } catch (err) { ui().toast(safeMsg(err), 'error', 5000); }
    }

    async function deleteForm(f) {
      const ok = await ui().confirm(
        'Delete "' + f.title + '"? Its link and QR code will stop working. Existing responses stay in the spreadsheet.',
        { title: 'Delete form', confirmLabel: 'Delete', danger: true }
      );
      if (!ok) return;
      try {
        await api().forms.deleteForm(f.formId);
        ui().toast('Form deleted.');
        loadForms();
      } catch (err) { ui().toast(safeMsg(err), 'error', 5000); }
    }

    /* =====================================================
       SHARE (link + QR)
       ===================================================== */
    function openShare(form) {
      const wrap = el('div', { style: { textAlign: 'center' } });
      const qrBox = el('div', { className: 'qr-box' });
      const urlInput = el('input', { type: 'text', readonly: 'readonly' });
      const notice = el('p', { className: 'muted', style: { fontSize: '.85rem', marginTop: '10px' } });

      function url() { return cfg.buildFormUrl(form.token); }

      function build() {
        drawQr(qrBox, url(), 240);
        urlInput.value = url();
        notice.textContent = (form.requireLogin || form.points > 0 || (form.hunts && form.hunts.length))
          ? 'Anyone who scans must sign in with a school account before they can answer.'
          : 'Anyone who scans this code can submit a response \u2014 no sign-in needed.';
        if (form.status !== 'open') {
          notice.textContent += ' This form is currently CLOSED, so the page will say it is not accepting responses.';
        }
      }
      build();

      wrap.appendChild(el('h3', { textContent: form.title, style: { margin: '0 0 12px' } }));
      wrap.appendChild(qrBox);

      const urlRow = el('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } });
      urlRow.appendChild(urlInput);
      urlRow.appendChild(btn('Copy', 'btn-outline', async function () {
        const ok = await copyText(url());
        ui().toast(ok ? 'Link copied.' : 'Could not copy \u2014 select the link and copy it manually.', ok ? 'success' : 'error');
      }, { style: { flex: '0 0 auto' } }));
      wrap.appendChild(urlRow);

      const acts = el('div', { style: { display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap', marginTop: '12px' } });
      acts.appendChild(btn('Download PNG', 'btn-primary btn-sm', function () {
        const png = qrPngDataUrl(url(), 800);
        if (!png) { ui().toast('QR code is not available.', 'error'); return; }
        downloadDataUrl(png, slug(form.title) + '-qr.png');
      }));
      acts.appendChild(btn('Print poster', 'btn-outline btn-sm', function () { printPoster(form, url()); }));
      acts.appendChild(btn('Open form', 'btn-outline btn-sm', function () { window.open(url(), '_blank', 'noopener'); }));
      wrap.appendChild(acts);
      wrap.appendChild(notice);

      wrap.appendChild(btn('Replace link (invalidate old QR codes)', 'btn-ghost btn-sm', async function () {
        const ok = await ui().confirm(
          'Create a new link? Every QR code already printed or shared for this form will stop working.',
          { title: 'Replace link', confirmLabel: 'Replace link', danger: true }
        );
        if (!ok) { openShare(form); return; }
        try {
          const r = await api().forms.regenerateToken(form.formId);
          form.token = r.token;
          const inList = S.forms.find(function (x) { return x.formId === form.formId; });
          if (inList) inList.token = r.token;
          if (S.draft && S.draft.formId === form.formId) S.draft.token = r.token;
          ui().toast('New link created.');
        } catch (err) { ui().toast(safeMsg(err), 'error', 5000); }
        openShare(form);
      }, { style: { marginTop: '14px' } }));

      ui().showModal({
        title: 'Share form',
        body: wrap,
        footer: [{ label: 'Done', variant: 'primary', onClick: ui().closeModal }]
      });
    }

    /* =====================================================
       EDITOR
       ===================================================== */
    function openEditor(form) {
      if (form) {
        S.draft = JSON.parse(JSON.stringify(form));
        S.draft.fields = (S.draft.fields || []).map(function (f) {
          if (hasOptions(f.type) && !Array.isArray(f.options)) f.options = [];
          return f;
        });
      } else {
        S.draft = {
          formId: '', token: '', title: '', description: '',
          status: 'open', requireLogin: false, allowMultiple: true, confirmMessage: '', points: 0,
          fields: [Object.assign(newField('text'), { label: 'Your name', required: true })]
        };
      }
      S.mode = 'edit';
      paint();
      try { window.scrollTo(0, 0); } catch (e) {}
    }

    /** Clean copy of the draft ready to send / preview. */
    function cleanDraft() {
      const d = S.draft;
      return {
        formId: d.formId || '',
        title: String(d.title || '').trim(),
        description: String(d.description || '').trim(),
        status: d.status,
        requireLogin: !!d.requireLogin,
        allowMultiple: !!d.allowMultiple,
        confirmMessage: String(d.confirmMessage || '').trim(),
        points: Math.max(0, Math.round(Number(d.points) || 0)),
        fields: d.fields.map(function (f) {
          const o = { id: f.id, type: f.type, label: String(f.label || '').trim(), help: String(f.help || '').trim(), required: !!f.required };
          if (hasOptions(f.type)) {
            const seen = {};
            o.options = (f.options || []).map(function (x) { return String(x).trim(); })
              .filter(function (x) { if (!x || seen[x]) return false; seen[x] = true; return true; });
          }
          if (f.type === 'rating') o.scale = Number(f.scale) || 5;
          if (f.type === 'number') {
            if (f.min !== '' && f.min != null && isFinite(Number(f.min))) o.min = Number(f.min);
            if (f.max !== '' && f.max != null && isFinite(Number(f.max))) o.max = Number(f.max);
          }
          return o;
        })
      };
    }

    function validateDraft(c) {
      if (!c.title) return 'Give the form a title.';
      for (let i = 0; i < c.fields.length; i++) {
        const f = c.fields[i];
        if (!f.label) return 'Question ' + (i + 1) + ' needs a label.';
        if (hasOptions(f.type) && !f.options.length) return 'Question ' + (i + 1) + ' (' + f.label + ') needs at least one option.';
      }
      if (!c.fields.some(function (f) { return f.type !== 'heading'; })) return 'Add at least one question.';
      return '';
    }

    function moveField(i, dir) {
      const a = S.draft.fields;
      const j = i + dir;
      if (j < 0 || j >= a.length) return;
      const t = a[i]; a[i] = a[j]; a[j] = t;
      paint();
    }

    function paintEditor() {
      const d = S.draft;

      container.appendChild(header(
        d.formId ? 'Edit form' : 'New form',
        'Questions are saved with the form. Existing responses stay linked to their questions.',
        [
          btn('\u2190 Back', 'btn-outline btn-sm', backToList),
          btn('Preview', 'btn-outline', previewDraft),
          d.formId ? btn('QR & link', 'btn-outline', function () { openShare(d); }) : null,
          btn(S.saving ? 'Saving\u2026' : 'Save', 'btn-primary', saveDraft, S.saving ? { disabled: 'disabled' } : {})
        ].filter(Boolean)
      ));

      /* --- details card --- */
      const det = el('div', { className: 'card', style: { marginBottom: '16px' } });
      det.appendChild(el('div', { className: 'card-header' }, [el('h3', { textContent: 'Form details' })]));
      const db = el('div', { className: 'card-body' });
      const form = el('div', { className: 'form' });

      const title = el('input', { type: 'text', maxlength: '150', placeholder: 'e.g. Sports Day feedback' });
      title.value = d.title;
      title.addEventListener('input', function () { d.title = title.value; });
      form.appendChild(el('label', null, [el('span', { textContent: 'Title' }), title]));

      const desc = el('textarea', { rows: '2', maxlength: '1000', placeholder: 'Optional \u2014 shown at the top of the form' });
      desc.value = d.description;
      desc.addEventListener('input', function () { d.description = desc.value; });
      form.appendChild(el('label', null, [el('span', { textContent: 'Description' }), desc]));

      const conf = el('input', { type: 'text', maxlength: '500', placeholder: 'Thank you! Your response has been recorded.' });
      conf.value = d.confirmMessage;
      conf.addEventListener('input', function () { d.confirmMessage = conf.value; });
      form.appendChild(el('label', null, [el('span', { textContent: 'Message shown after submitting' }), conf]));

      const pts = el('input', { type: 'number', min: '0', step: '1', placeholder: '0' });
      pts.value = d.points ? String(d.points) : '';
      pts.addEventListener('input', function () { d.points = pts.value; });
      form.appendChild(el('label', null, [el('span', { textContent: 'Points awarded for completing' }), pts]));
      form.appendChild(el('div', { className: 'muted', style: { fontSize: '.8rem', marginTop: '-6px' },
        textContent: 'Points go to students (once per form) and appear on the leaderboard when the form is added to a hunt. Forms with points, or inside a hunt, always require sign-in so answers are tied to the student.' }));
      if (d.hunts && d.hunts.length) {
        form.appendChild(el('div', { className: 'muted', style: { fontSize: '.85rem' },
          textContent: 'Used in hunts: ' + d.hunts.map(function (h) { return h.name; }).join(', ') }));
      }

      const status = el('select');
      [['open', 'Open \u2014 accepting responses'], ['closed', 'Closed \u2014 not accepting responses']].forEach(function (p) {
        const o = el('option', { textContent: p[1] }); o.value = p[0]; status.appendChild(o);
      });
      status.value = d.status;
      status.addEventListener('change', function () { d.status = status.value; });
      form.appendChild(el('label', null, [el('span', { textContent: 'Status' }), status]));

      function check(label, key, hint) {
        const cb = el('input', { type: 'checkbox' });
        cb.checked = !!d[key];
        cb.addEventListener('change', function () { d[key] = cb.checked; });
        const wrap = el('div');
        const row = el('label', { className: 'checkbox-row', style: { flexDirection: 'row' } }, [cb, el('span', { textContent: label })]);
        wrap.appendChild(row);
        if (hint) wrap.appendChild(el('div', { className: 'muted', style: { fontSize: '.8rem', marginLeft: '26px' }, textContent: hint }));
        return wrap;
      }
      form.appendChild(check('Require sign-in with a school account', 'requireLogin',
        'Responses record who submitted. Leave off so anyone with the QR code can answer.'));
      form.appendChild(check('Allow more than one response per person', 'allowMultiple',
        'With sign-in this is enforced per account. For public forms it only stops repeat submissions from the same device.'));

      db.appendChild(form);
      det.appendChild(db);
      container.appendChild(det);

      /* --- questions --- */
      const qHead = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' } });
      qHead.appendChild(el('h3', { textContent: 'Questions', style: { margin: '0' } }));
      container.appendChild(qHead);

      d.fields.forEach(function (f, i) { container.appendChild(fieldCard(f, i)); });

      /* --- add question --- */
      const add = el('div', { className: 'card', style: { marginTop: '12px' } });
      const addBody = el('div', { className: 'card-body', style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } });
      const typeSel = el('select', { style: { maxWidth: '280px' } });
      TYPES.forEach(function (t) { const o = el('option', { textContent: t.label }); o.value = t.type; typeSel.appendChild(o); });
      addBody.appendChild(typeSel);
      addBody.appendChild(btn('+ Add question', 'btn-primary', function () {
        S.draft.fields.push(newField(typeSel.value));
        paint();
        setTimeout(function () {
          const cards = container.querySelectorAll('.fb-field');
          const last = cards[cards.length - 1];
          if (last) { try { last.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {} const i = last.querySelector('input[type="text"]'); if (i) i.focus(); }
        }, 30);
      }));
      add.appendChild(addBody);
      container.appendChild(add);

      /* --- bottom save --- */
      container.appendChild(el('div', { className: 'form-actions', style: { marginTop: '16px' } }, [
        btn('Cancel', 'btn-outline', backToList),
        btn(S.saving ? 'Saving\u2026' : 'Save form', 'btn-primary', saveDraft, S.saving ? { disabled: 'disabled' } : {})
      ]));
    }

    function fieldCard(f, i) {
      const d = S.draft;
      const c = el('div', { className: 'card fb-field' });
      const bd = el('div', { className: 'card-body' });

      /* top row: type + label */
      const row = el('div', { className: 'fb-row' });
      const typeSel = el('select');
      TYPES.forEach(function (t) { const o = el('option', { textContent: t.label }); o.value = t.type; typeSel.appendChild(o); });
      typeSel.value = f.type;
      typeSel.addEventListener('change', function () {
        f.type = typeSel.value;
        if (hasOptions(f.type) && !Array.isArray(f.options)) f.options = ['Option 1', 'Option 2'];
        if (f.type === 'rating' && !f.scale) f.scale = 5;
        if (f.type === 'heading') f.required = false;
        paint();
      });
      row.appendChild(el('label', null, [el('span', { textContent: 'Type' }), typeSel]));

      const label = el('input', {
        type: 'text', maxlength: '200',
        placeholder: f.type === 'heading' ? 'Heading text' : 'Question'
      });
      label.value = f.label;
      label.addEventListener('input', function () { f.label = label.value; });
      row.appendChild(el('label', { className: 'fb-grow' }, [el('span', { textContent: f.type === 'heading' ? 'Heading' : 'Question' }), label]));
      bd.appendChild(row);

      /* help text */
      const help = el('input', { type: 'text', maxlength: '300', placeholder: 'Optional hint shown under the question' });
      help.value = f.help || '';
      help.addEventListener('input', function () { f.help = help.value; });
      bd.appendChild(el('label', { style: { display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px', fontSize: '.875rem', fontWeight: '500', color: 'var(--text-soft)' } },
        [el('span', { textContent: f.type === 'heading' ? 'Text below the heading' : 'Hint' }), help]));

      /* options */
      if (hasOptions(f.type)) {
        const ta = el('textarea', { rows: '4', placeholder: 'One option per line' });
        ta.value = (f.options || []).join('\n');
        ta.addEventListener('input', function () { f.options = ta.value.split('\n'); });
        bd.appendChild(el('label', { style: { display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px', fontSize: '.875rem', fontWeight: '500', color: 'var(--text-soft)' } },
          [el('span', { textContent: 'Options (one per line)' }), ta]));
      }

      /* rating scale */
      if (f.type === 'rating') {
        const sel = el('select', { style: { maxWidth: '160px' } });
        [3, 4, 5, 6, 7, 8, 9, 10].forEach(function (n) { const o = el('option', { textContent: '1 to ' + n }); o.value = String(n); sel.appendChild(o); });
        sel.value = String(f.scale || 5);
        sel.addEventListener('change', function () { f.scale = Number(sel.value); });
        bd.appendChild(el('label', { style: { display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px', fontSize: '.875rem', fontWeight: '500', color: 'var(--text-soft)' } },
          [el('span', { textContent: 'Scale' }), sel]));
      }

      /* number bounds */
      if (f.type === 'number') {
        const mn = el('input', { type: 'number', placeholder: 'No minimum' });
        const mx = el('input', { type: 'number', placeholder: 'No maximum' });
        mn.value = f.min != null ? f.min : '';
        mx.value = f.max != null ? f.max : '';
        mn.addEventListener('input', function () { f.min = mn.value; });
        mx.addEventListener('input', function () { f.max = mx.value; });
        const r2 = el('div', { className: 'form-row', style: { marginTop: '10px' } }, [
          el('label', null, [el('span', { textContent: 'Minimum' }), mn]),
          el('label', null, [el('span', { textContent: 'Maximum' }), mx])
        ]);
        bd.appendChild(r2);
      }

      /* footer controls */
      const foot = el('div', { className: 'fb-foot' });
      if (f.type !== 'heading') {
        const req = el('input', { type: 'checkbox' });
        req.checked = !!f.required;
        req.addEventListener('change', function () { f.required = req.checked; });
        foot.appendChild(el('label', { className: 'checkbox-row', style: { flexDirection: 'row' } }, [req, el('span', { textContent: 'Required' })]));
      } else {
        foot.appendChild(el('span'));
      }
      const ctl = el('div', { style: { display: 'flex', gap: '6px' } });
      ctl.appendChild(btn('\u2191', 'btn-outline btn-sm', function () { moveField(i, -1); }, { 'aria-label': 'Move up', disabled: i === 0 ? 'disabled' : null }));
      ctl.appendChild(btn('\u2193', 'btn-outline btn-sm', function () { moveField(i, 1); }, { 'aria-label': 'Move down', disabled: i === d.fields.length - 1 ? 'disabled' : null }));
      ctl.appendChild(btn('Duplicate', 'btn-outline btn-sm', function () {
        const copy = JSON.parse(JSON.stringify(f));
        copy.id = uid();
        d.fields.splice(i + 1, 0, copy);
        paint();
      }));
      ctl.appendChild(btn('Remove', 'btn-danger btn-sm', function () { d.fields.splice(i, 1); paint(); }));
      foot.appendChild(ctl);
      bd.appendChild(foot);

      c.appendChild(bd);
      return c;
    }

    function previewDraft() {
      const c = cleanDraft();
      const body = el('div');
      body.appendChild(el('h2', { textContent: c.title || 'Untitled form', style: { marginTop: '0' } }));
      if (c.description) body.appendChild(el('p', { className: 'muted', textContent: c.description }));
      const fb = el('div');
      body.appendChild(fb);
      renderFormFields(fb, c.fields.filter(function (f) {
        return f.label && (!hasOptions(f.type) || f.options.length);
      }));
      body.appendChild(el('p', { className: 'muted', style: { marginTop: '14px', fontSize: '.85rem' }, textContent: 'Preview only \u2014 nothing is submitted.' }));
      ui().showModal({
        title: 'Preview', wide: true, body: body,
        footer: [{ label: 'Close', variant: 'primary', onClick: ui().closeModal }]
      });
    }

    async function saveDraft() {
      if (S.saving) return;
      const c = cleanDraft();
      const problem = validateDraft(c);
      if (problem) { ui().toast(problem, 'error', 4500); return; }
      S.saving = true;
      paint();
      try {
        const wasNew = !c.formId;
        const saved = await api().forms.saveForm(c);
        if (!S.mounted) return;
        S.saving = false;
        // keep editing the saved version (ids/tokens now known)
        S.draft = JSON.parse(JSON.stringify(saved));
        paint();
        ui().toast('Form saved.');
        if (wasNew) openShare(saved);
      } catch (err) {
        if (!S.mounted) return;
        S.saving = false;
        paint();
        ui().toast(safeMsg(err), 'error', 5000);
      }
    }

    async function backToList() {
      S.mode = 'list';
      S.draft = null;
      await loadForms();
    }

    /* =====================================================
       RESPONSES
       ===================================================== */
    async function openResponses(form) {
      S.mode = 'responses';
      S.resp = null;
      S.respLoading = true;
      S.respError = '';
      S.respForm = form;
      paint();
      await reloadResponses();
    }

    async function reloadResponses() {
      S.respLoading = true; S.respError = '';
      paint();
      try {
        const r = await api().forms.getResponses(S.respForm.formId);
        if (!S.mounted) return;
        S.resp = r;
        S.respLoading = false;
      } catch (err) {
        if (!S.mounted) return;
        if (api().isAuthError && api().isAuthError(err)) return;
        S.respLoading = false;
        S.respError = safeMsg(err);
      }
      paint();
    }

    function answerText(f, v) {
      if (v == null || v === '') return '';
      return Array.isArray(v) ? v.join(', ') : String(v);
    }

    function csvCell(v) {
      if (typeof v === 'number') return String(v);
      let s = Array.isArray(v) ? v.join('; ') : (v == null ? '' : String(v));
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;      // neutralise spreadsheet formulas
      return '"' + s.replace(/"/g, '""') + '"';
    }

    function exportCsv() {
      const r = S.resp;
      const qs = r.form.fields.filter(function (f) { return f.type !== 'heading'; });
      const lines = [];
      lines.push(['Submitted', 'Respondent', 'Class', 'Teacher in charge', 'Points earned', 'Total points'].concat(qs.map(function (f) { return f.label; })).map(csvCell).join(','));
      r.responses.forEach(function (x) {
        const cells = [x.submittedAt, x.userName || '', x.className || '', x.teacherNames || '', x.pointsAwarded, x.totalPoints].concat(qs.map(function (f) { return x.answers[f.id]; }));
        lines.push(cells.map(csvCell).join(','));
      });
      downloadText('\ufeff' + lines.join('\r\n'), slug(r.form.title) + '-responses.csv', 'text/csv;charset=utf-8');
    }

    function summaryCard(f, responses) {
      const counts = {};
      let answered = 0;
      const keys = f.type === 'rating'
        ? Array.apply(null, Array(f.scale || 5)).map(function (_, i) { return String(i + 1); })
        : (f.options || []).slice();
      keys.forEach(function (k) { counts[k] = 0; });
      let sum = 0;
      responses.forEach(function (x) {
        const v = x.answers[f.id];
        if (v == null || v === '') return;
        answered++;
        (Array.isArray(v) ? v : [v]).forEach(function (one) {
          const k = String(one);
          counts[k] = (counts[k] || 0) + 1;
        });
        if (f.type === 'rating') sum += Number(v) || 0;
      });
      const c = el('div', { className: 'card', style: { marginBottom: '10px' } });
      const bd = el('div', { className: 'card-body' });
      bd.appendChild(el('div', { style: { fontWeight: '600', marginBottom: '2px' }, textContent: f.label }));
      bd.appendChild(el('div', {
        className: 'muted', style: { fontSize: '.8rem', marginBottom: '10px' },
        textContent: answered + ' answer' + (answered === 1 ? '' : 's') +
          (f.type === 'rating' && answered ? ' \u00b7 average ' + (sum / answered).toFixed(2) : '')
      }));
      const max = Math.max.apply(null, Object.keys(counts).map(function (k) { return counts[k]; }).concat([1]));
      Object.keys(counts).forEach(function (k) {
        const row = el('div', { className: 'ff-bar-row' });
        row.appendChild(el('div', { className: 'ff-bar-label', textContent: k }));
        const track = el('div', { className: 'ff-bar-track' });
        const fill = el('div', { className: 'ff-bar-fill' });
        fill.style.width = Math.round((counts[k] / max) * 100) + '%';
        track.appendChild(fill);
        row.appendChild(track);
        row.appendChild(el('div', { className: 'ff-bar-count', textContent: String(counts[k]) }));
        bd.appendChild(row);
      });
      c.appendChild(bd);
      return c;
    }

    function paintResponses() {
      const form = S.respForm;
      const r = S.resp;
      container.appendChild(header(
        form.title,
        'Responses',
        [
          btn('\u2190 Back', 'btn-outline btn-sm', backToList),
          btn('Refresh', 'btn-outline btn-sm', reloadResponses),
          r ? btn('Export CSV', 'btn-primary', exportCsv, r.responses.length ? {} : { disabled: 'disabled' }) : null
        ].filter(Boolean)
      ));
      if (S.respLoading) { container.appendChild(box('Loading responses\u2026')); return; }
      if (S.respError) { container.appendChild(errBox('Could not load responses', S.respError, reloadResponses)); return; }
      if (!r) return;

      if (!r.responses.length) {
        const e = el('div', { className: 'empty-state' });
        e.appendChild(el('h3', { textContent: 'No responses yet' }));
        e.appendChild(el('p', { textContent: 'Share the QR code or link and responses will appear here.' }));
        e.appendChild(btn('Get QR & link', 'btn-primary', function () { openShare(r.form); }, { style: { marginTop: '12px' } }));
        container.appendChild(e);
        return;
      }

      container.appendChild(el('p', {
        className: 'muted',
        textContent: r.responses.length + ' response' + (r.responses.length === 1 ? '' : 's')
      }));

      const qs = r.form.fields.filter(function (f) { return f.type !== 'heading'; });
      const summarisable = qs.filter(function (f) { return f.type === 'choice' || f.type === 'multi' || f.type === 'dropdown' || f.type === 'rating'; });
      if (summarisable.length) {
        container.appendChild(el('h3', { textContent: 'Summary', style: { margin: '8px 0' } }));
        summarisable.forEach(function (f) { container.appendChild(summaryCard(f, r.responses)); });
      }

      container.appendChild(el('h3', { textContent: 'All responses', style: { margin: '16px 0 8px' } }));
      const wrap = el('div', { className: 'table-wrap' });
      const table = el('table');
      const thead = el('thead');
      const hr = el('tr');
      ['Submitted', 'Respondent', 'Class', 'Teacher', 'Points'].concat(qs.map(function (f) { return f.label; })).concat(['']).forEach(function (h) {
        hr.appendChild(el('th', { textContent: h }));
      });
      thead.appendChild(hr);
      table.appendChild(thead);

      const LIMIT = 500;
      const tbody = el('tbody');
      r.responses.slice(0, LIMIT).forEach(function (x) {
        const tr = el('tr');
        tr.appendChild(el('td', { textContent: ui().formatDateTime(x.submittedAt), style: { whiteSpace: 'nowrap' } }));
        tr.appendChild(el('td', { textContent: x.userName || '\u2014' }));
        tr.appendChild(el('td', { textContent: x.className || '\u2014' }));
        tr.appendChild(el('td', { textContent: x.teacherNames || '\u2014' }));
        tr.appendChild(el('td', { textContent: x.pointsAwarded === '' || x.pointsAwarded == null ? '\u2014' : (x.pointsAwarded + (x.totalPoints !== '' && x.totalPoints != null ? ' (total ' + x.totalPoints + ')' : '')), style: { whiteSpace: 'nowrap' } }));
        qs.forEach(function (f) {
          tr.appendChild(el('td', { textContent: answerText(f, x.answers[f.id]), style: { minWidth: '120px', maxWidth: '320px', whiteSpace: 'pre-wrap' } }));
        });
        const del = el('td');
        del.appendChild(btn('Delete', 'btn-danger btn-sm', async function () {
          const ok = await ui().confirm('Delete this response permanently?', { title: 'Delete response', confirmLabel: 'Delete', danger: true });
          if (!ok) return;
          try {
            await api().forms.deleteResponse(x.responseId);
            ui().toast('Response deleted.');
            reloadResponses();
          } catch (err) { ui().toast(safeMsg(err), 'error', 5000); }
        }));
        tr.appendChild(del);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
      container.appendChild(wrap);
      if (r.responses.length > LIMIT) {
        container.appendChild(el('p', { className: 'muted', textContent: 'Showing the newest ' + LIMIT + ' of ' + r.responses.length + '. Export CSV to get all of them.' }));
      }
    }

    /* ---------- go ---------- */
    await loadForms();
  }

  /* =========================================================
     EXPORTS
     ========================================================= */
  window.APP.views.renderAdminForms = renderAdminForms;
  window.APP.views.renderStudentForm = renderStudentForm;
  window.APP.forms = { mountPublic: mountPublic, renderFormFields: renderFormFields };
})();
