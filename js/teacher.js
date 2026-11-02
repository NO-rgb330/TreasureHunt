/* =========================================================
   TREASURE HUNT APP — teacher.js (PART 1 OF 2)
   ---------------------------------------------------------
   Views registered in this part:
     teacher.dashboard   → renderTeacherDashboard
     teacher.hunts       → renderTeacherHunts
     teacher.challenges  → renderTeacherChallenges

   Part 2 (second IIFE, appended to this same file) registers:
     teacher.quizManager → renderTeacherQuizManager
     teacher.students    → renderTeacherStudents
     teacher.reports     → renderTeacherReports
                           (includes submissions filter + table)
     teacher.integrations→ renderTeacherIntegrations
     teacher.settings    → renderTeacherSettings

   Shared conventions:
     - APP.api.teacher.*          all teacher API calls
     - APP.ui.showModal/confirm/  modal + confirm + toast + el helpers
       alert/toast/el/formatDate
     - ctx.onCleanup(fn)          view teardown hook (called on
                                  route change and on logout)
     - ctx.params.*               deep-link params from hash router

   Backend contract (see backend/Code.gs):
     teacher.getOverview()          → { stats:{ students, hunts,
                                              challenges,
                                              totalPointsAwarded,
                                              submissions } }
     teacher.getHunts()             → [{ huntId, name, description,
                                         instructions, startDate,
                                         endDate, status, published,
                                         assignedClassIds,
                                         challengeCount, createdBy }]
     teacher.getChallenges(huntId)  → [{ challengeId, huntId, name,
                                         description, qrToken, quizId,
                                         formUrl, maxPoints,
                                         passingPercent, startDate,
                                         endDate, status,
                                         assignedClassIds, orderIndex }]
     teacher.createHunt(payload)    → { huntId }
     teacher.updateHunt(payload)    → { ok }
     teacher.deleteHunt(huntId)     → { ok }   (archives)
     teacher.updateChallenge(p)     → { ok }
     teacher.regenerateToken(id)    → { qrToken }
     teacher.disableChallenge(id)   → { ok }
     teacher.getQuizzes()           → [{ quizId, title, questionCount, … }]
     teacher.getClasses()           → [{ classId, className, teacherIds }]
   ========================================================= */

window.APP = window.APP || {};
window.APP.views = window.APP.views || {};

