/* =========================================================
   TREASURE HUNT APP — admin.js (PART 1 OF 2)
   ---------------------------------------------------------
   Views registered in this part:
     admin.dashboard → renderAdminDashboard
     admin.users     → renderAdminUsers
     admin.classes   → renderAdminClasses

   Part 2 (second IIFE, appended to this same file) registers:
     admin.hunts        → renderAdminHunts
     admin.reports      → renderAdminReports
     admin.integrations → renderAdminIntegrations
     admin.audit        → renderAdminAudit
     admin.settings     → renderAdminSettings

   Admin role passes all teacher_() guards in backend/Code.gs
   (see teacher_() helper: `session.role !== role && session.role !== 'admin'`),
   so this file reuses teacher.* endpoints for read-only
   views (hunts, reports, submissions) and admin.* endpoints
   for anything that mutates teacher/student/class data.

   Backend contract:
     admin.getStats()          → { students, teachers, classes,
                                    hunts, totalPointsAwarded,
                                    totalSubmissions }
     admin.getUsers()          → { students:[{ id, displayName,
                                    email, classId, className,
                                    status }],
                                  teachers:[{ id, displayName, email,
                                    role, classIds[], status }] }
     admin.createTeacher(p)    → { teacherId }
     admin.createStudent(p)    → { studentId }
     admin.updateUserStatus(p) → { ok }   p={userId, type, status}
     admin.updateUserClass(p)  → { ok }   p={studentId, classId}
     admin.resetPassword(p)    → { ok }   p={userId, type, password}
     admin.getClasses()        → [{ classId, className, teacherIds[] }]
     admin.createClass(p)      → { classId }  p={className, teacherIds[]}
     admin.assignTeacherToClass(p) → { ok }
                                    p={classId, teacherId, add}
     teacher.getOverview()     → { stats:{ students, hunts,
                                    challenges, totalPointsAwarded,
                                    submissions } }
     teacher.getClasses()      → [{ classId, className, teacherIds[] }]
     teacher.getStudents()     → [{ studentId, displayName, email,
                                    classId, className, totalPoints,
                                    challengesCompleted }]
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

  function fieldRow(labelText, inputNode) {
    const l = el('label');
    l.appendChild(el('span', { textContent: labelText }));
    l.appendChild(inputNode);
    return l;
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

  function statusPill(status) {
    const s = String(status || '').toLowerCase();
    if (s === 'active')   return el('span', { className: 'badge badge-green', textContent: 'Active' });
    if (s === 'disabled') return el('span', { className: 'badge badge-red',   textContent: 'Disabled' });
    return el('span', { className: 'badge badge-grey', textContent: s || '\u2014' });
  }

  /* =========================================================
     VIEW: admin.dashboard
     ========================================================= */

  async function renderAdminDashboard(container, ctx) {
    container.innerHTML = '';
    container.appendChild(loadingBox('Loading dashboard\u2026'));

    let stats, overview;
    try {
      const results = await Promise.all([
        api().admin.getStats(),
        api().teacher.getOverview()
      ]);
      stats    = results[0] || {};
      overview = (results[1] && results[1].stats) || {};
    } catch (err) {
      if (api().isAuthError && api().isAuthError(err)) return;
      container.innerHTML = '';
      container.appendChild(errorBox(
        'Could not load dashboard',
        safeMsg(err),
        function () { renderAdminDashboard(container, ctx); }
      ));
      return;
    }

    container.innerHTML = '';

    container.appendChild(el('h2', {
      textContent: 'Administrator Dashboard',
      style: { marginBottom: '4px' }
    }));
    const userName = (ctx.user && ctx.user.displayName) || 'Administrator';
    container.appendChild(el('p', {
      className: 'muted',
      textContent: 'Welcome back, ' + userName + '.',
      style: { marginBottom: '20px' }
    }));

    /* ---- Stats grid ---- */
    const grid = el('div', { className: 'stat-grid' });
    grid.appendChild(statCard({ label: 'Active Students',  value: num(stats.students) }));
    grid.appendChild(statCard({ label: 'Active Teachers',  value: num(stats.teachers) }));
    grid.appendChild(statCard({ label: 'Classes',          value: num(stats.classes) }));
    grid.appendChild(statCard({ label: 'Active Hunts',     value: num(stats.hunts) }));
    container.appendChild(grid);

    const grid2 = el('div', { className: 'stat-grid', style: { marginTop: '14px' } });
    grid2.appendChild(statCard({
      label: 'Total Points Awarded',
      value: num(stats.totalPointsAwarded).toLocaleString(),
      accent: true
    }));
    grid2.appendChild(statCard({
      label: 'Quiz Submissions',
      value: num(stats.totalSubmissions).toLocaleString()
    }));
    grid2.appendChild(statCard({
      label: 'Challenges',
      value: String(num(overview.challenges))
    }));
    grid2.appendChild(statCard({
      label: 'Treasure Hunts',
      value: String(num(overview.hunts))
    }));
    container.appendChild(grid2);

    /* ---- Quick actions ---- */
    const qaSection = el('div', { style: { marginTop: '24px' } });
    qaSection.appendChild(el('div', { className: 'section-title', textContent: 'Administration' }));

    const qaGrid = el('div', { className: 'grid grid-3' });

    qaGrid.appendChild(quickAction(
      'Manage users',
      'Create teachers and students, reset passwords, assign classes.',
      'Open users',
      function () { ctx.navigate('admin.users'); }
    ));
    qaGrid.appendChild(quickAction(
      'Manage classes',
      'Create classes and assign teachers to them.',
      'Open classes',
      function () { ctx.navigate('admin.classes'); }
    ));
    qaGrid.appendChild(quickAction(
      'View audit log',
      'Every score award, edit, and login is recorded here.',
      'Open audit',
      function () { ctx.navigate('admin.audit'); }
    ));

    qaSection.appendChild(qaGrid);
    container.appendChild(qaSection);

    /* ---- System hint ---- */
    const hint = el('div', {
      className: 'card',
      style: { marginTop: '20px', background: '#eef1f5', borderStyle: 'dashed' }
    });
    const hintBody = el('div', { className: 'card-body', style: { fontSize: '.9rem', color: '#475569' } });
    hintBody.appendChild(el('strong', { textContent: 'Deployment note: ' }));
    hintBody.appendChild(document.createTextNode(
      'The Google Spreadsheet ID and Apps Script deployment URL are configured by whoever set up this app. See SETUP.md for details.'
    ));
    hint.appendChild(hintBody);
    container.appendChild(hint);
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

  /* =========================================================
     VIEW: admin.users
     ========================================================= */

  async function renderAdminUsers(container, ctx) {
    const state = {
      users: { students: [], teachers: [] },
      classes: [],
      tab: 'students',      // 'students' | 'teachers'
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
          api().admin.getUsers(),
          api().admin.getClasses()
        ]);
        if (!state.mounted) return;
        state.users = {
          students: (results[0] && Array.isArray(results[0].students)) ? results[0].students : [],
          teachers: (results[0] && Array.isArray(results[0].teachers)) ? results[0].teachers : []
        };
        state.classes = Array.isArray(results[1]) ? results[1] : [];
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
      let rows = state.users.students.slice();
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
      return rows;
    }

    function filteredTeachers() {
      let rows = state.users.teachers.slice();
      if (state.filterText) {
        const q = state.filterText.toLowerCase();
        rows = rows.filter(function (t) {
          return String(t.displayName || '').toLowerCase().indexOf(q) >= 0 ||
                 String(t.email || '').toLowerCase().indexOf(q) >= 0;
        });
      }
      return rows;
    }

    function classLabel(classId) {
      const c = state.classes.find(function (x) { return String(x.classId) === String(classId); });
      return c ? (c.className || 'Class') : '\u2014';
    }

    function classSummary(classIds) {
      const ids = Array.isArray(classIds) ? classIds : [];
      if (!ids.length) return '\u2014';
      if (ids.length <= 2) {
        return ids.map(function (id) { return classLabel(id); }).join(', ');
      }
      return ids.length + ' classes';
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
          w.appendChild(el('h2', { textContent: 'Users', style: { marginBottom: '4px' } }));
          w.appendChild(el('p', {
            className: 'muted',
            style: { margin: '0' },
            textContent: 'Manage teacher and student accounts. Passwords are hashed on the server.'
          }));
          return w;
        })(),
        (function () {
          const wrap = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } });
          wrap.appendChild(el('button', {
            type: 'button',
            className: 'btn btn-primary',
            textContent: state.tab === 'teachers' ? '+ New teacher' : '+ New student',
            onClick: function () {
              if (state.tab === 'teachers') openCreateTeacherModal();
              else openCreateStudentModal();
            }
          }));
          wrap.appendChild(el('button', {
            type: 'button',
            className: 'btn btn-outline btn-sm',
            textContent: 'Refresh',
            onClick: loadAll
          }));
          return wrap;
        })()
      ]));

      if (state.isLoading) { container.appendChild(loadingBox('Loading users\u2026')); return; }
      if (state.loadError) {
        container.appendChild(errorBox('Could not load users', state.loadError, loadAll));
        return;
      }

      // Tabs
      const tabs = el('div', { className: 'tabs' });
      [
        ['students', 'Students (' + state.users.students.length + ')'],
        ['teachers', 'Teachers (' + state.users.teachers.length + ')']
      ].forEach(function (t) {
        const b = el('button', {
          type: 'button',
          className: 'tab' + (state.tab === t[0] ? ' active' : ''),
          textContent: t[1]
        });
        b.addEventListener('click', function () {
          if (state.tab === t[0]) return;
          state.tab = t[0];
          state.filterClassId = '';
          state.filterText = '';
          paint();
        });
        tabs.appendChild(b);
      });
      container.appendChild(tabs);

      // Filters
      const filterRow = el('div', { className: 'leaderboard-filter' });

      if (state.tab === 'students') {
        const classSel = el('select', { 'aria-label': 'Filter by class' });
        classSel.appendChild(el('option', { value: '', textContent: 'All classes' }));
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
      }

      const searchInput = el('input', {
        type: 'text',
        placeholder: state.tab === 'teachers' ? 'Search by name or email' : 'Search by name or email',
        value: state.filterText
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

      container.appendChild(filterRow);

      // Body
      if (state.tab === 'students') paintStudentsTable();
      else paintTeachersTable();
    }

    function paintStudentsTable() {
      const rows = filteredStudents();
      if (!rows.length) {
        container.appendChild(emptyBox(
          'No students found',
          state.users.students.length
            ? 'Try clearing the filters above.'
            : 'Create your first student to get started.',
          'Create student',
          openCreateStudentModal
        ));
        return;
      }

      const wrap = el('div', { className: 'table-wrap' });
      const table = el('table');
      const thead = el('thead');
      const hr = el('tr');
      hr.appendChild(el('th', { textContent: 'Student' }));
      hr.appendChild(el('th', { textContent: 'Class' }));
      hr.appendChild(el('th', { textContent: 'Status' }));
      hr.appendChild(el('th', { textContent: 'Actions', style: { textAlign: 'right' } }));
      thead.appendChild(hr);
      table.appendChild(thead);

      const tbody = el('tbody');
      rows.forEach(function (s) {
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

        tr.appendChild(el('td', {
          className: 'muted', style: { fontSize: '.85rem' },
          textContent: classLabel(s.classId)
        }));

        const statusTd = el('td');
        statusTd.appendChild(statusPill(s.status));
        tr.appendChild(statusTd);

        const actionsTd = el('td', { style: { textAlign: 'right' } });
        const btnGroup = el('div', {
          style: { display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' }
        });

        btnGroup.appendChild(el('button', {
          type: 'button', className: 'btn btn-outline btn-sm', textContent: 'Change class',
          onClick: function () { openChangeClassModal(s); }
        }));
        btnGroup.appendChild(el('button', {
          type: 'button', className: 'btn btn-outline btn-sm', textContent: 'Reset password',
          onClick: function () { openResetPasswordModal(s, 'student'); }
        }));
        btnGroup.appendChild(el('button', {
          type: 'button',
          className: 'btn ' + (String(s.status).toLowerCase() === 'active' ? 'btn-danger' : 'btn-primary') + ' btn-sm',
          textContent: String(s.status).toLowerCase() === 'active' ? 'Disable' : 'Enable',
          onClick: function () { toggleUserStatus(s, 'student'); }
        }));

        actionsTd.appendChild(btnGroup);
        tr.appendChild(actionsTd);

        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
      container.appendChild(wrap);
    }

    function paintTeachersTable() {
      const rows = filteredTeachers();
      if (!rows.length) {
        container.appendChild(emptyBox(
          'No teachers found',
          state.users.teachers.length
            ? 'Try clearing the filters above.'
            : 'Create your first teacher to get started.',
          'Create teacher',
          openCreateTeacherModal
        ));
        return;
      }

      const wrap = el('div', { className: 'table-wrap' });
      const table = el('table');
      const thead = el('thead');
      const hr = el('tr');
      hr.appendChild(el('th', { textContent: 'Teacher' }));
      hr.appendChild(el('th', { textContent: 'Role' }));
      hr.appendChild(el('th', { textContent: 'Classes' }));
      hr.appendChild(el('th', { textContent: 'Status' }));
      hr.appendChild(el('th', { textContent: 'Actions', style: { textAlign: 'right' } }));
      thead.appendChild(hr);
      table.appendChild(thead);

      const tbody = el('tbody');
      rows.forEach(function (t) {
        const tr = el('tr');

        const nameTd = el('td');
        nameTd.appendChild(el('div', {
          style: { fontWeight: '600', color: '#0f2a44' },
          textContent: t.displayName || 'Teacher'
        }));
        if (t.email) {
          nameTd.appendChild(el('div', {
            className: 'muted', style: { fontSize: '.8rem', marginTop: '2px' },
            textContent: t.email
          }));
        }
        tr.appendChild(nameTd);

        tr.appendChild(el('td', {
          className: 'muted', style: { fontSize: '.85rem' },
          textContent: String(t.role || 'teacher')
        }));

        tr.appendChild(el('td', {
          className: 'muted', style: { fontSize: '.85rem' },
          textContent: classSummary(t.classIds)
        }));

        const statusTd = el('td');
        statusTd.appendChild(statusPill(t.status));
        tr.appendChild(statusTd);

        const actionsTd = el('td', { style: { textAlign: 'right' } });
        const btnGroup = el('div', {
          style: { display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' }
        });

        btnGroup.appendChild(el('button', {
          type: 'button', className: 'btn btn-outline btn-sm', textContent: 'Reset password',
          onClick: function () { openResetPasswordModal(t, 'teacher'); }
        }));
        btnGroup.appendChild(el('button', {
          type: 'button',
          className: 'btn ' + (String(t.status).toLowerCase() === 'active' ? 'btn-danger' : 'btn-primary') + ' btn-sm',
          textContent: String(t.status).toLowerCase() === 'active' ? 'Disable' : 'Enable',
          onClick: function () { toggleUserStatus(t, 'teacher'); }
        }));

        actionsTd.appendChild(btnGroup);
        tr.appendChild(actionsTd);

        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
      container.appendChild(wrap);
    }

    /* ---------- Create teacher ---------- */
    function openCreateTeacherModal() {
      const vals = {
        displayName: '',
        email: '',
        password: '',
        role: 'teacher',
        classIds: []
      };

      const form = el('form', { className: 'form' });

      const nameInput = el('input', { type: 'text', value: '', maxlength: '60', required: 'required' });
      form.appendChild(fieldRow('Display name *', nameInput));

      const emailInput = el('input', { type: 'email', value: '', required: 'required' });
      form.appendChild(fieldRow('Email *', emailInput));

      const pwdInput = el('input', { type: 'password', value: '', minlength: '6', required: 'required', autocomplete: 'new-password' });
      const pwdField = fieldRow('Initial password * (min 6 chars)', pwdInput);
      pwdField.appendChild(el('div', {
        className: 'muted',
        style: { fontSize: '.78rem', marginTop: '4px' },
        textContent: 'Share this with the teacher. They can sign in immediately and reset it later.'
      }));
      form.appendChild(pwdField);

      const roleField = el('label');
      roleField.appendChild(el('span', { textContent: 'Role' }));
      const roleSel = el('select');
      roleSel.appendChild(el('option', { value: 'teacher', textContent: 'Teacher' }));
      roleSel.appendChild(el('option', { value: 'admin', textContent: 'Administrator' }));
      roleSel.value = vals.role;
      roleSel.addEventListener('change', function () { vals.role = String(roleSel.value || 'teacher'); });
      roleField.appendChild(roleSel);
      form.appendChild(roleField);

      const classField = el('label');
      classField.appendChild(el('span', { textContent: 'Assign to classes' }));
      const classList = el('div', { className: 'checkbox-list' });
      if (!state.classes.length) {
        classList.appendChild(el('div', { className: 'muted', textContent: 'No classes yet — create one first.' }));
      } else {
        state.classes.forEach(function (c) {
          const row = el('label');
          const cb = el('input', { type: 'checkbox' });
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
      form.appendChild(classField);

      const errorEl = el('div', { className: 'error-text hidden' });
      form.appendChild(errorEl);

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        errorEl.classList.add('hidden');

        const displayName = nameInput.value.trim();
        const email = emailInput.value.trim().toLowerCase();
        const password = pwdInput.value;

        if (!displayName) { errorEl.textContent = 'Display name is required.'; errorEl.classList.remove('hidden'); return; }
        if (!email)       { errorEl.textContent = 'Email is required.'; errorEl.classList.remove('hidden'); return; }
        if (!password || password.length < 6) {
          errorEl.textContent = 'Password must be at least 6 characters.';
          errorEl.classList.remove('hidden');
          return;
        }

        api().admin.createTeacher({
          displayName: displayName,
          email: email,
          password: password,
          role: vals.role,
          classIds: vals.classIds.slice()
        }).then(function () {
          if (!state.mounted) return;
          if (ui() && ui().closeModal) ui().closeModal();
          toast('Teacher created.', 'success');
          loadAll();
        }).catch(function (err) {
          if (!state.mounted) return;
          if (api().isAuthError && api().isAuthError(err)) return;
          errorEl.textContent = safeMsg(err);
          errorEl.classList.remove('hidden');
        });
      });

      if (ui() && ui().showModal) {
        ui().showModal({
          title: 'Create teacher',
          body: form,
          wide: true,
          footer: [
            { label: 'Cancel', variant: 'outline', onClick: function () { ui().closeModal(); } },
            {
              label: 'Create teacher',
              variant: 'primary',
              onClick: function () {
                form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
              }
            }
          ]
        });
      }
    }

    /* ---------- Create student ---------- */
    function openCreateStudentModal() {
      const form = el('form', { className: 'form' });

      const nameInput = el('input', { type: 'text', maxlength: '60', required: 'required' });
      form.appendChild(fieldRow('Display name *', nameInput));

      const emailInput = el('input', { type: 'email', required: 'required' });
      form.appendChild(fieldRow('Email *', emailInput));

      const pwdInput = el('input', { type: 'password', minlength: '6', required: 'required', autocomplete: 'new-password' });
      form.appendChild(fieldRow('Initial password * (min 6 chars)', pwdInput));

      const classField = el('label');
      classField.appendChild(el('span', { textContent: 'Class' }));
      const classSel = el('select');
      classSel.appendChild(el('option', { value: '', textContent: 'No class' }));
      state.classes.forEach(function (c) {
        classSel.appendChild(el('option', { value: String(c.classId), textContent: c.className || 'Class' }));
      });
      classField.appendChild(classSel);
      form.appendChild(classField);

      const errorEl = el('div', { className: 'error-text hidden' });
      form.appendChild(errorEl);

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        errorEl.classList.add('hidden');

        const displayName = nameInput.value.trim();
        const email = emailInput.value.trim().toLowerCase();
        const password = pwdInput.value;

        if (!displayName) { errorEl.textContent = 'Display name is required.'; errorEl.classList.remove('hidden'); return; }
        if (!email)       { errorEl.textContent = 'Email is required.'; errorEl.classList.remove('hidden'); return; }
        if (!password || password.length < 6) {
          errorEl.textContent = 'Password must be at least 6 characters.';
          errorEl.classList.remove('hidden');
          return;
        }

        api().admin.createStudent({
          displayName: displayName,
          email: email,
          password: password,
          classId: String(classSel.value || '')
        }).then(function () {
          if (!state.mounted) return;
          if (ui() && ui().closeModal) ui().closeModal();
          toast('Student created.', 'success');
          loadAll();
        }).catch(function (err) {
          if (!state.mounted) return;
          if (api().isAuthError && api().isAuthError(err)) return;
          errorEl.textContent = safeMsg(err);
          errorEl.classList.remove('hidden');
        });
      });

      if (ui() && ui().showModal) {
        ui().showModal({
          title: 'Create student',
          body: form,
          wide: true,
          footer: [
            { label: 'Cancel', variant: 'outline', onClick: function () { ui().closeModal(); } },
            {
              label: 'Create student',
              variant: 'primary',
              onClick: function () {
                form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
              }
            }
          ]
        });
      }
    }

    /* ---------- Change class ---------- */
    function openChangeClassModal(student) {
      const form = el('form', { className: 'form' });

      const classField = el('label');
      classField.appendChild(el('span', { textContent: 'Class' }));
      const classSel = el('select');
      classSel.appendChild(el('option', { value: '', textContent: 'No class' }));
      state.classes.forEach(function (c) {
        const o = el('option', { value: String(c.classId), textContent: c.className || 'Class' });
        if (String(c.classId) === String(student.classId)) o.selected = true;
        classSel.appendChild(o);
      });
      classField.appendChild(classSel);
      form.appendChild(classField);

      const errorEl = el('div', { className: 'error-text hidden' });
      form.appendChild(errorEl);

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        api().admin.updateUserClass({
          studentId: student.id,
          classId: String(classSel.value || '')
        }).then(function () {
          if (!state.mounted) return;
          if (ui() && ui().closeModal) ui().closeModal();
          toast('Class updated.', 'success');
          loadAll();
        }).catch(function (err) {
          if (!state.mounted) return;
          if (api().isAuthError && api().isAuthError(err)) return;
          errorEl.textContent = safeMsg(err);
          errorEl.classList.remove('hidden');
        });
      });

      if (ui() && ui().showModal) {
        ui().showModal({
          title: 'Change class for ' + (student.displayName || 'student'),
          body: form,
          footer: [
            { label: 'Cancel', variant: 'outline', onClick: function () { ui().closeModal(); } },
            {
              label: 'Save',
              variant: 'primary',
              onClick: function () {
                form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
              }
            }
          ]
        });
      }
    }

    /* ---------- Reset password ---------- */
    function openResetPasswordModal(user, type) {
      const form = el('form', { className: 'form' });

      const pwdInput = el('input', { type: 'password', minlength: '6', required: 'required', autocomplete: 'new-password' });
      form.appendChild(fieldRow('New password * (min 6 chars)', pwdInput));

      const confirmInput = el('input', { type: 'password', minlength: '6', required: 'required', autocomplete: 'new-password' });
      form.appendChild(fieldRow('Confirm password *', confirmInput));

      const errorEl = el('div', { className: 'error-text hidden' });
      form.appendChild(errorEl);

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        errorEl.classList.add('hidden');

        const pwd = pwdInput.value;
        const confirm = confirmInput.value;

        if (!pwd || pwd.length < 6) {
          errorEl.textContent = 'Password must be at least 6 characters.';
          errorEl.classList.remove('hidden');
          return;
        }
        if (pwd !== confirm) {
          errorEl.textContent = 'Passwords do not match.';
          errorEl.classList.remove('hidden');
          return;
        }

        api().admin.resetPassword({
          userId: user.id,
          type: type,
          password: pwd
        }).then(function () {
          if (!state.mounted) return;
          if (ui() && ui().closeModal) ui().closeModal();
          toast('Password reset. Share the new password with ' + (user.displayName || 'the user') + '.', 'success', 5000);
        }).catch(function (err) {
          if (!state.mounted) return;
          if (api().isAuthError && api().isAuthError(err)) return;
          errorEl.textContent = safeMsg(err);
          errorEl.classList.remove('hidden');
        });
      });

      if (ui() && ui().showModal) {
        ui().showModal({
          title: 'Reset password for ' + (user.displayName || 'user'),
          body: form,
          footer: [
            { label: 'Cancel', variant: 'outline', onClick: function () { ui().closeModal(); } },
            {
              label: 'Reset password',
              variant: 'danger',
              onClick: function () {
                form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
              }
            }
          ]
        });
      }
    }

    /* ---------- Toggle status ---------- */
    async function toggleUserStatus(user, type) {
      const isActive = String(user.status).toLowerCase() === 'active';
      const newStatus = isActive ? 'disabled' : 'active';
      const ok = await confirmDialog(
        isActive
          ? 'Disable "' + (user.displayName || 'this user') + '"? They will not be able to sign in.'
          : 'Re-enable "' + (user.displayName || 'this user') + '"?',
        { title: isActive ? 'Disable user?' : 'Enable user?',
          confirmLabel: isActive ? 'Disable' : 'Enable',
          danger: isActive }
      );
      if (!ok) return;
      try {
        await api().admin.updateUserStatus({ userId: user.id, type: type, status: newStatus });
        if (!state.mounted) return;
        toast('User ' + (isActive ? 'disabled' : 'enabled') + '.', 'success');
        loadAll();
      } catch (err) {
        if (!state.mounted) return;
        if (api().isAuthError && api().isAuthError(err)) return;
        toast('Could not update: ' + safeMsg(err), 'error', 4000);
      }
    }

    /* ---------- Init ---------- */
    paint();
    loadAll();
    ctx.onCleanup(function () { state.mounted = false; });
  }

  /* =========================================================
     VIEW: admin.classes
     ========================================================= */

  async function renderAdminClasses(container, ctx) {
    const state = {
      classes: [],
      students: [],
      teachers: [],
      expandedClassId: '',
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
          api().teacher.getClasses(),
          api().teacher.getStudents(),
          api().admin.getUsers()
        ]);
        if (!state.mounted) return;
        state.classes  = Array.isArray(results[0]) ? results[0] : [];
        state.students = Array.isArray(results[1]) ? results[1] : [];
        state.teachers = (results[2] && Array.isArray(results[2].teachers)) ? results[2].teachers : [];
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

    function teacherName(teacherId) {
      const t = state.teachers.find(function (x) { return String(x.id) === String(teacherId); });
      return t ? (t.displayName || 'Teacher') : '\u2014';
    }

    function studentsInClass(classId) {
      return state.students.filter(function (s) {
        return String(s.classId) === String(classId);
      });
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
          w.appendChild(el('h2', { textContent: 'Classes', style: { marginBottom: '4px' } }));
          w.appendChild(el('p', {
            className: 'muted',
            style: { margin: '0' },
            textContent: 'Create classes and assign teachers to them. Students are assigned from the Users view.'
          }));
          return w;
        })(),
        (function () {
          const wrap = el('div', { style: { display: 'flex', gap: '8px' } });
          wrap.appendChild(el('button', {
            type: 'button',
            className: 'btn btn-primary',
            textContent: '+ New class',
            onClick: openCreateClassModal
          }));
          wrap.appendChild(el('button', {
            type: 'button',
            className: 'btn btn-outline btn-sm',
            textContent: 'Refresh',
            onClick: loadAll
          }));
          return wrap;
        })()
      ]));

      if (state.isLoading) { container.appendChild(loadingBox('Loading classes\u2026')); return; }
      if (state.loadError) {
        container.appendChild(errorBox('Could not load classes', state.loadError, loadAll));
        return;
      }
      if (!state.classes.length) {
        container.appendChild(emptyBox(
          'No classes yet',
          'Create your first class to assign teachers and students to it.',
          'Create first class',
          openCreateClassModal
        ));
        return;
      }

      state.classes.forEach(function (c) {
        container.appendChild(renderClassCard(c));
      });
    }

    function renderClassCard(cls) {
      const isExpanded = String(state.expandedClassId) === String(cls.classId);
      const classStudents = studentsInClass(cls.classId);
      const teacherIds = Array.isArray(cls.teacherIds) ? cls.teacherIds : [];

      const card = el('div', { className: 'card', style: { marginBottom: '12px' } });

      // Header
      const header = el('div', {
        className: 'card-header',
        style: { cursor: 'pointer', userSelect: 'none' }
      });
      const left = el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } });
      left.appendChild(el('span', {
        style: { color: '#64748b', fontSize: '.9rem' },
        textContent: isExpanded ? '\u25be' : '\u25b8'
      }));
      left.appendChild(el('h3', {
        textContent: cls.className || 'Class',
        style: { margin: '0' }
      }));
      left.appendChild(el('span', {
        className: 'badge badge-grey',
        textContent: classStudents.length + ' student' + (classStudents.length === 1 ? '' : 's')
      }));
      left.appendChild(el('span', {
        className: 'badge badge-navy',
        textContent: teacherIds.length + ' teacher' + (teacherIds.length === 1 ? '' : 's')
      }));
      header.appendChild(left);

      const right = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } });
      right.appendChild(el('button', {
        type: 'button',
        className: 'btn btn-outline btn-sm',
        textContent: '+ Assign teacher',
        onClick: function (e) {
          e.stopPropagation();
          openAssignTeacherModal(cls);
        }
      }));
      header.appendChild(right);

      header.addEventListener('click', function () {
        state.expandedClassId = isExpanded ? '' : String(cls.classId);
        paint();
      });
      card.appendChild(header);

      if (isExpanded) {
        const body = el('div', { className: 'card-body' });

        // Teachers
        body.appendChild(el('div', {
          className: 'section-title',
          style: { marginBottom: '8px', fontSize: '.95rem' },
          textContent: 'Teachers'
        }));

        if (!teacherIds.length) {
          body.appendChild(el('p', {
            className: 'muted',
            style: { fontSize: '.88rem', marginBottom: '16px' },
            textContent: 'No teachers assigned yet.'
          }));
        } else {
          const teachersList = el('div', {
            style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }
          });
          teacherIds.forEach(function (tid) {
            const chip = el('div', {
              style: {
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '4px 10px',
                background: '#eef1f5',
                borderRadius: '999px',
                fontSize: '.85rem'
              }
            });
            chip.appendChild(el('span', { textContent: teacherName(tid) }));
            chip.appendChild(el('button', {
              type: 'button',
              textContent: '\u00d7',
              'aria-label': 'Remove teacher',
              style: {
                border: 'none',
                background: 'transparent',
                color: '#64748b',
                cursor: 'pointer',
                fontSize: '1rem',
                padding: '0 2px'
              },
              onClick: function () { removeTeacher(cls, tid); }
            }));
            teachersList.appendChild(chip);
          });
          body.appendChild(teachersList);
        }

        // Students
        body.appendChild(el('div', {
          className: 'section-title',
          style: { marginBottom: '8px', fontSize: '.95rem' },
          textContent: 'Students'
        }));

        if (!classStudents.length) {
          body.appendChild(el('p', {
            className: 'muted',
            style: { fontSize: '.88rem' },
            textContent: 'No students in this class yet. Assign students from the Users view.'
          }));
        } else {
          const swrap = el('div', { className: 'table-wrap' });
          const st = el('table');
          const sth = el('thead');
          const shrow = el('tr');
          shrow.appendChild(el('th', { textContent: 'Student' }));
          shrow.appendChild(el('th', { textContent: 'Points', className: 'numeric' }));
          shrow.appendChild(el('th', { textContent: 'Challenges', className: 'numeric' }));
          sth.appendChild(shrow);
          st.appendChild(sth);
          const stb = el('tbody');
          classStudents.slice().sort(function (a, b) {
            return num(b.totalPoints) - num(a.totalPoints);
          }).forEach(function (s) {
            const tr = el('tr');
            tr.appendChild(el('td', { textContent: s.displayName || 'Student', style: { fontWeight: '500' } }));
            tr.appendChild(el('td', {
              className: 'numeric',
              textContent: num(s.totalPoints).toLocaleString(),
              style: { color: '#178a48', fontWeight: '600' }
            }));
            tr.appendChild(el('td', {
              className: 'numeric',
              textContent: String(num(s.challengesCompleted))
            }));
            stb.appendChild(tr);
          });
          st.appendChild(stb);
          swrap.appendChild(st);
          body.appendChild(swrap);
        }

        card.appendChild(body);
      }

      return card;
    }

    /* ---------- Create class ---------- */
    function openCreateClassModal() {
      const form = el('form', { className: 'form' });

      const nameInput = el('input', { type: 'text', maxlength: '60', required: 'required' });
      form.appendChild(fieldRow('Class name *', nameInput));

      const errorEl = el('div', { className: 'error-text hidden' });
      form.appendChild(errorEl);

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        errorEl.classList.add('hidden');
        const name = nameInput.value.trim();
        if (!name) {
          errorEl.textContent = 'Class name is required.';
          errorEl.classList.remove('hidden');
          return;
        }
        api().admin.createClass({ className: name, teacherIds: [] }).then(function () {
          if (!state.mounted) return;
          if (ui() && ui().closeModal) ui().closeModal();
          toast('Class created.', 'success');
          loadAll();
        }).catch(function (err) {
          if (!state.mounted) return;
          if (api().isAuthError && api().isAuthError(err)) return;
          errorEl.textContent = safeMsg(err);
          errorEl.classList.remove('hidden');
        });
      });

      if (ui() && ui().showModal) {
        ui().showModal({
          title: 'Create class',
          body: form,
          footer: [
            { label: 'Cancel', variant: 'outline', onClick: function () { ui().closeModal(); } },
            {
              label: 'Create class',
              variant: 'primary',
              onClick: function () {
                form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
              }
            }
          ]
        });
      }
    }

    /* ---------- Assign teacher ---------- */
    function openAssignTeacherModal(cls) {
      const current = new Set(Array.isArray(cls.teacherIds) ? cls.teacherIds.map(String) : []);

      const form = el('form', { className: 'form' });

      const listField = el('label');
      listField.appendChild(el('span', { textContent: 'Assign teachers to ' + (cls.className || 'this class') }));
      const list = el('div', { className: 'checkbox-list' });

      const eligible = state.teachers.filter(function (t) {
        return String(t.status || '').toLowerCase() === 'active';
      });

      if (!eligible.length) {
        list.appendChild(el('div', { className: 'muted', textContent: 'No active teachers available.' }));
      } else {
        eligible.forEach(function (t) {
          const row = el('label');
          const cb = el('input', { type: 'checkbox' });
          cb.checked = current.has(String(t.id));
          row.appendChild(cb);
          row.appendChild(el('span', {
            textContent: (t.displayName || 'Teacher') + ' (' + (t.email || '') + ')'
          }));
          list.appendChild(row);
          cb._teacherId = String(t.id);
          cb._wasChecked = cb.checked;
        });
      }
      listField.appendChild(list);
      form.appendChild(listField);

      const errorEl = el('div', { className: 'error-text hidden' });
      form.appendChild(errorEl);

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        errorEl.classList.add('hidden');

        const checkboxes = list.querySelectorAll('input[type="checkbox"]');
        const ops = [];
        checkboxes.forEach(function (cb) {
          const was = cb._wasChecked;
          const now = cb.checked;
          if (was !== now) {
            ops.push({
              classId: cls.classId,
              teacherId: cb._teacherId,
              add: now
            });
          }
        });

        if (!ops.length) {
          if (ui() && ui().closeModal) ui().closeModal();
          toast('No changes.', 'warn');
          return;
        }

        Promise.all(ops.map(function (op) {
          return api().admin.assignTeacherToClass(op);
        })).then(function () {
          if (!state.mounted) return;
          if (ui() && ui().closeModal) ui().closeModal();
          toast('Teacher assignments updated.', 'success');
          loadAll();
        }).catch(function (err) {
          if (!state.mounted) return;
          if (api().isAuthError && api().isAuthError(err)) return;
          errorEl.textContent = safeMsg(err);
          errorEl.classList.remove('hidden');
        });
      });

      if (ui() && ui().showModal) {
        ui().showModal({
          title: 'Assign teachers',
          body: form,
          wide: true,
          footer: [
            { label: 'Cancel', variant: 'outline', onClick: function () { ui().closeModal(); } },
            {
              label: 'Save',
              variant: 'primary',
              onClick: function () {
                form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
              }
            }
          ]
        });
      }
    }

    async function removeTeacher(cls, teacherId) {
      const ok = await confirmDialog(
        'Remove ' + teacherName(teacherId) + ' from ' + (cls.className || 'this class') + '?',
        { title: 'Remove teacher?', confirmLabel: 'Remove', danger: true }
      );
      if (!ok) return;
      try {
        await api().admin.assignTeacherToClass({
          classId: cls.classId,
          teacherId: teacherId,
          add: false
        });
        if (!state.mounted) return;
        toast('Teacher removed.', 'success');
        loadAll();
      } catch (err) {
        if (!state.mounted) return;
        if (api().isAuthError && api().isAuthError(err)) return;
        toast('Could not remove: ' + safeMsg(err), 'error', 4000);
      }
    }

    /* ---------- Init ---------- */
    paint();
    loadAll();
    ctx.onCleanup(function () { state.mounted = false; });
  }

  /* =========================================================
     REGISTER (Part 1)
     ========================================================= */

  window.APP.views.renderAdminDashboard = renderAdminDashboard;
  window.APP.views.renderAdminUsers     = renderAdminUsers;
  window.APP.views.renderAdminClasses   = renderAdminClasses;

  /* ============================================================
     PART 2 (second IIFE, appended to this file) registers:

       renderAdminHunts        (read-only list + archive)
       renderAdminReports      (aggregate reports across school)
       renderAdminIntegrations (config docs + test connection)
       renderAdminAudit        (system activity log)
       renderAdminSettings     (display name + app info)

     Until Part 2 is appended, the five views above resolve
     to app.js's "Coming soon" fallback. Nothing breaks.
     ============================================================ */
})();

