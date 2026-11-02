/* =========================================================
   TREASURE HUNT APP — leaderboard.js
   ---------------------------------------------------------
   Views:
     student.leaderboard  →  renderStudentLeaderboard
     teacher.leaderboards →  renderTeacherLeaderboards

   Tabs (orthogonal):
     School — no filters
     Class  — teachers pick a class; students auto-locked
              (backend defaults to the student's own class)
     Hunt   — pick one hunt (required); uses scope=school + huntId

   Data:
     APP.api.getLeaderboard({ scope, classId, huntId })
       → { scope, rows:[{ rank, displayName, className,
                          totalPoints, challengesCompleted }] }

   Filters preload:
     Students → APP.api.getTreasureHunts()
     Teachers → APP.api.teacher.getClasses() + teacher.getHunts()

   Polling:
     interval = cfg.NETWORK.LEADERBOARD_POLL_MS (30s)
     skipped when document.hidden
     restarted on scope change, cleared on cleanup

   Ranks:
     Displayed exactly as the backend computed them.
     Tie-breaking is a backend concern; the frontend must
     never re-sort or re-rank.
   ========================================================= */

window.APP = window.APP || {};
window.APP.views = window.APP.views || {};

(function () {
  'use strict';

  const cfg = window.APP.config;

  /* ============================ HELPERS ============================ */

  function api() { return window.APP.api; }

  function el(tag, attrs, children) {
    if (window.APP.ui && typeof window.APP.ui.el === 'function') {
      return window.APP.ui.el(tag, attrs, children);
    }
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
    if (window.APP.ui && typeof window.APP.ui.toast === 'function') {
      window.APP.ui.toast(msg, type, timeout);
    } else {
      try { console.log('[toast]', type || '', msg); } catch (e) {}
    }
  }

  function safeMsg(err) {
    const a = api();
    return a && a.safeMessage ? a.safeMessage(err) : ((err && err.message) || 'Something went wrong.');
  }

  function num(n) { const v = Number(n); return isNaN(v) ? 0 : v; }

  function rankClass(rank) {
    const r = num(rank);
    if (r === 1) return 'rank-badge top1';
    if (r === 2) return 'rank-badge top2';
    if (r === 3) return 'rank-badge top3';
    return 'rank-badge';
  }

  /* ============================ MAIN ============================ */

  async function renderLeaderboardView(container, ctx, isTeacher) {
    /* ---------- Local state ---------- */
    let currentScope  = 'school';
    let currentClassId = isTeacher
      ? String((ctx.user && ctx.user.classIds && ctx.user.classIds[0]) || '')
      : '';
    let currentHuntId = '';
    let classes = [];
    let hunts   = [];
    let mounted = true;
    let pollHandle = null;
    let hasFetchedOnce = false;
    let lastUpdated = 0;
    let inflight = false;
    let needsInput = false; // Hunt tab with no hunt picked / Class tab with no class
    let fetchError = '';
    let currentRows = [];
    let currentMeta = { scope: 'school' };
    let hasLoadedFilters = false;

    /* ---------- Filter preload ---------- */
    async function preloadFilters() {
      if (hasLoadedFilters) return;
      try {
        if (isTeacher) {
          const results = await Promise.all([
            api().teacher.getClasses(),
            api().teacher.getHunts()
          ]);
          classes = Array.isArray(results[0]) ? results[0] : [];
          hunts   = Array.isArray(results[1]) ? results[1] : [];
        } else {
          const hData = await api().getTreasureHunts();
          hunts = Array.isArray(hData) ? hData : [];
        }
        // Fallback class default for teachers if ctx.user had none
        if (isTeacher && !currentClassId && classes.length) {
          currentClassId = String(classes[0].classId || '');
        }
        hasLoadedFilters = true;
      } catch (err) {
        // Non-fatal: filters just stay empty.
        console.warn('[leaderboard] filter preload failed', err);
        hasLoadedFilters = true;
      }
    }

    /* ---------- Polling ---------- */
    function clearPoll() {
      if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
    }
    function restartPoll() {
      clearPoll();
      pollHandle = setInterval(tick, cfg.NETWORK.LEADERBOARD_POLL_MS || 30000);
    }
    function tick() {
      if (!mounted) { clearPoll(); return; }
      if (document.hidden) return;          // don't burn quota on background tabs
      if (inflight) return;                 // don't stack requests
      fetchLeaderboard({ silent: true });
    }

    /* ---------- Query ---------- */
    function currentPayload() {
      if (currentScope === 'school') {
        return { scope: 'school', classId: '', huntId: '' };
      }
      if (currentScope === 'class') {
        if (isTeacher && !currentClassId) return null;
        // Students: leave classId empty — backend uses their own class
        return { scope: 'class', classId: isTeacher ? currentClassId : '', huntId: '' };
      }
      if (currentScope === 'hunt') {
        if (!currentHuntId) return null;
        return { scope: 'school', classId: '', huntId: currentHuntId };
      }
      return { scope: 'school', classId: '', huntId: '' };
    }

    async function fetchLeaderboard(opts) {
      opts = opts || {};
      const payload = currentPayload();

      if (!payload) {
        needsInput = true;
        render();
        return;
      }

      needsInput = false;
      inflight = true;
      if (!opts.silent) {
        fetchError = '';
        render();
      }
      // Mark "updating" for silent refreshes
      const updatingEl = container.querySelector('[data-updating]');
      if (updatingEl) updatingEl.textContent = 'Updating\u2026';

      try {
        const data = await api().getLeaderboard(payload);
        if (!mounted) return;
        currentRows = (data && Array.isArray(data.rows)) ? data.rows : [];
        currentMeta = { scope: (data && data.scope) || currentScope };
        fetchError = '';
        lastUpdated = Date.now();
        hasFetchedOnce = true;
      } catch (err) {
        if (!mounted) return;
        if (api().isAuthError && api().isAuthError(err)) return;
        fetchError = safeMsg(err);
      } finally {
        inflight = false;
        if (mounted) render();
      }
    }

    /* ---------- Rendering ---------- */
    function render() {
      // Preserve scroll position on silent refresh
      const scrollY = window.scrollY;
      container.innerHTML = '';

      /* ---- Header ---- */
      container.appendChild(el('h2', {
        textContent: isTeacher ? 'Leaderboards' : 'Leaderboard',
        style: { marginBottom: '4px' }
      }));
      container.appendChild(el('p', {
        className: 'muted',
        textContent: isTeacher
          ? 'School, class and hunt rankings across all active students.'
          : 'See where you stand across the school, your class, and each hunt.',
        style: { marginBottom: '16px' }
      }));

      /* ---- Tabs ---- */
      const tabs = el('div', { className: 'tabs' });
      [['school', 'School'], ['class', 'Class'], ['hunt', 'Hunt']].forEach(function (t) {
        const btn = el('button', {
          type: 'button',
          className: 'tab' + (currentScope === t[0] ? ' active' : ''),
          textContent: t[1]
        });
        btn.addEventListener('click', function () {
          if (currentScope === t[0]) return;
          currentScope = t[0];
          fetchError = '';
          fetchLeaderboard({});
          restartPoll();
        });
        tabs.appendChild(btn);
      });
      container.appendChild(tabs);

      /* ---- Filters row ---- */
      const filterRow = el('div', { className: 'leaderboard-filter' });

      // Class filter (teachers, Class tab only)
      if (currentScope === 'class') {
        if (isTeacher) {
          const sel = el('select', { 'aria-label': 'Select class' });
          if (!classes.length) {
            sel.appendChild(el('option', { value: '', textContent: 'No classes available' }));
            sel.disabled = true;
          } else {
            classes.forEach(function (c) {
              const opt = el('option', {
                value: String(c.classId || ''),
                textContent: c.className || 'Class'
              });
              if (String(c.classId) === String(currentClassId)) opt.selected = true;
              sel.appendChild(opt);
            });
          }
          sel.addEventListener('change', function () {
            currentClassId = String(sel.value || '');
            fetchError = '';
            fetchLeaderboard({});
            restartPoll();
          });
          filterRow.appendChild(sel);
        } else {
          // Students: read-only, backend scopes to their own class
          filterRow.appendChild(el('span', {
            className: 'badge badge-navy',
            textContent: 'Your class'
          }));
        }
      }

      // Hunt filter (Hunt tab)
      if (currentScope === 'hunt') {
        const sel = el('select', { 'aria-label': 'Select treasure hunt' });
        if (!hunts.length) {
          sel.appendChild(el('option', { value: '', textContent: 'No treasure hunts available' }));
          sel.disabled = true;
        } else {
          sel.appendChild(el('option', { value: '', textContent: 'Select a treasure hunt\u2026' }));
          hunts.forEach(function (h) {
            const opt = el('option', {
              value: String(h.huntId || ''),
              textContent: h.name || 'Hunt'
            });
            if (String(h.huntId) === String(currentHuntId)) opt.selected = true;
            sel.appendChild(opt);
          });
        }
        sel.addEventListener('change', function () {
          currentHuntId = String(sel.value || '');
          fetchError = '';
          fetchLeaderboard({});
          restartPoll();
        });
        filterRow.appendChild(sel);
      }

      // Refresh button + last-updated
      const refreshBtn = el('button', {
        type: 'button',
        className: 'btn btn-outline btn-sm',
        textContent: 'Refresh'
      });
      refreshBtn.addEventListener('click', function () {
        refreshBtn.disabled = true;
        fetchLeaderboard({}).finally(function () {
          if (mounted) refreshBtn.disabled = false;
        });
      });
      filterRow.appendChild(refreshBtn);

      const updating = el('span', {
        className: 'muted',
        'data-updating': '1',
        style: { fontSize: '.82rem', marginLeft: 'auto' }
      });
      if (lastUpdated) updating.textContent = 'Updated ' + window.APP.ui.relativeTime(new Date(lastUpdated).toISOString());
      else updating.textContent = '';
      filterRow.appendChild(updating);

      container.appendChild(filterRow);

      /* ---- Error banner (keeps last-known-good rows visible) ---- */
      if (fetchError && currentRows.length) {
        const banner = el('div', {
          className: 'card',
          style: { background: '#fdecec', borderColor: '#f5c2c2', marginBottom: '12px' }
        });
        const body = el('div', { className: 'card-body', style: { padding: '10px 14px', color: '#d64545', fontSize: '.88rem' } });
        body.textContent = 'Could not refresh: ' + fetchError + ' \u2014 showing the last result.';
        banner.appendChild(body);
        container.appendChild(banner);
      }

      /* ---- Body ---- */
      renderBody(container);

      try { window.scrollTo(0, scrollY); } catch (e) {}
    }

    function renderBody(root) {
      // Initial loading
      if (!hasFetchedOnce && !needsInput && !fetchError) {
        const box = el('div', { className: 'empty-state' });
        box.appendChild(el('div', { className: 'spinner', style: { margin: '0 auto 12px' } }));
        box.appendChild(el('p', { textContent: 'Loading leaderboard\u2026' }));
        root.appendChild(box);
        return;
      }

      // Needs input prompt (Hunt tab with no selection)
      if (needsInput) {
        const box = el('div', { className: 'empty-state' });
        box.appendChild(el('h3', { textContent: 'Pick a treasure hunt' }));
        box.appendChild(el('p', {
          textContent: 'Select a hunt above to see its leaderboard.'
        }));
        root.appendChild(box);
        return;
      }

      // Full error (no data yet)
      if (fetchError && !currentRows.length) {
        const card = el('div', { className: 'card' });
        const body = el('div', { className: 'card-body', style: { textAlign: 'center', padding: '36px 24px' } });
        body.appendChild(el('h3', { textContent: 'Could not load leaderboard' }));
        body.appendChild(el('p', { className: 'muted', textContent: fetchError }));
        body.appendChild(el('button', {
          type: 'button',
          className: 'btn btn-primary',
          textContent: 'Retry',
          onClick: function () { fetchLeaderboard({}); }
        }));
        card.appendChild(body);
        root.appendChild(card);
        return;
      }

      // Empty (no rows)
      if (!currentRows.length) {
        const box = el('div', { className: 'empty-state' });
        box.appendChild(el('h3', { textContent: 'No scores yet' }));
        box.appendChild(el('p', {
          textContent: currentScope === 'hunt'
            ? 'No one has scored in this hunt yet. Be the first!'
            : 'No students have earned points yet. Scan a QR code to get started.'
        }));
        root.appendChild(box);
        return;
      }

      // Table
      const max = cfg.LEADERBOARD.MAX_ROWS_RENDERED || 200;
      const shown = currentRows.slice(0, max);

      const wrap = el('div', { className: 'table-wrap' });
      const table = el('table');
      const thead = el('thead');
      const hr = el('tr');
      hr.appendChild(el('th', { textContent: 'Rank', style: { width: '70px' } }));
      hr.appendChild(el('th', { textContent: 'Student' }));
      hr.appendChild(el('th', { textContent: 'Class' }));
      hr.appendChild(el('th', { textContent: 'Points', className: 'numeric' }));
      hr.appendChild(el('th', { textContent: 'Challenges', className: 'numeric' }));
      thead.appendChild(hr);
      table.appendChild(thead);

      const tbody = el('tbody');
      shown.forEach(function (row) {
        const tr = el('tr');
        const rankTd = el('td');
        rankTd.appendChild(el('span', {
          className: rankClass(row.rank),
          textContent: String(num(row.rank) || '\u2014')
        }));
        tr.appendChild(rankTd);
        tr.appendChild(el('td', { textContent: row.displayName || 'Student', style: { fontWeight: '600' } }));
        tr.appendChild(el('td', { className: 'muted', textContent: row.className || '\u2014' }));
        tr.appendChild(el('td', {
          className: 'numeric',
          textContent: num(row.totalPoints).toLocaleString(),
          style: { fontWeight: '600', color: '#178a48' }
        }));
        tr.appendChild(el('td', {
          className: 'numeric',
          textContent: String(num(row.challengesCompleted))
        }));
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
      root.appendChild(wrap);

      if (currentRows.length > max) {
        root.appendChild(el('p', {
          className: 'muted',
          style: { fontSize: '.82rem', marginTop: '8px', textAlign: 'center' },
          textContent: 'Showing the top ' + max + ' of ' + currentRows.length + ' students.'
        }));
      }

      // Contextual note
      if (currentScope === 'hunt' && currentHuntId) {
        const hunt = hunts.find(function (h) { return String(h.huntId) === String(currentHuntId); });
        if (hunt) {
          root.appendChild(el('p', {
            className: 'muted',
            style: { fontSize: '.82rem', marginTop: '8px', textAlign: 'center' },
            textContent: 'Rankings for: ' + (hunt.name || 'Hunt')
          }));
        }
      }
    }

    /* ---------- Init ---------- */
    render();
    await preloadFilters();
    if (!mounted) return;
    fetchLeaderboard({});
    restartPoll();

    /* ---------- Cleanup ---------- */
    ctx.onCleanup(function () {
      mounted = false;
      clearPoll();
    });
  }

  /* =========================================================
     VIEW: student.leaderboard
     ========================================================= */
  function renderStudentLeaderboard(container, ctx) {
    return renderLeaderboardView(container, ctx, false);
  }

  /* =========================================================
     VIEW: teacher.leaderboards
     ========================================================= */
  function renderTeacherLeaderboards(container, ctx) {
    return renderLeaderboardView(container, ctx, true);
  }

  /* =========================================================
     REGISTER
     ========================================================= */
  window.APP.views.renderStudentLeaderboard  = renderStudentLeaderboard;
  window.APP.views.renderTeacherLeaderboards = renderTeacherLeaderboards;
})();