(function () {
  'use strict';

  const cfg = window.APP.config;

  /* ============================ HELPERS ============================ */

  function api() { return window.APP.api; }
  function ui()  { return window.APP.ui; }

  function el(tag, attrs, children) {
    if (ui() && typeof ui().el === 'function') return ui().el(tag, attrs, children);
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
        } else node.setAttribute(k, String(v));
      });
    }
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
    if (ui() && typeof ui().toast === 'function') ui().toast(msg, type, timeout);
    else { try { console.log('[toast]', type || '', msg); } catch (e) {} }
  }

  function confirmDialog(msg, opts) {
    if (ui() && typeof ui().confirm === 'function') return ui().confirm(msg, opts);
    return Promise.resolve(window.confirm(msg));
  }

  function safeMsg(err) {
    const a = api();
    return a && a.safeMessage ? a.safeMessage(err) : ((err && err.message) || 'Something went wrong.');
  }

  function num(n) { const v = Number(n); return isNaN(v) ? 0 : v; }

  function isoDateOnly(s) {
    if (!s) return '';
    try {
      const d = new Date(s);
      if (isNaN(d.getTime())) return '';
      return d.getUTCFullYear() + '-' +
        String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
        String(d.getUTCDate()).padStart(2, '0');
    } catch (e) { return ''; }
  }

  function fmtDate(iso) {
    if (!iso) return '\u2014';
    if (ui() && typeof ui().formatDate === 'function') return ui().formatDate(iso);
    try {
      const d = new Date(iso);
      return isNaN(d.getTime()) ? String(iso)
        : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (e) { return String(iso); }
  }

  function fmtDateRange(start, end) {
    if (!start && !end) return '\u2014';
    if (!start) return 'Until ' + fmtDate(end);
    if (!end)   return 'From ' + fmtDate(start);
    return fmtDate(start) + ' \u2013 ' + fmtDate(end);
  }

  function fieldRow(labelText, inputNode) {
    const l = el('label');
    l.appendChild(el('span', { textContent: labelText }));
    l.appendChild(inputNode);
    return l;
  }

  /* ============================ SHARED COMPONENTS ============================ */

  function statCard(opts) {
    const card = el('div', { className: 'stat-card' + (opts.accent ? ' accent' : '') });
    card.appendChild(el('div', { className: 'stat-label', textContent: opts.label || '' }));
    card.appendChild(el('div', { className: 'stat-value', textContent: String(opts.value != null ? opts.value : '') }));
    if (opts.sub) card.appendChild(el('div', { className: 'stat-sub', textContent: opts.sub }));
    return card;
  }

  function loadingBox(msg) {
    const box = el('div', { className: 'empty-state' });
    box.appendChild(el('div', { className: 'spinner', style: { margin: '0 auto 12px' } }));
    box.appendChild(el('p', { textContent: msg || 'Loading\u2026' }));
    return box;
  }

  function errorBox(title, message, onRetry) {
    const card = el('div', { className: 'card' });
    const body = el('div', { className: 'card-body', style: { textAlign: 'center', padding: '36px 24px' } });
    body.appendChild(el('h3', { textContent: title || 'Could not load' }));
    body.appendChild(el('p', { className: 'muted', textContent: message || '' }));
    if (typeof onRetry === 'function') {
      body.appendChild(el('button', {
        type: 'button', className: 'btn btn-primary', textContent: 'Retry',
        onClick: onRetry
      }));
    }
    card.appendChild(body);
    return card;
  }

  function emptyBox(title, message, ctaLabel, onCta) {
    const box = el('div', { className: 'empty-state' });
    box.appendChild(el('h3', { textContent: title || 'Nothing here yet' }));
    if (message) box.appendChild(el('p', { textContent: message }));
    if (ctaLabel && typeof onCta === 'function') {
      box.appendChild(el('button', {
        type: 'button', className: 'btn btn-primary',
        textContent: ctaLabel, style: { marginTop: '12px' },
        onClick: onCta
      }));
    }
    return box;
  }

  function statusBadge(status, published) {
    const s = String(status || '').toLowerCase();
    if (s === 'archived') return el('span', { className: 'badge badge-grey', textContent: 'Archived' });
    if (published === false) return el('span', { className: 'badge badge-gold', textContent: 'Draft' });
    return el('span', { className: 'badge badge-green', textContent: 'Active' });
  }

  function classesSummary(classIds, allClasses) {
    const ids = Array.isArray(classIds) ? classIds : [];
    if (!ids.length) return 'All classes';
    const byId = {};
    (allClasses || []).forEach(function (c) { byId[String(c.classId)] = c.className; });
    if (ids.length <= 2) {
      return ids.map(function (id) { return byId[id] || id; }).join(', ');
    }
    return ids.length + ' classes';
  }

  /* ============================ VIEW: teacher.dashboard ============================ */

  async function renderTeacherDashboard(container, ctx) {
    container.innerHTML = '';
    container.appendChild(loadingBox('Loading dashboard\u2026'));

    let data;
    try {
      data = await api().teacher.getOverview();
    } catch (err) {
      if (api().isAuthError && api().isAuthError(err)) return;
      container.innerHTML = '';
      container.appendChild(errorBox(
        'Could not load dashboard',
        safeMsg(err),
        function () { renderTeacherDashboard(container, ctx); }
      ));
      return;
    }

    const stats = (data && data.stats) || {};
    container.innerHTML = '';

    container.appendChild(el('h2', {
      textContent: 'Teacher Dashboard',
      style: { marginBottom: '4px' }
    }));
    const userName = (ctx.user && ctx.user.displayName) || 'Teacher';
    container.appendChild(el('p', {
      className: 'muted',
      textContent: 'Welcome back, ' + userName + '.',
      style: { marginBottom: '20px' }
    }));

    /* ---- Stat cards ---- */
    const grid = el('div', { className: 'stat-grid' });
    grid.appendChild(statCard({ label: 'Students', value: num(stats.students) }));
    grid.appendChild(statCard({ label: 'Treasure Hunts', value: num(stats.hunts) }));
    grid.appendChild(statCard({ label: 'Challenges', value: num(stats.challenges) }));
    grid.appendChild(statCard({
      label: 'Total Points Awarded',
      value: num(stats.totalPointsAwarded).toLocaleString(),
      accent: true,
      sub: num(stats.submissions) + ' quiz submission' + (num(stats.submissions) === 1 ? '' : 's')
    }));
    container.appendChild(grid);

    /* ---- Quick actions ---- */
    const qaSection = el('div', { style: { marginTop: '20px' } });
    qaSection.appendChild(el('div', { className: 'section-title', textContent: 'Quick actions' }));

    const qaGrid = el('div', { className: 'grid grid-3' });

    qaGrid.appendChild(quickAction(
      'Create a treasure hunt',
      'Start a new hunt and assign it to classes.',
      'New hunt',
      function () { ctx.navigate('teacher.hunts', { new: '1' }); }
    ));
    qaGrid.appendChild(quickAction(
      'Add a challenge & QR',
      'Create a challenge, generate its printable QR code.',
      'Open QR generator',
      function () { ctx.navigate('teacher.qrGenerator'); }
    ));
    qaGrid.appendChild(quickAction(
      'Manage quizzes',
      'Build built-in quizzes with multiple-choice questions.',
      'Open quiz manager',
      function () { ctx.navigate('teacher.quizManager'); }
    ));

    qaSection.appendChild(qaGrid);
    container.appendChild(qaSection);

    /* ---- Tip card ---- */
    const tip = el('div', {
      className: 'card',
      style: { marginTop: '20px', background: '#eef1f5', borderStyle: 'dashed' }
    });
    const tipBody = el('div', { className: 'card-body', style: { fontSize: '.9rem', color: '#475569' } });
    tipBody.appendChild(el('strong', { textContent: 'Tip: ' }));
    tipBody.appendChild(document.createTextNode(
      'Open Reports to see per-class and per-hunt performance, including completion rates, submission status, and CSV export.'
    ));
    tip.appendChild(tipBody);
    container.appendChild(tip);
  }

  function quickAction(title, desc, btnLabel, onClick) {
    const card = el('div', { className: 'card' });
    const body = el('div', { className: 'card-body' });
    body.appendChild(el('h3', { textContent: title, style: { marginBottom: '4px', fontSize: '1rem' } }));
    body.appendChild(el('p', {
      className: 'muted',
      style: { fontSize: '.88rem', marginBottom: '12px' },
      textContent: desc
    }));
    body.appendChild(el('button', {
      type: 'button',
      className: 'btn btn-outline btn-sm',
      textContent: btnLabel,
      onClick: onClick
    }));
    card.appendChild(body);
    return card;
  }

  /* ============================ VIEW: teacher.hunts ============================ */

  async function renderTeacherHunts(container, ctx) {
    /* ---------- Local state ---------- */
    const state = {
      hunts: [],
      classes: [],
      isLoading: true,
      loadError: '',
      mounted: true,
      autoOpenNew: !!(ctx.params && ctx.params.new === '1'),
      autoEditId: (ctx.params && ctx.params.edit) || ''
    };

    async function loadAll() {
      state.isLoading = true;
      state.loadError = '';
      paint();
      try {
        const results = await Promise.all([
          api().teacher.getHunts(),
          api().teacher.getClasses()
        ]);
        if (!state.mounted) return;
        state.hunts   = Array.isArray(results[0]) ? results[0] : [];
        state.classes = Array.isArray(results[1]) ? results[1] : [];
        state.isLoading = false;
        paint();
        maybeAutoOpen();
      } catch (err) {
        if (!state.mounted) return;
        if (api().isAuthError && api().isAuthError(err)) return;
        state.isLoading = false;
        state.loadError = safeMsg(err);
        paint();
      }
    }

    function maybeAutoOpen() {
      if (state.autoOpenNew) {
        state.autoOpenNew = false;
        openCreateModal();
        try { history.replaceState(null, '', '#teacher.hunts'); } catch (e) {}
        return;
      }
      if (state.autoEditId) {
        const hunt = state.hunts.find(function (h) { return h.huntId === state.autoEditId; });
        state.autoEditId = '';
        try { history.replaceState(null, '', '#teacher.hunts'); } catch (e) {}
        if (hunt) openEditModal(hunt);
      }
    }

    function paint() {
      container.innerHTML = '';

      container.appendChild(el('div', {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '12px',
          flexWrap: 'wrap',
          marginBottom: '16px'
        }
      }, [
        (function () {
          const wrap = el('div');
          wrap.appendChild(el('h2', { textContent: 'Treasure Hunts', style: { marginBottom: '4px' } }));
          wrap.appendChild(el('p', {
            className: 'muted',
            style: { margin: '0' },
            textContent: 'Create and manage hunt events, their dates and class assignments.'
          }));
          return wrap;
        })(),
        el('button', {
          type: 'button',
          className: 'btn btn-primary',
          textContent: 'New hunt',
          onClick: openCreateModal
        })
      ]));

      if (state.isLoading) { container.appendChild(loadingBox('Loading hunts\u2026')); return; }

      if (state.loadError) {
        container.appendChild(errorBox('Could not load hunts', state.loadError, loadAll));
        return;
      }

      if (!state.hunts.length) {
        container.appendChild(emptyBox(
          'No treasure hunts yet',
          'Create your first hunt to begin building challenges.',
          'Create first hunt',
          openCreateModal
        ));
        return;
      }

      const wrap = el('div', { className: 'table-wrap' });
      const table = el('table');
      const thead = el('thead');
      const hr = el('tr');
      hr.appendChild(el('th', { textContent: 'Hunt' }));
      hr.appendChild(el('th', { textContent: 'Dates' }));
      hr.appendChild(el('th', { textContent: 'Challenges', className: 'numeric' }));
      hr.appendChild(el('th', { textContent: 'Classes' }));
      hr.appendChild(el('th', { textContent: 'Status' }));
      hr.appendChild(el('th', { textContent: 'Actions', style: { textAlign: 'right' } }));
      thead.appendChild(hr);
      table.appendChild(thead);

      const tbody = el('tbody');
      state.hunts.forEach(function (h) {
        const tr = el('tr');

        const nameTd = el('td');
        nameTd.appendChild(el('div', {
          style: { fontWeight: '600', color: '#0f2a44' },
          textContent: h.name || 'Untitled hunt'
        }));
        if (h.description) {
          nameTd.appendChild(el('div', {
            className: 'muted',
            style: { fontSize: '.8rem', marginTop: '2px', maxWidth: '340px' },
            textContent: h.description
          }));
        }
        tr.appendChild(nameTd);

        tr.appendChild(el('td', { className: 'muted', textContent: fmtDateRange(h.startDate, h.endDate) }));
        tr.appendChild(el('td', { className: 'numeric', textContent: String(num(h.challengeCount)) }));
        tr.appendChild(el('td', {
          className: 'muted',
          style: { fontSize: '.85rem' },
          textContent: classesSummary(h.assignedClassIds, state.classes)
        }));

        const statusTd = el('td');
        statusTd.appendChild(statusBadge(h.status, h.published));
        tr.appendChild(statusTd);

        const actionsTd = el('td', { style: { textAlign: 'right' } });
        const btnGroup = el('div', {
          style: { display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' }
        });

        btnGroup.appendChild(el('button', {
          type: 'button',
          className: 'btn btn-outline btn-sm',
          textContent: 'Challenges',
          onClick: function () { ctx.navigate('teacher.challenges', { huntId: h.huntId }); }
        }));
        btnGroup.appendChild(el('button', {
          type: 'button',
          className: 'btn btn-outline btn-sm',
          textContent: 'Edit',
          onClick: function () { openEditModal(h); }
        }));
        btnGroup.appendChild(el('button', {
          type: 'button',
          className: 'btn btn-danger btn-sm',
          textContent: 'Archive',
          onClick: function () { archiveHunt(h); }
        }));

        actionsTd.appendChild(btnGroup);
        tr.appendChild(actionsTd);

        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
      container.appendChild(wrap);
    }

    function openCreateModal() { openHuntModal({}, 'Create treasure hunt', false); }
    function openEditModal(hunt) { openHuntModal(hunt, 'Edit treasure hunt', true); }

    function openHuntModal(initial, title, isEdit) {
      const classes = state.classes;
      const vals = {
        name: initial.name || '',
        description: initial.description || '',
        instructions: initial.instructions || '',
        startDate: isoDateOnly(initial.startDate),
        endDate: isoDateOnly(initial.endDate),
        classIds: Array.isArray(initial.assignedClassIds) ? initial.assignedClassIds.slice() : [],
        published: initial.published === true
      };

      const form = el('form', { className: 'form' });

      const nameInput = el('input', {
        type: 'text', value: vals.name, maxlength: '100',
        placeholder: 'e.g. Science Week 2025', required: 'required'
      });
      form.appendChild(fieldRow('Hunt name *', nameInput));

      const descInput = el('textarea', { rows: '2', placeholder: 'Short description shown to students' });
      descInput.value = vals.description;
      form.appendChild(fieldRow('Description', descInput));

      const instrInput = el('textarea', { rows: '2', placeholder: 'Instructions for students' });
      instrInput.value = vals.instructions;
      form.appendChild(fieldRow('Instructions', instrInput));

      const datesRow = el('div', { className: 'form-row' });
      const startInput = el('input', { type: 'date', value: vals.startDate });
      datesRow.appendChild(fieldRow('Start date', startInput));
      const endInput = el('input', { type: 'date', value: vals.endDate });
      datesRow.appendChild(fieldRow('End date', endInput));
      form.appendChild(datesRow);

      const classField = el('label');
      classField.appendChild(el('span', { textContent: 'Available to classes' }));
      const classList = el('div', { className: 'checkbox-list' });
      if (!classes.length) {
        classList.appendChild(el('div', { className: 'muted', textContent: 'No classes available.' }));
      } else {
        classes.forEach(function (c) {
          const row = el('label');
          const cb = el('input', { type: 'checkbox' });
          cb.checked = vals.classIds.indexOf(String(c.classId)) >= 0;
          cb.addEventListener('change', function () {
            const id = String(c.classId);
            const i = vals.classIds.indexOf(id);
            if (cb.checked && i < 0) vals.classIds.push(id);
            else if (!cb.checked && i >= 0) vals.classIds.splice(i, 1);
          });
          row.appendChild(cb);
          row.appendChild(el('span', { textContent: c.className || 'Class' }));
          classList.appendChild(row);
        });
      }
      classField.appendChild(classList);
      classField.appendChild(el('div', {
        className: 'muted',
        style: { fontSize: '.78rem', marginTop: '4px' },
        textContent: 'If none selected, the hunt is visible to all classes.'
      }));
      form.appendChild(classField);

      const pubRow = el('div', { className: 'checkbox-row' });
      const pubCb = el('input', { type: 'checkbox' });
      pubCb.checked = vals.published;
      pubRow.appendChild(pubCb);
      pubRow.appendChild(el('label', {
        textContent: 'Publish to students',
        style: { margin: '0', fontWeight: '500', cursor: 'pointer' }
      }));
      form.appendChild(pubRow);

      const errorEl = el('div', { className: 'error-text hidden' });
      form.appendChild(errorEl);

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        errorEl.classList.add('hidden');
        errorEl.textContent = '';

        const name = nameInput.value.trim();
        if (!name) {
          errorEl.textContent = 'Hunt name is required.';
          errorEl.classList.remove('hidden');
          return;
        }
        if (startInput.value && endInput.value &&
            new Date(startInput.value).getTime() > new Date(endInput.value).getTime()) {
          errorEl.textContent = 'End date must be after start date.';
          errorEl.classList.remove('hidden');
          return;
        }

        const payload = {
          name: name,
          description: descInput.value || '',
          instructions: instrInput.value || '',
          startDate: startInput.value || '',
          endDate: endInput.value || '',
          classIds: vals.classIds.slice(),
          published: pubCb.checked
        };

        if (isEdit) payload.huntId = initial.huntId;

        const promise = isEdit
          ? api().teacher.updateHunt(payload)
          : api().teacher.createHunt(payload);

        promise.then(function () {
          if (!state.mounted) return;
          if (ui() && ui().closeModal) ui().closeModal();
          toast(isEdit ? 'Hunt updated.' : 'Hunt created.', 'success');
          loadAll();
        }).catch(function (err) {
          if (!state.mounted) return;
          if (api().isAuthError && api().isAuthError(err)) return;
          errorEl.textContent = safeMsg(err);
          errorEl.classList.remove('hidden');
        });
      });

      const body = el('div');
      body.appendChild(form);

      if (ui() && ui().showModal) {
        ui().showModal({
          title: title,
          body: body,
          wide: true,
          footer: [
            { label: 'Cancel', variant: 'outline', onClick: function () { ui().closeModal(); } },
            {
              label: isEdit ? 'Save changes' : 'Create hunt',
              variant: 'primary',
              onClick: function () {
                form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
              }
            }
          ]
        });
      } else {
        container.insertBefore(body, container.firstChild);
      }
    }

    async function archiveHunt(hunt) {
      const ok = await confirmDialog(
        'Archive "' + (hunt.name || 'this hunt') + '"? Students will no longer see it, ' +
        'but existing scores are kept.',
        { title: 'Archive hunt?', confirmLabel: 'Archive', danger: true }
      );
      if (!ok) return;
      try {
        await api().teacher.deleteHunt(hunt.huntId);
        if (!state.mounted) return;
        toast('Hunt archived.', 'success');
        loadAll();
      } catch (err) {
        if (!state.mounted) return;
        if (api().isAuthError && api().isAuthError(err)) return;
        toast('Could not archive: ' + safeMsg(err), 'error', 4000);
      }
    }

    paint();
    loadAll();
    ctx.onCleanup(function () { state.mounted = false; });
  }

  /* ============================ VIEW: teacher.challenges ============================ */

  async function renderTeacherChallenges(container, ctx) {
    const state = {
      hunts: [],
      quizzes: [],
      classes: [],
      challenges: [],
      filterHuntId: String((ctx.params && ctx.params.huntId) || ''),
      isLoading: true,
      loadError: '',
      mounted: true
    };

    async function loadAll() {
      state.isLoading = true;
      state.loadError = '';
      paint();
      try {
        const results = await Promise.all([
          api().teacher.getHunts(),
          api().teacher.getQuizzes(),
          api().teacher.getClasses()
        ]);
        if (!state.mounted) return;
        state.hunts     = Array.isArray(results[0]) ? results[0] : [];
        state.quizzes   = Array.isArray(results[1]) ? results[1] : [];
        state.classes   = Array.isArray(results[2]) ? results[2] : [];
        await loadChallenges();
      } catch (err) {
        if (!state.mounted) return;
        if (api().isAuthError && api().isAuthError(err)) return;
        state.isLoading = false;
        state.loadError = safeMsg(err);
        paint();
      }
    }

    async function loadChallenges() {
      try {
        const list = await api().teacher.getChallenges(state.filterHuntId || '');
        if (!state.mounted) return;
        state.challenges = Array.isArray(list) ? list : [];
        state.isLoading = false;
        paint();
      } catch (err) {
        if (!state.mounted) return;
        if (api().isAuthError && api().isAuthError(err)) return;
        state.isLoading = false;
        state.loadError = safeMsg(err);
        paint();
      }
    }

    function huntName(huntId) {
      const h = state.hunts.find(function (x) { return x.huntId === huntId; });
      return h ? (h.name || 'Hunt') : '\u2014';
    }

    function paint() {
      container.innerHTML = '';

      container.appendChild(el('div', {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '12px',
          flexWrap: 'wrap',
          marginBottom: '16px'
        }
      }, [
        (function () {
          const w = el('div');
          w.appendChild(el('h2', { textContent: 'Challenges', style: { marginBottom: '4px' } }));
          w.appendChild(el('p', {
            className: 'muted',
            style: { margin: '0' },
            textContent: 'All challenges across your hunts. Create new challenges in the QR generator.'
          }));
          return w;
        })(),
        el('button', {
          type: 'button',
          className: 'btn btn-primary',
          textContent: 'Create challenge & QR',
          onClick: function () { ctx.navigate('teacher.qrGenerator'); }
        })
      ]));

      const filterRow = el('div', { className: 'leaderboard-filter' });
      const huntSel = el('select', { 'aria-label': 'Filter by hunt' });
      huntSel.appendChild(el('option', { value: '', textContent: 'All hunts' }));
      state.hunts.forEach(function (h) {
        const o = el('option', { value: String(h.huntId), textContent: h.name || 'Hunt' });
        if (String(h.huntId) === String(state.filterHuntId)) o.selected = true;
        huntSel.appendChild(o);
      });
      huntSel.addEventListener('change', function () {
        state.filterHuntId = String(huntSel.value || '');
        loadChallenges();
      });
      filterRow.appendChild(huntSel);

      const refreshBtn = el('button', {
        type: 'button', className: 'btn btn-outline btn-sm',
        textContent: 'Refresh', onClick: loadChallenges
      });
      filterRow.appendChild(refreshBtn);
      container.appendChild(filterRow);

      if (state.isLoading) { container.appendChild(loadingBox('Loading challenges\u2026')); return; }
      if (state.loadError) {
        container.appendChild(errorBox('Could not load challenges', state.loadError, loadAll));
        return;
      }
      if (!state.challenges.length) {
        container.appendChild(emptyBox(
          'No challenges',
          state.filterHuntId
            ? 'This hunt has no challenges yet. Add one in the QR generator.'
            : 'Create your first challenge in the QR generator to get a printable QR code.',
          'Open QR generator',
          function () { ctx.navigate('teacher.qrGenerator'); }
        ));
        return;
      }

      const wrap = el('div', { className: 'table-wrap' });
      const table = el('table');
      const thead = el('thead');
      const hr = el('tr');
      hr.appendChild(el('th', { textContent: 'Challenge' }));
      hr.appendChild(el('th', { textContent: 'Points', className: 'numeric' }));
      hr.appendChild(el('th', { textContent: 'Pass %', className: 'numeric' }));
      hr.appendChild(el('th', { textContent: 'Classes' }));
      hr.appendChild(el('th', { textContent: 'Status' }));
      hr.appendChild(el('th', { textContent: 'Actions', style: { textAlign: 'right' } }));
      thead.appendChild(hr);
      table.appendChild(thead);

      const tbody = el('tbody');
      state.challenges.forEach(function (c) {
        const tr = el('tr');

        const nameTd = el('td');
        nameTd.appendChild(el('div', {
          style: { fontWeight: '600', color: '#0f2a44' },
          textContent: c.name || 'Untitled challenge'
        }));
        nameTd.appendChild(el('div', {
          className: 'muted',
          style: { fontSize: '.78rem', marginTop: '2px' },
          textContent: huntName(c.huntId)
        }));
        tr.appendChild(nameTd);

        tr.appendChild(el('td', { className: 'numeric', textContent: String(num(c.maxPoints)) }));
        tr.appendChild(el('td', { className: 'numeric', textContent: String(num(c.passingPercent)) + '%' }));
        tr.appendChild(el('td', {
          className: 'muted',
          style: { fontSize: '.85rem' },
          textContent: classesSummary(c.assignedClassIds, state.classes)
        }));

        const statusTd = el('td');
        statusTd.appendChild(statusBadge(c.status, true));
        tr.appendChild(statusTd);

        const actionsTd = el('td', { style: { textAlign: 'right' } });
        const btnGroup = el('div', {
          style: { display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' }
        });

        btnGroup.appendChild(el('button', {
          type: 'button', className: 'btn btn-outline btn-sm', textContent: 'Edit',
          onClick: function () { openEditChallenge(c); }
        }));
        btnGroup.appendChild(el('button', {
          type: 'button', className: 'btn btn-outline btn-sm', textContent: 'QR',
          onClick: function () { ctx.navigate('teacher.qrGenerator'); }
        }));
        btnGroup.appendChild(el('button', {
          type: 'button', className: 'btn btn-outline btn-sm', textContent: 'Regen',
          onClick: function () { regenerateToken(c); }
        }));
        btnGroup.appendChild(el('button', {
          type: 'button', className: 'btn btn-danger btn-sm', textContent: 'Disable',
          onClick: function () { disableChallenge(c); }
        }));

        actionsTd.appendChild(btnGroup);
        tr.appendChild(actionsTd);

        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
      container.appendChild(wrap);
    }

    function openEditChallenge(c) {
      const vals = {
        name: c.name || '',
        description: c.description || '',
        quizId: c.quizId || '',
        formUrl: c.formUrl || '',
        maxPoints: num(c.maxPoints),
        passingPercent: num(c.passingPercent),
        startDate: isoDateOnly(c.startDate),
        endDate: isoDateOnly(c.endDate),
        classIds: Array.isArray(c.assignedClassIds) ? c.assignedClassIds.slice() : [],
        orderIndex: num(c.orderIndex)
      };

      const form = el('form', { className: 'form' });

      const nameInput = el('input', { type: 'text', value: vals.name, maxlength: '100', required: 'required' });
      form.appendChild(fieldRow('Challenge name *', nameInput));

      const descInput = el('textarea', { rows: '2', placeholder: 'Shown to students' });
      descInput.value = vals.description;
      form.appendChild(fieldRow('Description', descInput));

      const quizSel = el('select');
      quizSel.appendChild(el('option', { value: '', textContent: 'None (no built-in quiz)' }));
      state.quizzes.forEach(function (q) {
        const o = el('option', {
          value: String(q.quizId),
          textContent: (q.title || 'Quiz') + ' (' + num(q.questionCount) + ' questions)'
        });
        if (String(q.quizId) === String(vals.quizId)) o.selected = true;
        quizSel.appendChild(o);
      });
      form.appendChild(fieldRow('Built-in quiz', quizSel));

      const formUrlInput = el('input', {
        type: 'url', value: vals.formUrl, placeholder: 'https://docs.google.com/forms/...'
      });
      const formUrlField = fieldRow('Google Form URL (optional)', formUrlInput);
      formUrlField.appendChild(el('div', {
        className: 'muted',
        style: { fontSize: '.78rem', marginTop: '4px' },
        textContent: 'Used as a link only — the app does not auto-grade Google Forms.'
      }));
      form.appendChild(formUrlField);

      const row1 = el('div', { className: 'form-row' });
      const pointsInput = el('input', { type: 'number', min: '0', max: '1000', value: String(vals.maxPoints) });
      row1.appendChild(fieldRow('Points *', pointsInput));
      const passingInput = el('input', { type: 'number', min: '0', max: '100', value: String(vals.passingPercent) });
      row1.appendChild(fieldRow('Passing % *', passingInput));
      form.appendChild(row1);

      const row2 = el('div', { className: 'form-row' });
      const startInput = el('input', { type: 'date', value: vals.startDate });
      row2.appendChild(fieldRow('Start date', startInput));
      const endInput = el('input', { type: 'date', value: vals.endDate });
      row2.appendChild(fieldRow('End date', endInput));
      form.appendChild(row2);

      const orderInput = el('input', { type: 'number', min: '0', step: '1', value: String(vals.orderIndex) });
      form.appendChild(fieldRow('Order in hunt', orderInput));

      const classField = el('label');
      classField.appendChild(el('span', { textContent: 'Available to classes' }));
      const classList = el('div', { className: 'checkbox-list' });
      if (!state.classes.length) {
        classList.appendChild(el('div', { className: 'muted', textContent: 'No classes available.' }));
      } else {
        state.classes.forEach(function (cl) {
          const row = el('label');
          const cb = el('input', { type: 'checkbox' });
          cb.checked = vals.classIds.indexOf(String(cl.classId)) >= 0;
          cb.addEventListener('change', function () {
            const id = String(cl.classId);
            const i = vals.classIds.indexOf(id);
            if (cb.checked && i < 0) vals.classIds.push(id);
            else if (!cb.checked && i >= 0) vals.classIds.splice(i, 1);
          });
          row.appendChild(cb);
          row.appendChild(el('span', { textContent: cl.className || 'Class' }));
          classList.appendChild(row);
        });
      }
      classField.appendChild(classList);
      form.appendChild(classField);

      const errorEl = el('div', { className: 'error-text hidden' });
      form.appendChild(errorEl);

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        errorEl.classList.add('hidden');
        errorEl.textContent = '';

        const name = nameInput.value.trim();
        if (!name) { errorEl.textContent = 'Name is required.'; errorEl.classList.remove('hidden'); return; }
        if (num(pointsInput.value) < 0) { errorEl.textContent = 'Points cannot be negative.'; errorEl.classList.remove('hidden'); return; }
        const pass = num(passingInput.value);
        if (pass < 0 || pass > 100) { errorEl.textContent = 'Passing % must be 0\u2013100.'; errorEl.classList.remove('hidden'); return; }
        if (startInput.value && endInput.value &&
            new Date(startInput.value).getTime() > new Date(endInput.value).getTime()) {
          errorEl.textContent = 'End date must be after start date.';
          errorEl.classList.remove('hidden');
          return;
        }

        const payload = {
          challengeId: c.challengeId,
          name: name,
          description: descInput.value || '',
          quizId: String(quizSel.value || ''),
          formUrl: formUrlInput.value || '',
          maxPoints: num(pointsInput.value),
          passingPercent: pass,
          startDate: startInput.value || '',
          endDate: endInput.value || '',
          classIds: vals.classIds.slice(),
          orderIndex: num(orderInput.value)
        };

        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<span class="spinner-sm"></span>Saving\u2026'; }

        api().teacher.updateChallenge(payload).then(function () {
          if (!state.mounted) return;
          if (ui() && ui().closeModal) ui().closeModal();
          toast('Challenge updated.', 'success');
          loadChallenges();
        }).catch(function (err) {
          if (!state.mounted) return;
          if (api().isAuthError && api().isAuthError(err)) return;
          errorEl.textContent = safeMsg(err);
          errorEl.classList.remove('hidden');
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save changes'; }
        });
      });

      if (ui() && ui().showModal) {
        ui().showModal({
          title: 'Edit challenge',
          body: form,
          wide: true,
          footer: [
            { label: 'Cancel', variant: 'outline', onClick: function () { ui().closeModal(); } },
            {
              label: 'Save changes',
              variant: 'primary',
              onClick: function () {
                form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
              }
            }
          ]
        });
      }
    }

    async function regenerateToken(c) {
      const ok = await confirmDialog(
        'Regenerate QR token for "' + (c.name || 'this challenge') + '"? ' +
        'Any previously printed QR code will stop working immediately.',
        { title: 'Regenerate token?', confirmLabel: 'Regenerate', danger: true }
      );
      if (!ok) return;
      try {
        await api().teacher.regenerateToken(c.challengeId);
        if (!state.mounted) return;
        toast('Token regenerated. Reprint this challenge\u2019s QR.', 'success', 4000);
      } catch (err) {
        if (!state.mounted) return;
        if (api().isAuthError && api().isAuthError(err)) return;
        toast('Could not regenerate: ' + safeMsg(err), 'error', 4000);
      }
    }

    async function disableChallenge(c) {
      const ok = await confirmDialog(
        'Disable "' + (c.name || 'this challenge') + '"? It will stop awarding points and its QR will not work. ' +
        'Existing scores are kept.',
        { title: 'Disable challenge?', confirmLabel: 'Disable', danger: true }
      );
      if (!ok) return;
      try {
        await api().teacher.disableChallenge(c.challengeId);
        if (!state.mounted) return;
        toast('Challenge disabled.', 'success');
        loadChallenges();
      } catch (err) {
        if (!state.mounted) return;
        if (api().isAuthError && api().isAuthError(err)) return;
        toast('Could not disable: ' + safeMsg(err), 'error', 4000);
      }
    }

    paint();
    loadAll();
    ctx.onCleanup(function () { state.mounted = false; });
  }

  /* ============================ REGISTER (Part 1) ============================ */

  window.APP.views.renderTeacherDashboard  = renderTeacherDashboard;
  window.APP.views.renderTeacherHunts      = renderTeacherHunts;
  window.APP.views.renderTeacherChallenges = renderTeacherChallenges;

  /* ============================================================
     PART 2 (second IIFE, appended to this file) registers:

       renderTeacherQuizManager
       renderTeacherStudents
       renderTeacherReports   ← includes submissions filter + table
       renderTeacherIntegrations
       renderTeacherSettings

     Until Part 2 is appended, the five views above resolve to
     app.js's "Coming soon" fallback. Nothing breaks.
     ============================================================ */
})();