/* =========================================================
   TREASURE HUNT APP — admin.js (PART 2 OF 2)
   ---------------------------------------------------------
   Appended to js/admin.js. Registers the remaining five
   admin views against APP.views:

     admin.hunts        → renderAdminHunts
     admin.reports      → renderAdminReports
     admin.integrations → renderAdminIntegrations
     admin.audit        → renderAdminAudit
     admin.settings     → renderAdminSettings

   Because IIFEs do not share scope, helpers from Part 1
   are re-declared identically here. No behaviour drift.

   Admin scope vs teacher scope:
     teacher_() in backend/Code.gs allows admin through every
     teacher.* endpoint. Two views behave differently for admin:
       - teacherGetReports_     : no class filter → all students
       - teacherGetSubmissions_ : isAdmin → no class restriction
     So admin reports show the entire school.

   Backend contract:
     teacher.getHunts()             → [{ huntId, name, ..., challengeCount }]
     teacher.deleteHunt(huntId)     → { ok }   (archives)
     teacher.getClasses()           → [{ classId, className, teacherIds[] }]
     teacher.getReports({classId,
                          huntId})  → { students[], challengeStats[],
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
                                        filtered:{...}, total }
     admin.getAudit({limit})        → [{ LogID, Timestamp, ActorID,
                                         ActorRole, Action,
                                         TargetRecord, Description }]
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

  function fmtDateRange(start, end) {
    if (!start && !end) return '\u2014';
    if (!start) return 'Until ' + fmtDate(end);
    if (!end)   return 'From ' + fmtDate(start);
    return fmtDate(start) + ' \u2013 ' + fmtDate(end);
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

  /* =========================================================
     VIEW: admin.hunts  (read-only archive)
     ========================================================= */

  async function renderAdminHunts(container, ctx) {
    const state = {
      hunts: [],
      classes: [],
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
          api().teacher.getHunts(),
          api().teacher.getClasses()
        ]);
        if (!state.mounted) return;
        state.hunts   = Array.isArray(results[0]) ? results[0] : [];
        state.classes = Array.isArray(results[1]) ? results[1] : [];
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

    function filteredHunts() {
      if (!state.filterText) return state.hunts;
      const q = state.filterText.toLowerCase();
      return state.hunts.filter(function (h) {
        return String(h.name || '').toLowerCase().indexOf(q) >= 0 ||
               String(h.description || '').toLowerCase().indexOf(q) >= 0;
      });
    }

    function paint() {
      container.innerHTML = '';

      container.appendChild(el('h2', { textContent: 'All Treasure Hunts', style: { marginBottom: '4px' } }));
      container.appendChild(el('p', {
        className: 'muted', style: { marginBottom: '16px' },
        textContent: 'Every treasure hunt across the school. Creation is done by teachers; admins can archive old hunts here.'
      }));

      if (state.isLoading) { container.appendChild(loadingBox('Loading hunts\u2026')); return; }
      if (state.loadError) {
        container.appendChild(errorBox('Could not load hunts', state.loadError, loadAll));
        return;
      }

      const filterRow = el('div', { className: 'leaderboard-filter' });
      const searchInput = el('input', {
        type: 'text', placeholder: 'Search hunts', value: state.filterText
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

      filterRow.appendChild(el('button', {
        type: 'button', className: 'btn btn-outline btn-sm', textContent: 'Refresh',
        onClick: loadAll
      }));
      container.appendChild(filterRow);

      const rows = filteredHunts();
      if (!rows.length) {
        container.appendChild(emptyBox(
          'No hunts found',
          state.hunts.length ? 'Try clearing the search.' : 'No treasure hunts have been created yet.'
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
      rows.forEach(function (h) {
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
          className: 'muted', style: { fontSize: '.85rem' },
          textContent: classesSummary(h.assignedClassIds, state.classes)
        }));

        const statusTd = el('td');
        const s = String(h.status || '').toLowerCase();
        if (s === 'archived') statusTd.appendChild(el('span', { className: 'badge badge-grey', textContent: 'Archived' }));
        else if (!h.published) statusTd.appendChild(el('span', { className: 'badge badge-gold', textContent: 'Draft' }));
        else statusTd.appendChild(el('span', { className: 'badge badge-green', textContent: 'Active' }));
        tr.appendChild(statusTd);

        const actionsTd = el('td', { style: { textAlign: 'right' } });
        if (s !== 'archived') {
          actionsTd.appendChild(el('button', {
            type: 'button', className: 'btn btn-danger btn-sm', textContent: 'Archive',
            onClick: function () { archiveHunt(h); }
          }));
        } else {
          actionsTd.appendChild(el('span', { className: 'muted', style: { fontSize: '.82rem' }, textContent: '\u2014' }));
        }
        tr.appendChild(actionsTd);

        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
      container.appendChild(wrap);
    }

    async function archiveHunt(hunt) {
      const ok = await confirmDialog(
        'Archive "' + (hunt.name || 'this hunt') + '"? Students will no longer see it, ' +
        'and it will be hidden from teacher views. Existing scores are preserved.',
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

  /* =========================================================
     VIEW: admin.reports  (school-wide, includes submissions)
     ========================================================= */

  async function renderAdminReports(container, ctx) {
    const state = {
      hunts: [],
      classes: [],
      filterClassId: '',
      filterHuntId: '',
      filterStatus: 'all',
      report: null,
      submissions: [],
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
        const results = await Promise.all([
          api().teacher.getReports({
            classId: state.filterClassId,
            huntId:  state.filterHuntId
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

      container.appendChild(el('h2', { textContent: 'School Reports', style: { marginBottom: '4px' } }));
      container.appendChild(el('p', {
        className: 'muted', style: { marginBottom: '16px' },
        textContent: 'Aggregate performance across every class. Filter, drill down, and export to CSV.'
      }));

      if (state.isLoadingRefs) { container.appendChild(loadingBox('Loading filters\u2026')); return; }
      if (state.loadError) {
        container.appendChild(errorBox('Could not load reports', state.loadError, loadRefs));
        return;
      }

      const filterRow = el('div', { className: 'leaderboard-filter' });

      const classSel = el('select', { 'aria-label': 'Filter by class' });
      classSel.appendChild(el('option', { value: '', textContent: 'All classes' }));
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

      filterRow.appendChild(el('button', {
        type: 'button', className: 'btn btn-outline btn-sm', textContent: 'Refresh',
        disabled: state.isLoadingReport,
        onClick: loadReport
      }));

      if (state.report && !state.isLoadingReport) {
        filterRow.appendChild(el('button', {
          type: 'button', className: 'btn btn-outline btn-sm', textContent: 'Download scores CSV',
          onClick: downloadStudentsCsv
        }));
        filterRow.appendChild(el('button', {
          type: 'button', className: 'btn btn-outline btn-sm', textContent: 'Download stats CSV',
          onClick: downloadStatsCsv
        }));
        filterRow.appendChild(el('button', {
          type: 'button', className: 'btn btn-outline btn-sm', textContent: 'Download submissions CSV',
          onClick: downloadSubmissionsCsv
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

      // Summary
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

      // Students
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

      // Challenge stats
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

      // Submissions
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
      const fname = 'school-scores-' + isoDateOnly(new Date().toISOString()) + '.csv';
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
      const fname = 'school-challenge-stats-' + isoDateOnly(new Date().toISOString()) + '.csv';
      if (downloadCsv(fname, headers, rows)) toast('Stats CSV downloaded.', 'success');
      else toast('Could not download CSV.', 'error');
    }

    function downloadSubmissionsCsv() {
      const headers = ['Student', 'Class', 'Challenge', 'Hunt', 'Score', 'Max Score', 'Percent', 'Result', 'Submitted'];
      const rows = state.submissions.map(function (s) {
        return [
          s.studentName || '',
          s.className || '',
          s.challengeName || '',
          s.huntName || '',
          num(s.score),
          num(s.maxScore),
          s.percent != null ? num(s.percent) : '',
          s.passed ? 'Passed' : 'Failed',
          s.submittedAt || ''
        ];
      });
      const fname = 'school-submissions-' + isoDateOnly(new Date().toISOString()) + '.csv';
      if (downloadCsv(fname, headers, rows)) toast('Submissions CSV downloaded.', 'success');
      else toast('Could not download CSV.', 'error');
    }

    paint();
    loadRefs();
    ctx.onCleanup(function () { state.mounted = false; });
  }

  /* =========================================================
     VIEW: admin.integrations
     ========================================================= */

  function renderAdminIntegrations(container, ctx) {
    container.innerHTML = '';

    container.appendChild(el('h2', { textContent: 'Integrations', style: { marginBottom: '4px' } }));
    container.appendChild(el('p', {
      className: 'muted', style: { marginBottom: '16px' },
      textContent: 'Backend configuration for Google Sheets, Apps Script, and Forms. Read-only here — configure via SETUP.md.'
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
      textContent: 'All requests go through the Google Apps Script Web App configured in js/config.js.'
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

    // ---- Spreadsheet ----
    const sheetCard = el('div', { className: 'card' });
    const sh = el('div', { className: 'card-header' });
    sh.appendChild(el('h3', { textContent: 'Spreadsheet' }));
    sheetCard.appendChild(sh);
    const sb = el('div', { className: 'card-body' });
    sb.appendChild(el('p', {
      className: 'muted', style: { fontSize: '.9rem' },
      textContent: 'The spreadsheet ID is set as a Script Property (SPREADSHEET_ID). It is not exposed to the frontend — no credentials ship in the browser.'
    }));
    sb.appendChild(el('p', {
      className: 'muted', style: { fontSize: '.82rem', marginTop: '8px' },
      textContent: 'Worksheets: Students, Teachers, Classes, TreasureHunts, Challenges, Quizzes, Questions, QuizResults, ScoreTransactions, Sessions, AuditLog, Settings.'
    }));
    sb.appendChild(el('p', {
      className: 'muted', style: { fontSize: '.82rem' },
      innerHTML: 'See <strong>SETUP.md</strong> for the layout and setup steps.'
    }));
    sheetCard.appendChild(sb);
    grid.appendChild(sheetCard);

    // ---- Google Forms ----
    const formsCard = el('div', { className: 'card' });
    const fh = el('div', { className: 'card-header' });
    fh.appendChild(el('h3', { textContent: 'Google Forms' }));
    formsCard.appendChild(fh);
    const fb = el('div', { className: 'card-body' });
    fb.appendChild(el('p', {
      className: 'muted', style: { fontSize: '.9rem' },
      textContent: 'Challenges may optionally link a Google Form for activities the built-in quiz can\u2019t express.'
    }));
    const ul = el('ul', { style: { fontSize: '.88rem', color: '#475569', paddingLeft: '20px', marginTop: '8px' } });
    ul.appendChild(el('li', { textContent: 'Responses arrive in the form\u2019s response spreadsheet, not in the app.' }));
    ul.appendChild(el('li', { textContent: 'Teachers grade responses externally and award points via the challenge editor.' }));
    ul.appendChild(el('li', { textContent: 'Built-in quizzes remain the recommended path for immediate scoring.' }));
    fb.appendChild(ul);
    formsCard.appendChild(fb);
    grid.appendChild(formsCard);

    // ---- Auth ----
    const authCard = el('div', { className: 'card' });
    const ah = el('div', { className: 'card-header' });
    ah.appendChild(el('h3', { textContent: 'Authentication' }));
    authCard.appendChild(ah);
    const ab = el('div', { className: 'card-body' });
    ab.appendChild(el('p', {
      className: 'muted', style: { fontSize: '.9rem' },
      textContent: 'Email + password login with SHA-256 salted hashes, 24-hour sessions, and per-email rate limiting (10 attempts per 5 minutes).'
    }));
    ab.appendChild(el('p', {
      className: 'muted', style: { fontSize: '.82rem', marginTop: '8px' },
      textContent: 'Sessions are stored server-side in the Sessions worksheet. Tokens are validated on every request; role checks are enforced server-side.'
    }));
    authCard.appendChild(ab);
    grid.appendChild(authCard);

    container.appendChild(grid);

    container.appendChild(el('p', {
      className: 'muted',
      style: { fontSize: '.82rem', marginTop: '20px' },
      textContent: 'Configuration is managed by the school IT administrator via Google Apps Script. This page is read-only.'
    }));
  }

  /* =========================================================
     VIEW: admin.audit
     ========================================================= */

  async function renderAdminAudit(container, ctx) {
    const state = {
      entries: [],
      filterRole: 'all',
      filterAction: '',
      filterText: '',
      limit: 200,
      isLoading: true,
      loadError: '',
      mounted: true
    };

    async function loadAudit() {
      state.isLoading = true;
      state.loadError = '';
      paint();
      try {
        const data = await api().admin.getAudit(state.limit);
        if (!state.mounted) return;
        state.entries = Array.isArray(data) ? data : [];
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

    function filtered() {
      let rows = state.entries;
      if (state.filterRole !== 'all') {
        rows = rows.filter(function (e) {
          return String(e.ActorRole || '').toLowerCase() === state.filterRole;
        });
      }
      if (state.filterAction) {
        const q = state.filterAction.toLowerCase();
        rows = rows.filter(function (e) {
          return String(e.Action || '').toLowerCase().indexOf(q) >= 0;
        });
      }
      if (state.filterText) {
        const q = state.filterText.toLowerCase();
        rows = rows.filter(function (e) {
          return String(e.ActorID || '').toLowerCase().indexOf(q) >= 0 ||
                 String(e.TargetRecord || '').toLowerCase().indexOf(q) >= 0 ||
                 String(e.Description || '').toLowerCase().indexOf(q) >= 0;
        });
      }
      return rows;
    }

    function actionBadge(action) {
      const a = String(action || '').toUpperCase();
      let cls = 'badge-grey';
      if (a.indexOf('AWARD') === 0 || a.indexOf('LOGIN') === 0 || a.indexOf('CREATE') === 0) cls = 'badge-green';
      else if (a.indexOf('DELETE') === 0 || a.indexOf('ARCHIVE') === 0 || a.indexOf('DISABLE') === 0 || a.indexOf('RESET') === 0) cls = 'badge-red';
      else if (a.indexOf('UPDATE') === 0 || a.indexOf('REGEN') === 0 || a.indexOf('ASSIGN') === 0) cls = 'badge-gold';
      else if (a.indexOf('ERROR') === 0) cls = 'badge-red';
      return el('span', { className: 'badge ' + cls, textContent: a || '\u2014' });
    }

    function roleBadge(role) {
      const r = String(role || '').toLowerCase();
      if (r === 'student') return el('span', { className: 'badge badge-navy', textContent: 'student' });
      if (r === 'teacher') return el('span', { className: 'badge badge-gold', textContent: 'teacher' });
      if (r === 'admin')   return el('span', { className: 'badge badge-green', textContent: 'admin' });
      return el('span', { className: 'chip', textContent: role || '\u2014' });
    }

    function paint() {
      container.innerHTML = '';

      container.appendChild(el('h2', { textContent: 'Audit Log', style: { marginBottom: '4px' } }));
      container.appendChild(el('p', {
        className: 'muted', style: { marginBottom: '16px' },
        textContent: 'Every score award, edit, login, and error the system recorded. Read-only.'
      }));

      if (state.isLoading) { container.appendChild(loadingBox('Loading audit log\u2026')); return; }
      if (state.loadError) {
        container.appendChild(errorBox('Could not load audit log', state.loadError, loadAudit));
        return;
      }

      // Filters
      const filterRow = el('div', { className: 'leaderboard-filter' });

      const roleSel = el('select', { 'aria-label': 'Filter by actor role' });
      [
        ['all', 'All roles'],
        ['student', 'Students'],
        ['teacher', 'Teachers'],
        ['admin', 'Admins']
      ].forEach(function (opt) {
        const o = el('option', { value: opt[0], textContent: opt[1] });
        if (opt[0] === state.filterRole) o.selected = true;
        roleSel.appendChild(o);
      });
      roleSel.addEventListener('change', function () {
        state.filterRole = String(roleSel.value || 'all');
        paint();
      });
      filterRow.appendChild(roleSel);

      const actionInput = el('input', {
        type: 'text', placeholder: 'Filter by action (e.g. LOGIN, AWARD)', value: state.filterAction
      });
      actionInput.addEventListener('input', function () {
        state.filterAction = String(actionInput.value || '');
        paint();
        setTimeout(function () {
          const next = container.querySelectorAll('.leaderboard-filter input[type="text"]')[0];
          if (next) {
            next.focus();
            try { next.setSelectionRange(next.value.length, next.value.length); } catch (e) {}
          }
        }, 0);
      });
      filterRow.appendChild(actionInput);

      const textInput = el('input', {
        type: 'text', placeholder: 'Search actor / target / description', value: state.filterText
      });
      textInput.addEventListener('input', function () {
        state.filterText = String(textInput.value || '');
        paint();
        setTimeout(function () {
          const next = container.querySelectorAll('.leaderboard-filter input[type="text"]')[1];
          if (next) {
            next.focus();
            try { next.setSelectionRange(next.value.length, next.value.length); } catch (e) {}
          }
        }, 0);
      });
      filterRow.appendChild(textInput);

      const limitSel = el('select', { 'aria-label': 'Row limit' });
      [100, 200, 500, 1000].forEach(function (n) {
        const o = el('option', { value: String(n), textContent: 'Show ' + n });
        if (n === state.limit) o.selected = true;
        limitSel.appendChild(o);
      });
      limitSel.addEventListener('change', function () {
        state.limit = num(limitSel.value) || 200;
        loadAudit();
      });
      filterRow.appendChild(limitSel);

      filterRow.appendChild(el('button', {
        type: 'button', className: 'btn btn-outline btn-sm', textContent: 'Refresh',
        onClick: loadAudit
      }));

      container.appendChild(filterRow);

      // Body
      const rows = filtered();
      if (!rows.length) {
        container.appendChild(emptyBox(
          'No audit entries',
          state.entries.length ? 'Try clearing the filters above.' : 'No activity yet.'
        ));
        return;
      }

      const wrap = el('div', { className: 'table-wrap' });
      const table = el('table');
      const thead = el('thead');
      const hr = el('tr');
      hr.appendChild(el('th', { textContent: 'When' }));
      hr.appendChild(el('th', { textContent: 'Actor' }));
      hr.appendChild(el('th', { textContent: 'Role' }));
      hr.appendChild(el('th', { textContent: 'Action' }));
      hr.appendChild(el('th', { textContent: 'Target' }));
      hr.appendChild(el('th', { textContent: 'Description' }));
      thead.appendChild(hr);
      table.appendChild(thead);

      const tbody = el('tbody');
      rows.forEach(function (e) {
        const tr = el('tr');

        tr.appendChild(el('td', {
          className: 'muted',
          style: { fontSize: '.82rem', whiteSpace: 'nowrap' },
          textContent: fmtDateTime(e.Timestamp)
        }));

        tr.appendChild(el('td', {
          className: 'mono',
          style: { fontSize: '.78rem' },
          textContent: e.ActorID || '\u2014'
        }));

        const roleTd = el('td');
        roleTd.appendChild(roleBadge(e.ActorRole));
        tr.appendChild(roleTd);

        const actionTd = el('td');
        actionTd.appendChild(actionBadge(e.Action));
        tr.appendChild(actionTd);

        tr.appendChild(el('td', {
          className: 'mono',
          style: { fontSize: '.78rem', color: '#64748b' },
          textContent: e.TargetRecord || '\u2014'
        }));

        tr.appendChild(el('td', {
          className: 'muted',
          style: { fontSize: '.85rem', maxWidth: '360px' },
          textContent: e.Description || ''
        }));

        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
      container.appendChild(wrap);

      container.appendChild(el('p', {
        className: 'muted',
        style: { fontSize: '.82rem', marginTop: '8px', textAlign: 'center' },
        textContent: 'Showing ' + rows.length + ' of ' + state.entries.length + ' entries (max ' + state.limit + ' loaded).'
      }));
    }

    paint();
    loadAudit();
    ctx.onCleanup(function () { state.mounted = false; });
  }

  /* =========================================================
     VIEW: admin.settings
     ========================================================= */

  async function renderAdminSettings(container, ctx) {
    const user = (ctx && ctx.user) || (window.APP.auth && window.APP.auth.getUser()) || {};
    container.innerHTML = '';

    container.appendChild(el('h2', { textContent: 'Settings', style: { marginBottom: '4px' } }));
    container.appendChild(el('p', {
      className: 'muted', style: { marginBottom: '16px' },
      textContent: 'Manage your administrator account and view system information.'
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
      textContent: 'Use Users > Reset password to change your own password.'
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
      ['Role', user.role || 'admin']
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

    // ---- Deployment note ----
    const deployCard = el('div', { className: 'card', style: { marginBottom: '16px' } });
    const dh = el('div', { className: 'card-header' });
    dh.appendChild(el('h3', { textContent: 'Deployment' }));
    deployCard.appendChild(dh);
    const db = el('div', { className: 'card-body' });
    db.appendChild(el('p', {
      className: 'muted',
      style: { fontSize: '.88rem' },
      textContent: 'Configuration of the backend (spreadsheet ID, deployment URL, admin account) is documented in SETUP.md. These values are managed via Google Apps Script, not from this page.'
    }));
    deployCard.appendChild(db);
    container.appendChild(deployCard);

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

  window.APP.views.renderAdminHunts        = renderAdminHunts;
  window.APP.views.renderAdminReports      = renderAdminReports;
  window.APP.views.renderAdminIntegrations = renderAdminIntegrations;
  window.APP.views.renderAdminAudit        = renderAdminAudit;
  window.APP.views.renderAdminSettings     = renderAdminSettings;

})();