/* =========================================================
   TREASURE HUNT APP — teacher.js (PART 2 OF 2)
   ---------------------------------------------------------
   Appended to js/teacher.js. Registers the remaining five
   teacher views against APP.views:

     teacher.quizManager  → renderTeacherQuizManager
     teacher.students     → renderTeacherStudents
     teacher.reports      → renderTeacherReports
     teacher.integrations → renderTeacherIntegrations
     teacher.settings     → renderTeacherSettings

   Because IIFEs do not share scope, helpers from Part 1
   are re-declared identically here. No behaviour drift.

   Backend contract:
     teacher.getQuizzes()          → [{ quizId, title, description,
                                        timeLimitMinutes, passingPercent,
                                        status, questionCount }]
     teacher.getQuiz(quizId)       → { quiz:{...}, questions:[
                                        { questionId, type, text,
                                          options[], correctIndex,
                                          explanation, marks,
                                          orderIndex } ] }
     teacher.saveQuiz(payload)     → { quizId }
       payload: { quizId?, title, description, timeLimitMinutes,
                  passingPercent, questions:[{ type, text, options[],
                  correctIndex, explanation, marks }] }
     teacher.deleteQuiz(quizId)    → { ok }   (archives)
     teacher.getStudents()         → [{ studentId, displayName, email,
                                        classId, className, totalPoints,
                                        challengesCompleted }]
     teacher.getStudentReport(id)  → { student:{...}, totalPoints,
                                        challenges:[...],
                                        submissions:[...] }
     teacher.getReports({classId,
                          huntId}) → { students[], challengeStats[],
                                        summary:{ participatingStudents,
                                                  totalStudents,
                                                  totalPoints,
                                                  averagePoints } }
     teacher.getSubmissions({classId, huntId, status, limit})
                                   → { rows:[{ submissionId, studentId,
                                        studentName, classId, className,
                                        challengeId, challengeName,
                                        huntName, score, maxScore,
                                        percent, passed, gradingStatus,
                                        submittedAt }],
                                       filtered:{ classId, huntId,
                                                   status },
                                       total }
     teacher.getHunts()            → [{ huntId, name, ... }]
     teacher.getClasses()          → [{ classId, className, teacherIds[] }]
   ========================================================= */

(function () {
  'use strict';

  const cfg = window.APP.config;

  /* ============================ HELPERS ============================ */

  function api() { return window.APP.api; }
  function ui()  { return window.APP.ui; }

  function el(tag, attrs, children) {
    if (ui() && typeof ui().el === 'function') return ui().el(tag, attrs, children);
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
        } else node.setAttribute(k, String(v));
      });
    }
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
    if (ui() && typeof ui().toast === 'function') ui().toast(msg, type, timeout);
    else { try { console.log('[toast]', type || '', msg); } catch (e) {} }
  }

  function confirmDialog(msg, opts) {
    if (ui() && typeof ui().confirm === 'function') return ui().confirm(msg, opts);
    return Promise.resolve(window.confirm(msg));
  }

  function safeMsg(err) {
    const a = api();
    return a && a.safeMessage ? a.safeMessage(err) : ((err && err.message) || 'Something went wrong.');
  }

  function num(n) { const v = Number(n); return isNaN(v) ? 0 : v; }

  function isoDateOnly(s) {
    if (!s) return '';
    try {
      const d = new Date(s);
      if (isNaN(d.getTime())) return '';
      return d.getUTCFullYear() + '-' +
        String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
        String(d.getUTCDate()).padStart(2, '0');
    } catch (e) { return ''; }
  }

  function fmtDate(iso) {
    if (!iso) return '\u2014';
    if (ui() && typeof ui().formatDate === 'function') return ui().formatDate(iso);
    try {
      const d = new Date(iso);
      return isNaN(d.getTime()) ? String(iso)
        : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (e) { return String(iso); }
  }

  function fmtDateTime(iso) {
    if (!iso) return '\u2014';
    if (ui() && typeof ui().formatDateTime === 'function') return ui().formatDateTime(iso);
    try {
      const d = new Date(iso);
      return isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
    } catch (e) { return String(iso); }
  }

  function loadingBox(msg) {
    const box = el('div', { className: 'empty-state' });
    box.appendChild(el('div', { className: 'spinner', style: { margin: '0 auto 12px' } }));
    box.appendChild(el('p', { textContent: msg || 'Loading\u2026' }));
    return box;
  }

  function errorBox(title, message, onRetry) {
    const card = el('div', { className: 'card' });
    const body = el('div', { className: 'card-body', style: { textAlign: 'center', padding: '36px 24px' } });
    body.appendChild(el('h3', { textContent: title || 'Could not load' }));
    body.appendChild(el('p', { className: 'muted', textContent: message || '' }));
    if (typeof onRetry === 'function') {
      body.appendChild(el('button', {
        type: 'button', className: 'btn btn-primary', textContent: 'Retry',
        onClick: onRetry
      }));
    }
    card.appendChild(body);
    return card;
  }

  function emptyBox(title, message, ctaLabel, onCta) {
    const box = el('div', { className: 'empty-state' });
    box.appendChild(el('h3', { textContent: title || 'Nothing here yet' }));
    if (message) box.appendChild(el('p', { textContent: message }));
    if (ctaLabel && typeof onCta === 'function') {
      box.appendChild(el('button', {
        type: 'button', className: 'btn btn-primary',
        textContent: ctaLabel, style: { marginTop: '12px' },
        onClick: onCta
      }));
    }
    return box;
  }

  function statCard(opts) {
    const card = el('div', { className: 'stat-card' + (opts.accent ? ' accent' : '') });
    card.appendChild(el('div', { className: 'stat-label', textContent: opts.label || '' }));
    card.appendChild(el('div', { className: 'stat-value', textContent: String(opts.value != null ? opts.value : '') }));
    if (opts.sub) card.appendChild(el('div', { className: 'stat-sub', textContent: opts.sub }));
    return card;
  }

  function fieldRow(labelText, inputNode) {
    const l = el('label');
    l.appendChild(el('span', { textContent: labelText }));
    l.appendChild(inputNode);
    return l;
  }

  function csvEscape(v) {
    const s = String(v == null ? '' : v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function downloadCsv(filename, headers, rows) {
    try {
      const lines = [headers.map(csvEscape).join(',')];
      rows.forEach(function (r) {
        lines.push(r.map(csvEscape).join(','));
      });
      const csv = lines.join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || 'export.csv';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        try { URL.revokeObjectURL(url); a.remove(); } catch (e) {}
      }, 200);
      return true;
    } catch (e) { return false; }
  }

  /* =========================================================
     VIEW: teacher.quizManager
     ========================================================= */

  async function renderTeacherQuizManager(container, ctx) {
    const state = {
      quizzes: [],
      isLoading: true,
      loadError: '',
      mounted: true
    };

    async function loadQuizzes() {
      state.isLoading = true;
      state.loadError = '';
      paint();
      try {
        const data = await api().teacher.getQuizzes();
        if (!state.mounted) return;
        state.quizzes = Array.isArray(data) ? data : [];
        state.isLoading = false;
        paint();
      } catch (err) {
        if (!state.mounted) return;
        if (api().isAuthError && api().isAuthError(err)) return;
        state.isLoading = false;
        state.loadError = safeMsg(err);
        paint();
      }
    }

    function paint() {
      container.innerHTML = '';

      container.appendChild(el('div', {
        style: {
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          gap: '12px', flexWrap: 'wrap', marginBottom: '16px'
        }
      }, [
        (function () {
          const w = el('div');
          w.appendChild(el('h2', { textContent: 'Quiz Manager', style: { marginBottom: '4px' } }));
          w.appendChild(el('p', {
            className: 'muted', style: { margin: '0' },
            textContent: 'Build built-in quizzes for challenges. All grading happens on the server.'
          }));
          return w;
        })(),
        el('button', {
          type: 'button', className: 'btn btn-primary',
          textContent: 'New quiz', onClick: openCreateQuiz
        })
      ]));

      if (state.isLoading) { container.appendChild(loadingBox('Loading quizzes\u2026')); return; }
      if (state.loadError) {
        container.appendChild(errorBox('Could not load quizzes', state.loadError, loadQuizzes));
        return;
      }
      if (!state.quizzes.length) {
        container.appendChild(emptyBox(
          'No quizzes yet',
          'Create your first quiz. Every built-in quiz uses multiple-choice and true/false questions.',
          'Create first quiz', openCreateQuiz
        ));
        return;
      }

      const wrap = el('div', { className: 'table-wrap' });
      const table = el('table');
      const thead = el('thead');
      const hr = el('tr');
      hr.appendChild(el('th', { textContent: 'Quiz' }));
      hr.appendChild(el('th', { textContent: 'Questions', className: 'numeric' }));
      hr.appendChild(el('th', { textContent: 'Pass %', className: 'numeric' }));
      hr.appendChild(el('th', { textContent: 'Time', className: 'numeric' }));
      hr.appendChild(el('th', { textContent: 'Status' }));
      hr.appendChild(el('th', { textContent: 'Actions', style: { textAlign: 'right' } }));
      thead.appendChild(hr);
      table.appendChild(thead);

      const tbody = el('tbody');
      state.quizzes.forEach(function (q) {
        const tr = el('tr');

        const nameTd = el('td');
        nameTd.appendChild(el('div', {
          style: { fontWeight: '600', color: '#0f2a44' }, textContent: q.title || 'Untitled quiz'
        }));
        if (q.description) {
          nameTd.appendChild(el('div', {
            className: 'muted', style: { fontSize: '.8rem', marginTop: '2px', maxWidth: '340px' },
            textContent: q.description
          }));
        }
        tr.appendChild(nameTd);

        tr.appendChild(el('td', { className: 'numeric', textContent: String(num(q.questionCount)) }));
        tr.appendChild(el('td', { className: 'numeric', textContent: String(num(q.passingPercent)) + '%' }));
        tr.appendChild(el('td', {
          className: 'numeric',
          textContent: num(q.timeLimitMinutes) > 0 ? num(q.timeLimitMinutes) + ' min' : '\u2014'
        }));

        const st = String(q.status || '').toLowerCase();
        const statusTd = el('td');
        statusTd.appendChild(el('span', {
          className: 'badge ' + (st === 'archived' ? 'badge-grey' : 'badge-green'),
          textContent: st === 'archived' ? 'Archived' : 'Active'
        }));
        tr.appendChild(statusTd);

        const actionsTd = el('td', { style: { textAlign: 'right' } });
        const btnGroup = el('div', {
          style: { display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' }
        });
        btnGroup.appendChild(el('button', {
          type: 'button', className: 'btn btn-outline btn-sm', textContent: 'Edit',
          onClick: function () { openEditQuiz(q.quizId); }
        }));
        btnGroup.appendChild(el('button', {
          type: 'button', className: 'btn btn-outline btn-sm', textContent: 'Preview',
          onClick: function () { previewQuiz(q.quizId); }
        }));
        btnGroup.appendChild(el('button', {
          type: 'button', className: 'btn btn-danger btn-sm', textContent: 'Archive',
          onClick: function () { archiveQuiz(q); }
        }));
        actionsTd.appendChild(btnGroup);
        tr.appendChild(actionsTd);

        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
      container.appendChild(wrap);
    }

    /* ---------- Quiz editor ---------- */
    let qidCounter = 0;
    function newQid() { qidCounter += 1; return 'q' + qidCounter; }

    function blankQuestion() {
      return {
        _id: newQid(),
        type: 'mc',
        text: '',
        options: ['', ''],
        correctIndex: 0,
        explanation: '',
        marks: 1
      };
    }

    function editorStateFromQuiz(data) {
      const s = {
        quizId: data.quiz.quizId || '',
        title: data.quiz.title || '',
        description: data.quiz.description || '',
        timeLimitMinutes: num(data.quiz.timeLimitMinutes),
        passingPercent: num(data.quiz.passingPercent),
        questions: []
      };
      (data.questions || []).forEach(function (q) {
        s.questions.push({
          _id: newQid(),
          type: String(q.type || 'mc'),
          text: q.text || '',
          options: Array.isArray(q.options) && q.options.length >= 2
            ? q.options.slice()
            : (String(q.type) === 'tf' ? ['True', 'False'] : ['', '']),
          correctIndex: num(q.correctIndex),
          explanation: q.explanation || '',
          marks: num(q.marks) || 1
        });
      });
      if (!s.questions.length) s.questions.push(blankQuestion());
      return s;
    }

    function newEditorState() {
      return {
        quizId: '',
        title: '',
        description: '',
        timeLimitMinutes: 0,
        passingPercent: 60,
        questions: [blankQuestion()]
      };
    }

    function openCreateQuiz() { openQuizEditor(newEditorState(), false); }

    async function openEditQuiz(quizId) {
      try {
        const data = await api().teacher.getQuiz(quizId);
        if (!state.mounted) return;
        openQuizEditor(editorStateFromQuiz(data), true);
      } catch (err) {
        if (!state.mounted) return;
        if (api().isAuthError && api().isAuthError(err)) return;
        toast('Could not load quiz: ' + safeMsg(err), 'error', 4000);
      }
    }

    async function previewQuiz(quizId) {
      try {
        const data = await api().teacher.getQuiz(quizId);
        if (!state.mounted) return;
        renderQuizPreview(data);
      } catch (err) {
        if (!state.mounted) return;
        if (api().isAuthError && api().isAuthError(err)) return;
        toast('Could not load quiz: ' + safeMsg(err), 'error', 4000);
      }
    }

    function renderQuizPreview(data) {
      const body = el('div');
      body.appendChild(el('h3', { textContent: data.quiz.title || 'Quiz preview', style: { marginTop: '0' } }));
      if (data.quiz.description) {
        body.appendChild(el('p', { className: 'muted', textContent: data.quiz.description }));
      }
      const meta = el('div', {
        style: { display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '12px', fontSize: '.85rem', color: '#64748b' }
      });
      meta.appendChild(el('span', { textContent: (data.questions || []).length + ' questions' }));
      meta.appendChild(el('span', { textContent: 'Pass at ' + num(data.quiz.passingPercent) + '%' }));
      if (num(data.quiz.timeLimitMinutes) > 0) {
        meta.appendChild(el('span', { textContent: 'Time: ' + num(data.quiz.timeLimitMinutes) + ' min' }));
      }
      body.appendChild(meta);

      (data.questions || []).forEach(function (q, i) {
        const card = el('div', {
          style: {
            padding: '12px 14px', border: '1px solid #e2e8f0',
            borderRadius: '8px', marginBottom: '8px', background: '#f9fafc'
          }
        });
        card.appendChild(el('div', {
          style: { fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.05em', color: '#64748b', fontWeight: '700' },
          textContent: 'Q' + (i + 1) + ' \u00b7 ' + num(q.marks) + ' mark' + (num(q.marks) === 1 ? '' : 's')
        }));
        card.appendChild(el('div', {
          style: { fontWeight: '600', color: '#0f2a44', margin: '4px 0 8px' },
          textContent: q.text || '(no text)'
        }));
        const opts = Array.isArray(q.options) ? q.options : [];
        opts.forEach(function (opt, oi) {
          const isCorrect = num(q.correctIndex) === oi;
          const row = el('div', {
            style: {
              padding: '6px 10px', borderRadius: '6px',
              background: isCorrect ? '#e6f5ec' : 'transparent',
              color: isCorrect ? '#178a48' : '#475569',
              fontWeight: isCorrect ? '600' : '400', fontSize: '.9rem'
            }
          });
          row.textContent = (isCorrect ? '\u2713 ' : '\u25cb ') + String(opt || '(empty)');
          card.appendChild(row);
        });
        if (q.explanation) {
          card.appendChild(el('div', {
            className: 'muted',
            style: { fontSize: '.82rem', marginTop: '8px', fontStyle: 'italic' },
            textContent: 'Explanation: ' + q.explanation
          }));
        }
        body.appendChild(card);
      });

      if (ui() && ui().showModal) {
        ui().showModal({
          title: 'Quiz preview',
          body: body,
          wide: true,
          footer: [{ label: 'Close', variant: 'primary', onClick: function () { ui().closeModal(); } }]
        });
      }
    }

    function openQuizEditor(editorState, isEdit) {
      const modalBody = el('div');
      modalBody.style.maxHeight = '62vh';
      modalBody.style.overflowY = 'auto';
      modalBody.style.paddingRight = '4px';

      if (isEdit) {
        const warn = el('div', {
          style: {
            padding: '10px 14px', marginBottom: '12px',
            background: '#fdf6e3', border: '1px solid #f0dfa8',
            borderRadius: '8px', fontSize: '.85rem', color: '#7a5a00'
          }
        });
        warn.appendChild(el('strong', { textContent: 'Heads up: ' }));
        warn.appendChild(document.createTextNode(
          'Saving replaces all existing questions. Students with attempts in progress will be graded against the new questions on their next submit.'
        ));
        modalBody.appendChild(warn);
      }

      // ---- Metadata ----
      const metaSection = el('div');
      const titleInput = el('input', {
        type: 'text', value: editorState.title, maxlength: '100',
        placeholder: 'e.g. Science Lab Basics'
      });
      titleInput.addEventListener('input', function () { editorState.title = titleInput.value; });
      metaSection.appendChild(fieldRow('Title *', titleInput));

      const descInput = el('textarea', { rows: '2', placeholder: 'Optional description shown to students' });
      descInput.value = editorState.description;
      descInput.addEventListener('input', function () { editorState.description = descInput.value; });
      metaSection.appendChild(fieldRow('Description', descInput));

      const metaRow = el('div', { className: 'form-row' });
      const timeInput = el('input', { type: 'number', min: '0', step: '1', value: String(editorState.timeLimitMinutes) });
      timeInput.addEventListener('input', function () { editorState.timeLimitMinutes = num(timeInput.value); });
      metaRow.appendChild(fieldRow('Time limit (minutes, 0 = no limit)', timeInput));
      const passInput = el('input', { type: 'number', min: '0', max: '100', step: '1', value: String(editorState.passingPercent) });
      passInput.addEventListener('input', function () { editorState.passingPercent = num(passInput.value); });
      metaRow.appendChild(fieldRow('Passing % *', passInput));
      metaSection.appendChild(metaRow);

      modalBody.appendChild(metaSection);
      modalBody.appendChild(el('div', { className: 'divider' }));

      modalBody.appendChild(el('div', {
        className: 'section-title', style: { marginBottom: '8px' }, textContent: 'Questions'
      }));

      const questionsContainer = el('div');
      modalBody.appendChild(questionsContainer);

      const addBtn = el('button', {
        type: 'button', className: 'btn btn-outline', textContent: '+ Add question',
        style: { marginTop: '8px' }
      });
      addBtn.addEventListener('click', function () {
        editorState.questions.push(blankQuestion());
        rebuildQuestions();
      });
      modalBody.appendChild(addBtn);

      const errorEl = el('div', { className: 'error-text hidden', style: { marginTop: '12px' } });
      modalBody.appendChild(errorEl);

      function rebuildQuestions() {
        questionsContainer.innerHTML = '';
        editorState.questions.forEach(function (q, idx) {
          questionsContainer.appendChild(buildQuestionCard(q, idx));
        });
      }

      function buildQuestionCard(q, idx) {
        const card = el('div', {
          style: {
            border: '1px solid #e2e8f0', borderRadius: '8px',
            padding: '12px 14px', marginBottom: '10px', background: '#f9fafc'
          }
        });

        const head = el('div', {
          style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' }
        });
        head.appendChild(el('span', {
          style: { fontWeight: '700', color: '#0f2a44', fontSize: '.9rem' },
          textContent: 'Q' + (idx + 1)
        }));

        const typeSel = el('select', { 'aria-label': 'Question type' });
        typeSel.appendChild(el('option', { value: 'mc', textContent: 'Multiple choice' }));
        typeSel.appendChild(el('option', { value: 'tf', textContent: 'True / False' }));
        typeSel.value = q.type;
        typeSel.addEventListener('change', function () {
          q.type = String(typeSel.value || 'mc');
          if (q.type === 'tf') {
            q.options = ['True', 'False'];
            q.correctIndex = 0;
          } else if (q.type === 'mc' && (q.options.length < 2 ||
                     (q.options[0] === 'True' && q.options[1] === 'False'))) {
            q.options = ['', ''];
            q.correctIndex = 0;
          }
          rebuildQuestions();
        });
        head.appendChild(typeSel);

        const marksInput = el('input', {
          type: 'number', min: '0', step: '1', value: String(q.marks),
          style: { width: '80px' }, 'aria-label': 'Marks'
        });
        marksInput.addEventListener('input', function () { q.marks = num(marksInput.value); });
        head.appendChild(el('span', { textContent: 'Marks:', style: { fontSize: '.85rem', color: '#64748b' } }));
        head.appendChild(marksInput);

        const removeBtn = el('button', {
          type: 'button', className: 'btn btn-danger btn-sm', textContent: 'Remove',
          style: { marginLeft: 'auto' }
        });
        removeBtn.addEventListener('click', function () {
          if (editorState.questions.length <= 1) {
            toast('At least one question is required.', 'warn');
            return;
          }
          editorState.questions.splice(idx, 1);
          rebuildQuestions();
        });
        head.appendChild(removeBtn);

        card.appendChild(head);

        const textInput = el('textarea', {
          rows: '2', placeholder: 'Question text', style: { marginBottom: '8px' }
        });
        textInput.value = q.text;
        textInput.addEventListener('input', function () { q.text = textInput.value; });
        card.appendChild(textInput);

        if (q.type === 'tf') {
          const tfRow = el('div', { style: { display: 'flex', gap: '12px', marginBottom: '8px' } });
          [0, 1].forEach(function (idx2) {
            const lbl = el('label', {
              style: {
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '6px 12px', border: '1px solid #cbd5e1', borderRadius: '6px',
                cursor: 'pointer',
                background: num(q.correctIndex) === idx2 ? '#e6f5ec' : '#fff'
              }
            });
            const radio = el('input', { type: 'radio', name: 'correct_' + q._id });
            radio.checked = num(q.correctIndex) === idx2;
            radio.addEventListener('change', function () {
              q.correctIndex = idx2;
              rebuildQuestions();
            });
            lbl.appendChild(radio);
            lbl.appendChild(el('span', { textContent: q.options[idx2] || (idx2 === 0 ? 'True' : 'False') }));
            tfRow.appendChild(lbl);
          });
          card.appendChild(el('div', {
            style: { fontSize: '.8rem', color: '#64748b', marginBottom: '4px' },
            textContent: 'Mark the correct answer:'
          }));
          card.appendChild(tfRow);
        } else {
          card.appendChild(el('div', {
            style: { fontSize: '.8rem', color: '#64748b', marginBottom: '4px' },
            textContent: 'Options (select the correct one):'
          }));
          q.options.forEach(function (opt, oi) {
            const optRow = el('div', {
              style: { display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '6px' }
            });
            const radio = el('input', { type: 'radio', name: 'correct_' + q._id });
            radio.checked = num(q.correctIndex) === oi;
            radio.addEventListener('change', function () { q.correctIndex = oi; rebuildQuestions(); });
            optRow.appendChild(radio);

            const optInput = el('input', { type: 'text', value: opt, placeholder: 'Option text', style: { flex: '1' } });
            optInput.addEventListener('input', function () { q.options[oi] = optInput.value; });
            optRow.appendChild(optInput);

            const rmBtn = el('button', {
              type: 'button', className: 'btn btn-outline btn-sm', textContent: '\u00d7',
              disabled: q.options.length <= 2,
              style: { padding: '4px 10px', minWidth: 'auto' }
            });
            rmBtn.addEventListener('click', function () {
              if (q.options.length <= 2) return;
              q.options.splice(oi, 1);
              if (num(q.correctIndex) >= q.options.length) q.correctIndex = q.options.length - 1;
              rebuildQuestions();
            });
            optRow.appendChild(rmBtn);
            card.appendChild(optRow);
          });

          const addOptBtn = el('button', {
            type: 'button', className: 'btn btn-outline btn-sm', textContent: '+ Add option',
            style: { marginTop: '4px' }
          });
          addOptBtn.addEventListener('click', function () {
            if (q.options.length >= 8) {
              toast('Maximum 8 options per question.', 'warn');
              return;
            }
            q.options.push('');
            rebuildQuestions();
          });
          card.appendChild(addOptBtn);
        }

        const explInput = el('input', {
          type: 'text', value: q.explanation,
          placeholder: 'Explanation shown after grading (optional)',
          style: { marginTop: '8px' }
        });
        explInput.addEventListener('input', function () { q.explanation = explInput.value; });
        card.appendChild(explInput);

        return card;
      }

      rebuildQuestions();

      function validate() {
        if (!String(editorState.title || '').trim()) return 'Quiz title is required.';
        if (!editorState.questions.length) return 'At least one question is required.';
        if (editorState.passingPercent < 0 || editorState.passingPercent > 100) {
          return 'Passing % must be between 0 and 100.';
        }
        for (let i = 0; i < editorState.questions.length; i++) {
          const q = editorState.questions[i];
          if (!String(q.text || '').trim()) return 'Question ' + (i + 1) + ' needs text.';
          const opts = Array.isArray(q.options) ? q.options : [];
          if (opts.length < 2) return 'Question ' + (i + 1) + ' needs at least 2 options.';
          for (let j = 0; j < opts.length; j++) {
            if (!String(opts[j] || '').trim()) return 'Question ' + (i + 1) + ', option ' + (j + 1) + ' is empty.';
          }
          if (num(q.correctIndex) < 0 || num(q.correctIndex) >= opts.length) {
            return 'Question ' + (i + 1) + ' needs a correct answer selected.';
          }
        }
        return '';
      }

      let isSaving = false;
      async function save() {
        if (isSaving) return;
        errorEl.classList.add('hidden');
        errorEl.textContent = '';
        const err = validate();
        if (err) {
          errorEl.textContent = err;
          errorEl.classList.remove('hidden');
          modalBody.scrollTop = 0;
          return;
        }

        const payload = {
          title: String(editorState.title || '').trim(),
          description: editorState.description || '',
          timeLimitMinutes: num(editorState.timeLimitMinutes),
          passingPercent: num(editorState.passingPercent),
          questions: editorState.questions.map(function (q) {
            return {
              type: q.type,
              text: q.text,
              options: (q.options || []).slice(),
              correctIndex: num(q.correctIndex),
              explanation: q.explanation || '',
              marks: num(q.marks) || 1
            };
          })
        };
        if (editorState.quizId) payload.quizId = editorState.quizId;

        isSaving = true;
        try {
          await api().teacher.saveQuiz(payload);
          if (!state.mounted) return;
          if (ui() && ui().closeModal) ui().closeModal();
          toast(isEdit ? 'Quiz updated.' : 'Quiz created.', 'success');
          loadQuizzes();
        } catch (e) {
          if (!state.mounted) return;
          if (api().isAuthError && api().isAuthError(e)) return;
          errorEl.textContent = safeMsg(e);
          errorEl.classList.remove('hidden');
        } finally {
          isSaving = false;
        }
      }

      if (ui() && ui().showModal) {
        ui().showModal({
          title: isEdit ? 'Edit quiz' : 'Create quiz',
          body: modalBody,
          wide: true,
          closable: false,
          footer: [
            { label: 'Cancel', variant: 'outline', onClick: function () { ui().closeModal(); } },
            { label: 'Save quiz', variant: 'primary', onClick: save }
          ]
        });
      }
    }

    async function archiveQuiz(quiz) {
      const ok = await confirmDialog(
        'Archive "' + (quiz.title || 'this quiz') + '"? Challenges that reference it will keep their points but the quiz will no longer be selectable.',
        { title: 'Archive quiz?', confirmLabel: 'Archive', danger: true }
      );
      if (!ok) return;
      try {
        await api().teacher.deleteQuiz(quiz.quizId);
        if (!state.mounted) return;
        toast('Quiz archived.', 'success');
        loadQuizzes();
      } catch (err) {
        if (!state.mounted) return;
        if (api().isAuthError && api().isAuthError(err)) return;
        toast('Could not archive: ' + safeMsg(err), 'error', 4000);
      }
    }

    paint();
    loadQuizzes();
    ctx.onCleanup(function () { state.mounted = false; });
  }

  /* =========================================================
     VIEW: teacher.students
     ========================================================= */

  async function renderTeacherStudents(container, ctx) {
    const state = {
      students: [],
      classes: [],
      filterClassId: '',
      filterText: '',
      isLoading: true,
      loadError: '',
      mounted: true
    };

    async function loadAll() {
      state.isLoading = true;
      state.loadError = '';
      paint();
      try {
        const results = await Promise.all([
          api().teacher.getStudents(),
          api().teacher.getClasses()
        ]);
        if (!state.mounted) return;
        state.students = Array.isArray(results[0]) ? results[0] : [];
        state.classes  = Array.isArray(results[1]) ? results[1] : [];
        state.isLoading = false;
        paint();
      } catch (err) {
        if (!state.mounted) return;
        if (api().isAuthError && api().isAuthError(err)) return;
        state.isLoading = false;
        state.loadError = safeMsg(err);
        paint();
      }
    }

    function filteredStudents() {
      let rows = state.students;
      if (state.filterClassId) {
        rows = rows.filter(function (s) { return String(s.classId) === String(state.filterClassId); });
      }
      if (state.filterText) {
        const q = state.filterText.toLowerCase();
        rows = rows.filter(function (s) {
          return String(s.displayName || '').toLowerCase().indexOf(q) >= 0 ||
                 String(s.email || '').toLowerCase().indexOf(q) >= 0;
        });
      }
      return rows.slice().sort(function (a, b) {
        return num(b.totalPoints) - num(a.totalPoints);
      });
    }

    function paint() {
      container.innerHTML = '';

      container.appendChild(el('h2', { textContent: 'Students', style: { marginBottom: '4px' } }));
      container.appendChild(el('p', {
        className: 'muted', style: { marginBottom: '16px' },
        textContent: 'View students in your classes, their points, and detailed progress.'
      }));

      if (state.isLoading) { container.appendChild(loadingBox('Loading students\u2026')); return; }
      if (state.loadError) {
        container.appendChild(errorBox('Could not load students', state.loadError, loadAll));
        return;
      }

      const filterRow = el('div', { className: 'leaderboard-filter' });
      const classSel = el('select', { 'aria-label': 'Filter by class' });
      classSel.appendChild(el('option', { value: '', textContent: 'All my classes' }));
      state.classes.forEach(function (c) {
        const o = el('option', { value: String(c.classId), textContent: c.className || 'Class' });
        if (String(c.classId) === String(state.filterClassId)) o.selected = true;
        classSel.appendChild(o);
      });
      classSel.addEventListener('change', function () {
        state.filterClassId = String(classSel.value || '');
        paint();
      });
      filterRow.appendChild(classSel);

      const searchInput = el('input', {
        type: 'text', placeholder: 'Search by name or email', value: state.filterText
      });
      searchInput.addEventListener('input', function () {
        state.filterText = String(searchInput.value || '');
        paint();
        setTimeout(function () {
          const next = container.querySelector('.leaderboard-filter input[type="text"]');
          if (next) {
            next.focus();
            try { next.setSelectionRange(next.value.length, next.value.length); } catch (e) {}
          }
        }, 0);
      });
      filterRow.appendChild(searchInput);

      const refreshBtn = el('button', {
        type: 'button', className: 'btn btn-outline btn-sm', textContent: 'Refresh',
        onClick: loadAll
      });
      filterRow.appendChild(refreshBtn);
      container.appendChild(filterRow);

      const rows = filteredStudents();

      if (!rows.length) {
        container.appendChild(emptyBox(
          'No students found',
          state.students.length ? 'Try clearing the filters above.' : 'Students will appear here once an administrator enrolls them.'
        ));
        return;
      }

      const MAX = 500;
      const shown = rows.slice(0, MAX);

      const wrap = el('div', { className: 'table-wrap' });
      const table = el('table');
      const thead = el('thead');
      const hr = el('tr');
      hr.appendChild(el('th', { textContent: 'Student' }));
      hr.appendChild(el('th', { textContent: 'Class' }));
      hr.appendChild(el('th', { textContent: 'Points', className: 'numeric' }));
      hr.appendChild(el('th', { textContent: 'Challenges', className: 'numeric' }));
      hr.appendChild(el('th', { textContent: '', style: { width: '80px' } }));
      thead.appendChild(hr);
      table.appendChild(thead);

      const tbody = el('tbody');
      shown.forEach(function (s) {
        const tr = el('tr');

        const nameTd = el('td');
        nameTd.appendChild(el('div', {
          style: { fontWeight: '600', color: '#0f2a44' },
          textContent: s.displayName || 'Student'
        }));
        if (s.email) {
          nameTd.appendChild(el('div', {
            className: 'muted', style: { fontSize: '.8rem', marginTop: '2px' },
            textContent: s.email
          }));
        }
        tr.appendChild(nameTd);

        tr.appendChild(el('td', { className: 'muted', textContent: s.className || '\u2014' }));
        tr.appendChild(el('td', {
          className: 'numeric',
          textContent: num(s.totalPoints).toLocaleString(),
          style: { fontWeight: '600', color: '#178a48' }
        }));
        tr.appendChild(el('td', {
          className: 'numeric',
          textContent: String(num(s.challengesCompleted))
        }));

        const actTd = el('td', { style: { textAlign: 'right' } });
        actTd.appendChild(el('button', {
          type: 'button', className: 'btn btn-outline btn-sm', textContent: 'View',
          onClick: function () { openStudentDetail(s); }
        }));
        tr.appendChild(actTd);

        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
      container.appendChild(wrap);

      if (rows.length > MAX) {
        container.appendChild(el('p', {
          className: 'muted',
          style: { fontSize: '.82rem', marginTop: '8px', textAlign: 'center' },
          textContent: 'Showing first ' + MAX + ' of ' + rows.length + ' students. Use the filters to narrow the list.'
        }));
      }
    }

    async function openStudentDetail(student) {
      const body = el('div');
      body.appendChild(loadingBox('Loading report\u2026'));

      if (ui() && ui().showModal) {
        ui().showModal({
          title: (student.displayName || 'Student') + (student.className ? ' \u00b7 ' + student.className : ''),
          body: body,
          wide: true,
          footer: [{ label: 'Close', variant: 'primary', onClick: function () { ui().closeModal(); } }]
        });
      }

      try {
        const report = await api().teacher.getStudentReport(student.studentId);
        if (!state.mounted) return;
        body.innerHTML = '';
        body.appendChild(buildStudentReport(report));
      } catch (err) {
        if (!state.mounted) return;
        if (api().isAuthError && api().isAuthError(err)) return;
        body.innerHTML = '';
        body.appendChild(errorBox('Could not load report', safeMsg(err)));
      }
    }

    function buildStudentReport(r) {
      const wrap = el('div');

      const sum = el('div', {
        className: 'stat-grid',
        style: { gridTemplateColumns: 'repeat(2, minmax(0,1fr))', marginBottom: '16px' }
      });
      sum.appendChild(statCard({ label: 'Total Points', value: num(r.totalPoints), accent: true }));
      sum.appendChild(statCard({
        label: 'Challenges Completed', value: String((r.challenges || []).length)
      }));
      wrap.appendChild(sum);

      wrap.appendChild(el('div', { className: 'section-title', textContent: 'Completed challenges' }));
      if (!(r.challenges || []).length) {
        wrap.appendChild(el('p', { className: 'muted', textContent: 'No challenges completed yet.' }));
      } else {
        const list = el('ul', { className: 'activity-list' });
        r.challenges.forEach(function (c) {
          const li = el('li');
          const left = el('div');
          left.appendChild(el('div', { textContent: c.challengeName || 'Challenge' }));
          left.appendChild(el('div', { className: 'act-meta', textContent: fmtDateTime(c.time) }));
          li.appendChild(left);
          li.appendChild(el('span', {
            className: 'badge badge-green', textContent: '+' + num(c.points) + ' pts'
          }));
          list.appendChild(li);
        });
        wrap.appendChild(list);
      }

      wrap.appendChild(el('div', {
        className: 'section-title', style: { marginTop: '20px' }, textContent: 'Quiz submissions'
      }));
      if (!(r.submissions || []).length) {
        wrap.appendChild(el('p', { className: 'muted', textContent: 'No quiz submissions yet.' }));
      } else {
        const wrapT = el('div', { className: 'table-wrap' });
        const t = el('table');
        const th = el('thead');
        const hrow = el('tr');
        hrow.appendChild(el('th', { textContent: 'Score' }));
        hrow.appendChild(el('th', { textContent: 'Result' }));
        hrow.appendChild(el('th', { textContent: 'When' }));
        th.appendChild(hrow);
        t.appendChild(th);
        const tb = el('tbody');
        r.submissions.forEach(function (s) {
          const tr = el('tr');
          tr.appendChild(el('td', { textContent: num(s.score) + ' / ' + num(s.maxScore) }));
          const resTd = el('td');
          resTd.appendChild(el('span', {
            className: 'badge ' + (s.passed ? 'badge-green' : 'badge-red'),
            textContent: s.passed ? 'Passed' : 'Failed'
          }));
          tr.appendChild(resTd);
          tr.appendChild(el('td', { className: 'muted', textContent: fmtDateTime(s.submittedAt) }));
          tb.appendChild(tr);
        });
        t.appendChild(tb);
        wrapT.appendChild(t);
        wrap.appendChild(wrapT);
      }

      return wrap;
    }

    paint();
    loadAll();
    ctx.onCleanup(function () { state.mounted = false; });
  }

  /* =========================================================
     VIEW: teacher.reports
     ========================================================= */

  async function renderTeacherReports(container, ctx) {
    const state = {
      hunts: [],
      classes: [],
      filterClassId: '',
      filterHuntId: '',
      filterStatus: 'all',        // 'all' | 'passed' | 'failed' | 'pending'
      report: null,
      submissions: [],            // from teacher.getSubmissions
      isLoadingRefs: true,
      isLoadingReport: false,
      loadError: '',
      reportError: '',
      mounted: true
    };

    async function loadRefs() {
      state.isLoadingRefs = true;
      paint();
      try {
        const results = await Promise.all([
          api().teacher.getHunts(),
          api().teacher.getClasses()
        ]);
        if (!state.mounted) return;
        state.hunts   = Array.isArray(results[0]) ? results[0] : [];
        state.classes = Array.isArray(results[1]) ? results[1] : [];
        state.isLoadingRefs = false;
        paint();
        loadReport();
      } catch (err) {
        if (!state.mounted) return;
        if (api().isAuthError && api().isAuthError(err)) return;
        state.isLoadingRefs = false;
        state.loadError = safeMsg(err);
        paint();
      }
    }

    async function loadReport() {
      state.isLoadingReport = true;
      state.reportError = '';
      paint();
      try {
        // Fire both calls in parallel: reports + submissions.
        const results = await Promise.all([
          api().teacher.getReports({
            classId: state.filterClassId,
            huntId: state.filterHuntId
          }),
          api().teacher.getSubmissions({
            classId: state.filterClassId,
            huntId:  state.filterHuntId,
            status:  state.filterStatus,
            limit:   200
          })
        ]);
        if (!state.mounted) return;
        state.report = results[0] || null;
        state.submissions = (results[1] && Array.isArray(results[1].rows)) ? results[1].rows : [];
        state.isLoadingReport = false;
        paint();
      } catch (err) {
        if (!state.mounted) return;
        if (api().isAuthError && api().isAuthError(err)) return;
        state.isLoadingReport = false;
        state.reportError = safeMsg(err);
        paint();
      }
    }

    function paint() {
      container.innerHTML = '';

      container.appendChild(el('h2', { textContent: 'Reports', style: { marginBottom: '4px' } }));
      container.appendChild(el('p', {
        className: 'muted', style: { marginBottom: '16px' },
        textContent: 'Aggregate performance across your classes. Export to CSV for further analysis.'
      }));

      if (state.isLoadingRefs) { container.appendChild(loadingBox('Loading filters\u2026')); return; }
      if (state.loadError) {
        container.appendChild(errorBox('Could not load reports', state.loadError, loadRefs));
        return;
      }

      const filterRow = el('div', { className: 'leaderboard-filter' });

      const classSel = el('select', { 'aria-label': 'Filter by class' });
      classSel.appendChild(el('option', { value: '', textContent: 'All my classes' }));
      state.classes.forEach(function (c) {
        const o = el('option', { value: String(c.classId), textContent: c.className || 'Class' });
        if (String(c.classId) === String(state.filterClassId)) o.selected = true;
        classSel.appendChild(o);
      });
      classSel.addEventListener('change', function () {
        state.filterClassId = String(classSel.value || '');
        loadReport();
      });
      filterRow.appendChild(classSel);

      const huntSel = el('select', { 'aria-label': 'Filter by hunt' });
      huntSel.appendChild(el('option', { value: '', textContent: 'All hunts' }));
      state.hunts.forEach(function (h) {
        const o = el('option', { value: String(h.huntId), textContent: h.name || 'Hunt' });
        if (String(h.huntId) === String(state.filterHuntId)) o.selected = true;
        huntSel.appendChild(o);
      });
      huntSel.addEventListener('change', function () {
        state.filterHuntId = String(huntSel.value || '');
        loadReport();
      });
      filterRow.appendChild(huntSel);

      const statusSel = el('select', { 'aria-label': 'Filter by submission status' });
      [
        ['all',     'All submissions'],
        ['passed',  'Passed only'],
        ['failed',  'Failed only'],
        ['pending', 'Pending only']
      ].forEach(function (opt) {
        const o = el('option', { value: opt[0], textContent: opt[1] });
        if (opt[0] === state.filterStatus) o.selected = true;
        statusSel.appendChild(o);
      });
      statusSel.addEventListener('change', function () {
        state.filterStatus = String(statusSel.value || 'all');
        loadReport();
      });
      filterRow.appendChild(statusSel);

      const refreshBtn = el('button', {
        type: 'button', className: 'btn btn-outline btn-sm', textContent: 'Refresh',
        disabled: state.isLoadingReport,
        onClick: loadReport
      });
      filterRow.appendChild(refreshBtn);

      if (state.report && !state.isLoadingReport) {
        filterRow.appendChild(el('button', {
          type: 'button', className: 'btn btn-outline btn-sm', textContent: 'Download scores CSV',
          onClick: downloadStudentsCsv
        }));
        filterRow.appendChild(el('button', {
          type: 'button', className: 'btn btn-outline btn-sm', textContent: 'Download stats CSV',
          onClick: downloadStatsCsv
        }));
      }

      container.appendChild(filterRow);

      if (state.isLoadingReport) { container.appendChild(loadingBox('Loading report\u2026')); return; }
      if (state.reportError) {
        container.appendChild(errorBox('Could not load report', state.reportError, loadReport));
        return;
      }
      if (!state.report) return;

      const r = state.report;

      // ---- Summary ----
      const sum = el('div', { className: 'stat-grid' });
      sum.appendChild(statCard({
        label: 'Participating Students',
        value: String(num(r.summary.participatingStudents)),
        sub: 'of ' + num(r.summary.totalStudents) + ' total'
      }));
      sum.appendChild(statCard({
        label: 'Total Points',
        value: num(r.summary.totalPoints).toLocaleString(),
        accent: true
      }));
      sum.appendChild(statCard({
        label: 'Average Points',
        value: String(num(r.summary.averagePoints)),
        sub: 'per student'
      }));
      sum.appendChild(statCard({
        label: 'Challenges',
        value: String((r.challengeStats || []).length)
      }));
      container.appendChild(sum);

      // ---- Students table ----
      container.appendChild(el('div', {
        className: 'section-title', style: { marginTop: '20px' }, textContent: 'Student scores'
      }));

      if (!(r.students || []).length) {
        container.appendChild(el('p', { className: 'muted', textContent: 'No students match the current filters.' }));
      } else {
        const wrap = el('div', { className: 'table-wrap' });
        const t = el('table');
        const th = el('thead');
        const hrow = el('tr');
        hrow.appendChild(el('th', { textContent: 'Student' }));
        hrow.appendChild(el('th', { textContent: 'Class' }));
        hrow.appendChild(el('th', { textContent: 'Points', className: 'numeric' }));
        hrow.appendChild(el('th', { textContent: 'Completed', className: 'numeric' }));
        th.appendChild(hrow);
        t.appendChild(th);
        const tb = el('tbody');
        r.students.slice().sort(function (a, b) {
          return num(b.totalPoints) - num(a.totalPoints);
        }).forEach(function (s) {
          const tr = el('tr');
          tr.appendChild(el('td', { textContent: s.displayName || 'Student', style: { fontWeight: '600' } }));
          tr.appendChild(el('td', { className: 'muted', textContent: s.className || '\u2014' }));
          tr.appendChild(el('td', {
            className: 'numeric',
            textContent: num(s.totalPoints).toLocaleString(),
            style: { color: '#178a48', fontWeight: '600' }
          }));
          tr.appendChild(el('td', {
            className: 'numeric', textContent: String(num(s.challengesCompleted))
          }));
          tb.appendChild(tr);
        });
        t.appendChild(tb);
        wrap.appendChild(t);
        container.appendChild(wrap);
      }

      // ---- Challenge stats table ----
      container.appendChild(el('div', {
        className: 'section-title', style: { marginTop: '20px' }, textContent: 'Challenge completion rates'
      }));

      if (!(r.challengeStats || []).length) {
        container.appendChild(el('p', { className: 'muted', textContent: 'No challenges match the current filters.' }));
      } else {
        const wrap = el('div', { className: 'table-wrap' });
        const t = el('table');
        const th = el('thead');
        const hrow = el('tr');
        hrow.appendChild(el('th', { textContent: 'Challenge' }));
        hrow.appendChild(el('th', { textContent: 'Hunt' }));
        hrow.appendChild(el('th', { textContent: 'Completed by', className: 'numeric' }));
        hrow.appendChild(el('th', { textContent: 'Rate', className: 'numeric' }));
        th.appendChild(hrow);
        t.appendChild(th);
        const tb = el('tbody');
        r.challengeStats.forEach(function (c) {
          const tr = el('tr');
          tr.appendChild(el('td', { textContent: c.name || 'Challenge', style: { fontWeight: '600' } }));
          tr.appendChild(el('td', { className: 'muted', textContent: c.huntName || '\u2014' }));
          tr.appendChild(el('td', {
            className: 'numeric',
            textContent: num(c.completedBy) + ' / ' + num(c.totalStudents)
          }));
          const rate = num(c.completionRate);
          const rateTd = el('td', { className: 'numeric' });
          rateTd.appendChild(el('span', {
            className: 'badge ' +
              (rate >= 75 ? 'badge-green' : rate >= 40 ? 'badge-gold' : 'badge-grey'),
            textContent: rate + '%'
          }));
          tr.appendChild(rateTd);
          tb.appendChild(tr);
        });
        t.appendChild(tb);
        wrap.appendChild(t);
        container.appendChild(wrap);
      }

      // ---- Recent submissions ----
      container.appendChild(el('div', {
        className: 'section-title', style: { marginTop: '20px' }, textContent: 'Recent submissions'
      }));

      if (!state.submissions.length) {
        const emptyNote = state.filterStatus === 'all'
          ? 'No submissions match the current filters.'
          : 'No ' + state.filterStatus + ' submissions match the current filters.';
        container.appendChild(el('p', { className: 'muted', textContent: emptyNote }));
      } else {
        const swrap = el('div', { className: 'table-wrap' });
        const st = el('table');
        const sth = el('thead');
        const shrow = el('tr');
        shrow.appendChild(el('th', { textContent: 'Student' }));
        shrow.appendChild(el('th', { textContent: 'Challenge' }));
        shrow.appendChild(el('th', { textContent: 'Score', className: 'numeric' }));
        shrow.appendChild(el('th', { textContent: 'Result' }));
        shrow.appendChild(el('th', { textContent: 'When' }));
        sth.appendChild(shrow);
        st.appendChild(sth);
        const stb = el('tbody');
        state.submissions.forEach(function (s) {
          const tr = el('tr');

          const sName = el('td');
          sName.appendChild(el('div', {
            style: { fontWeight: '600', color: '#0f2a44' },
            textContent: s.studentName || 'Student'
          }));
          if (s.className) {
            sName.appendChild(el('div', {
              className: 'muted', style: { fontSize: '.78rem', marginTop: '2px' },
              textContent: s.className
            }));
          }
          tr.appendChild(sName);

          const chName = el('td');
          chName.appendChild(el('div', { textContent: s.challengeName || 'Challenge' }));
          if (s.huntName) {
            chName.appendChild(el('div', {
              className: 'muted', style: { fontSize: '.78rem', marginTop: '2px' },
              textContent: s.huntName
            }));
          }
          tr.appendChild(chName);

          tr.appendChild(el('td', {
            className: 'numeric',
            textContent: num(s.score) + ' / ' + num(s.maxScore) +
              (s.percent != null ? ' (' + num(s.percent) + '%)' : '')
          }));

          const resultTd = el('td');
          const gr = String(s.gradingStatus || '').toLowerCase();
          if (gr && gr !== 'graded') {
            resultTd.appendChild(el('span', { className: 'badge badge-gold', textContent: 'Pending' }));
          } else {
            resultTd.appendChild(el('span', {
              className: 'badge ' + (s.passed ? 'badge-green' : 'badge-red'),
              textContent: s.passed ? 'Passed' : 'Failed'
            }));
          }
          tr.appendChild(resultTd);

          tr.appendChild(el('td', {
            className: 'muted',
            style: { fontSize: '.82rem' },
            textContent: fmtDateTime(s.submittedAt)
          }));

          stb.appendChild(tr);
        });
        st.appendChild(stb);
        swrap.appendChild(st);
        container.appendChild(swrap);

        if (state.submissions.length >= 200) {
          container.appendChild(el('p', {
            className: 'muted',
            style: { fontSize: '.78rem', marginTop: '6px', textAlign: 'center' },
            textContent: 'Showing the 200 most recent submissions. Narrow the filters to see older ones.'
          }));
        }
      }

      // ---- Footnote ----
      container.appendChild(el('p', {
        className: 'muted',
        style: { fontSize: '.82rem', marginTop: '16px' },
        textContent: 'Full answer sheets and per-question records live in the Google Spreadsheet ' +
          '(QuizResults and ScoreTransactions sheets).'
      }));
    }

    function downloadStudentsCsv() {
      const r = state.report;
      if (!r) return;
      const headers = ['Student', 'Class', 'Total Points', 'Challenges Completed'];
      const rows = (r.students || []).map(function (s) {
        return [s.displayName || '', s.className || '', num(s.totalPoints), num(s.challengesCompleted)];
      });
      const fname = 'student-scores-' + isoDateOnly(new Date().toISOString()) + '.csv';
      if (downloadCsv(fname, headers, rows)) toast('Scores CSV downloaded.', 'success');
      else toast('Could not download CSV.', 'error');
    }

    function downloadStatsCsv() {
      const r = state.report;
      if (!r) return;
      const headers = ['Challenge', 'Hunt', 'Completed By', 'Total Students', 'Completion Rate (%)'];
      const rows = (r.challengeStats || []).map(function (c) {
        return [c.name || '', c.huntName || '', num(c.completedBy), num(c.totalStudents), num(c.completionRate)];
      });
      const fname = 'challenge-stats-' + isoDateOnly(new Date().toISOString()) + '.csv';
      if (downloadCsv(fname, headers, rows)) toast('Stats CSV downloaded.', 'success');
      else toast('Could not download CSV.', 'error');
    }

    paint();
    loadRefs();
    ctx.onCleanup(function () { state.mounted = false; });
  }

  /* =========================================================
     VIEW: teacher.integrations
     ========================================================= */

  function renderTeacherIntegrations(container, ctx) {
    container.innerHTML = '';

    container.appendChild(el('h2', { textContent: 'Google Integrations', style: { marginBottom: '4px' } }));
    container.appendChild(el('p', {
      className: 'muted', style: { marginBottom: '16px' },
      textContent: 'How the app connects to Google Sheets, Apps Script, and Google Forms.'
    }));

    const grid = el('div', { className: 'grid grid-2' });

    // ---- Backend ----
    const backendCard = el('div', { className: 'card' });
    const bh = el('div', { className: 'card-header' });
    bh.appendChild(el('h3', { textContent: 'Apps Script backend' }));
    backendCard.appendChild(bh);
    const bb = el('div', { className: 'card-body' });
    bb.appendChild(el('p', {
      className: 'muted', style: { fontSize: '.9rem' },
      textContent: 'All requests are proxied through the Google Apps Script Web App configured in js/config.js.'
    }));

    const urlBox = el('div', {
      className: 'mono',
      style: {
        background: '#f4f6f9', padding: '8px 12px', borderRadius: '6px',
        fontSize: '.78rem', color: '#475569', wordBreak: 'break-all', marginBottom: '10px'
      }
    });
    urlBox.textContent = cfg.BACKEND_URL || '(not configured)';
    bb.appendChild(urlBox);

    const testBtn = el('button', {
      type: 'button', className: 'btn btn-primary btn-sm', textContent: 'Test connection'
    });
    const resultEl = el('div', { style: { marginTop: '10px', fontSize: '.88rem' } });
    testBtn.addEventListener('click', async function () {
      testBtn.disabled = true;
      resultEl.innerHTML = '<span class="spinner-sm"></span>Testing\u2026';
      resultEl.style.color = '#475569';
      try {
        const data = await api().me();
        resultEl.textContent = '\u2713 Connected as ' + ((data && data.user && data.user.displayName) || 'you') + '.';
        resultEl.style.color = '#178a48';
      } catch (err) {
        if (api().isAuthError && api().isAuthError(err)) return;
        resultEl.textContent = '\u2717 ' + safeMsg(err);
        resultEl.style.color = '#d64545';
      } finally {
        testBtn.disabled = false;
      }
    });
    bb.appendChild(testBtn);
    bb.appendChild(resultEl);
    backendCard.appendChild(bb);
    grid.appendChild(backendCard);

    // ---- Google Sheets ----
    const sheetsCard = el('div', { className: 'card' });
    const sh = el('div', { className: 'card-header' });
    sh.appendChild(el('h3', { textContent: 'Google Sheets' }));
    sheetsCard.appendChild(sh);
    const sb = el('div', { className: 'card-body' });
    sb.appendChild(el('p', {
      className: 'muted', style: { fontSize: '.9rem' },
      textContent: 'Student scores, quiz results, and audit logs live in the school\u2019s shared spreadsheet. ' +
        'Teachers with access can open it in Google Sheets to see raw rows.'
    }));
    sb.appendChild(el('p', {
      className: 'muted', style: { fontSize: '.82rem', marginTop: '8px' },
      textContent: 'The spreadsheet ID is configured in Google Apps Script \u2192 Project Settings \u2192 Script Properties. ' +
        'Ask your administrator if you need access.'
    }));
    sb.appendChild(el('p', {
      className: 'muted', style: { fontSize: '.82rem' },
      innerHTML: 'See <strong>SETUP.md</strong> for the full deployment guide and the sheet layout.'
    }));
    sheetsCard.appendChild(sb);
    grid.appendChild(sheetsCard);

    // ---- Google Forms ----
    const formsCard = el('div', { className: 'card' });
    const fh = el('div', { className: 'card-header' });
    fh.appendChild(el('h3', { textContent: 'Google Forms (optional)' }));
    formsCard.appendChild(fh);
    const fb = el('div', { className: 'card-body' });
    fb.appendChild(el('p', {
      className: 'muted', style: { fontSize: '.9rem' },
      textContent: 'Challenges may link an external Google Form for activities the built-in quiz can\u2019t express.'
    }));
    const ul = el('ul', { style: { fontSize: '.88rem', color: '#475569', paddingLeft: '20px', marginTop: '8px' } });
    ul.appendChild(el('li', { textContent: 'The form opens in a new tab. Points are NOT awarded automatically.' }));
    ul.appendChild(el('li', { textContent: 'Teachers review responses in the response spreadsheet and award points through the challenge editor.' }));
    ul.appendChild(el('li', { textContent: 'Built-in quizzes remain the recommended path for immediate scoring.' }));
    fb.appendChild(ul);
    formsCard.appendChild(fb);
    grid.appendChild(formsCard);

    container.appendChild(grid);

    container.appendChild(el('p', {
      className: 'muted',
      style: { fontSize: '.82rem', marginTop: '20px' },
      textContent: 'These settings are managed by your school administrator. This page is read-only.'
    }));
  }

  /* =========================================================
     VIEW: teacher.settings
     ========================================================= */

  async function renderTeacherSettings(container, ctx) {
    const user = (ctx && ctx.user) || (window.APP.auth && window.APP.auth.getUser()) || {};
    container.innerHTML = '';

    container.appendChild(el('h2', { textContent: 'Settings', style: { marginBottom: '4px' } }));
    container.appendChild(el('p', {
      className: 'muted', style: { marginBottom: '16px' },
      textContent: 'Manage your account and app preferences.'
    }));

    // ---- Profile ----
    const profileCard = el('div', { className: 'card', style: { marginBottom: '16px' } });
    const ph = el('div', { className: 'card-header' });
    ph.appendChild(el('h3', { textContent: 'Profile' }));
    profileCard.appendChild(ph);

    const pb = el('div', { className: 'card-body' });
    const form = el('form', { className: 'form' });

    const nameLabel = el('label');
    nameLabel.appendChild(el('span', { textContent: 'Display name' }));
    const nameInput = el('input', {
      type: 'text', value: user.displayName || '', maxlength: '60', required: 'required'
    });
    nameLabel.appendChild(nameInput);
    form.appendChild(nameLabel);

    const emailLabel = el('label');
    emailLabel.appendChild(el('span', { textContent: 'Email (read-only)' }));
    const emailInput = el('input', {
      type: 'email', value: user.email || '', disabled: 'disabled'
    });
    emailLabel.appendChild(emailInput);
    emailLabel.appendChild(el('div', {
      className: 'muted',
      style: { fontSize: '.78rem', marginTop: '4px' },
      textContent: 'Contact an administrator to change your email or password.'
    }));
    form.appendChild(emailLabel);

    const actions = el('div', { className: 'form-actions' });
    const saveBtn = el('button', {
      type: 'submit', className: 'btn btn-primary', textContent: 'Save changes'
    });
    actions.appendChild(saveBtn);
    form.appendChild(actions);

    const errEl = el('div', { className: 'error-text hidden' });
    form.appendChild(errEl);

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      errEl.classList.add('hidden');
      const newName = String(nameInput.value || '').trim();
      if (!newName || newName.length > 60) {
        errEl.textContent = 'Display name must be 1\u201360 characters.';
        errEl.classList.remove('hidden');
        return;
      }
      if (newName === user.displayName) {
        toast('No changes to save.', 'warn');
        return;
      }
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="spinner-sm"></span>Saving\u2026';
      try {
        await api().updateMyProfile(newName);
        const current = window.APP.auth.getUser() || {};
        window.APP.auth.updateUser(Object.assign({}, current, { displayName: newName }));
        toast('Display name updated.', 'success');
        if (window.APP.app && window.APP.app.refresh) window.APP.app.refresh();
      } catch (err) {
        if (api().isAuthError && api().isAuthError(err)) return;
        errEl.textContent = safeMsg(err);
        errEl.classList.remove('hidden');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save changes';
      }
    });

    pb.appendChild(form);
    profileCard.appendChild(pb);
    container.appendChild(profileCard);

    // ---- App info ----
    const infoCard = el('div', { className: 'card', style: { marginBottom: '16px' } });
    const ih = el('div', { className: 'card-header' });
    ih.appendChild(el('h3', { textContent: 'App information' }));
    infoCard.appendChild(ih);
    const ib = el('div', { className: 'card-body' });
    const infoTable = el('table');
    const infoTb = el('tbody');
    [
      ['Application', cfg.APP_NAME || 'Treasure Hunt'],
      ['Version', cfg.APP_VERSION || '1.0.0'],
      ['School', cfg.SCHOOL_NAME || ''],
      ['Event', cfg.EVENT_NAME || ''],
      ['Role', user.role || '']
    ].forEach(function (row) {
      const tr = el('tr');
      tr.appendChild(el('td', { textContent: row[0], style: { fontWeight: '600', width: '40%', padding: '6px 0' } }));
      tr.appendChild(el('td', { textContent: row[1] || '\u2014', className: 'muted', style: { padding: '6px 0' } }));
      infoTb.appendChild(tr);
    });
    infoTable.appendChild(infoTb);
    ib.appendChild(infoTable);
    infoCard.appendChild(ib);
    container.appendChild(infoCard);

    // ---- Sign out ----
    const signOutCard = el('div', { className: 'card' });
    const soh = el('div', { className: 'card-header' });
    soh.appendChild(el('h3', { textContent: 'Session' }));
    signOutCard.appendChild(soh);
    const sob = el('div', { className: 'card-body' });
    sob.appendChild(el('p', {
      className: 'muted',
      style: { fontSize: '.88rem' },
      textContent: 'Signing out clears your session on this device.'
    }));
    sob.appendChild(el('button', {
      type: 'button', className: 'btn btn-danger', textContent: 'Sign out',
      onClick: async function () {
        const ok = await confirmDialog('Sign out of Treasure Hunt?', {
          title: 'Sign out?', confirmLabel: 'Sign out', danger: true
        });
        if (!ok) return;
        window.APP.auth.logout();
      }
    }));
    signOutCard.appendChild(sob);
    container.appendChild(signOutCard);
  }

  /* =========================================================
     REGISTER (Part 2)
     ========================================================= */

  window.APP.views.renderTeacherQuizManager  = renderTeacherQuizManager;
  window.APP.views.renderTeacherStudents     = renderTeacherStudents;
  window.APP.views.renderTeacherReports      = renderTeacherReports;
  window.APP.views.renderTeacherIntegrations = renderTeacherIntegrations;
  window.APP.views.renderTeacherSettings     = renderTeacherSettings;

})();
