/* =========================================================
   TREASURE HUNT APP — dashboard.js
   ---------------------------------------------------------
   Student views:
     renderStudentHome         (student.home)
     renderStudentHunts        (student.hunts — list + ?huntId= detail)
     renderStudentProgress     (student.progress)
     renderStudentAchievements (student.achievements)
     renderStudentProfile      (student.profile)

   Data (all via APP.api, all server-derived):
     getStudentDashboard()  → home
     getTreasureHunts()     → hunts list
     getHunt(huntId)        → hunt detail
     getMyProgress()        → progress
     getMyAchievements()    → achievements
     getMyProfile()         → profile
     updateMyProfile(name)  → profile save

   Profile save effect:
     APP.api.updateMyProfile(name)
       → APP.auth.updateUser({...user, displayName: name})
         → 'app:auth-changed' (reason: 'profile-updated')
           → app.js showAppShell(user) — sidebar chip refreshes
       → APP.app.refresh() — current view re-renders with new name

   Attempting a challenge requires scanning its QR code by design;
   the hunt view is a checklist / progress overview, not a launchpad.
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

  function num(n) {
    const v = Number(n);
    return isNaN(v) ? 0 : v;
  }

  function safeMsg(err) {
    const a = api();
    return a && a.safeMessage ? a.safeMessage(err) : ((err && err.message) || 'Something went wrong.');
  }

  /* ============================ STATE RENDERERS ============================ */

  function renderLoadingState(container, message) {
    container.innerHTML = '';
    const box = el('div', { className: 'empty-state' });
    box.appendChild(el('div', { className: 'spinner', style: { margin: '0 auto 12px' } }));
    box.appendChild(el('p', { textContent: message || 'Loading\u2026' }));
    container.appendChild(box);
  }

  function renderErrorState(container, title, message, onRetry) {
    container.innerHTML = '';
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
    container.appendChild(card);
  }

  function renderEmptyState(container, title, message, ctaLabel, onCta) {
    container.innerHTML = '';
    const box = el('div', { className: 'empty-state' });
    box.appendChild(el('h3', { textContent: title || 'Nothing here yet' }));
    if (message) box.appendChild(el('p', { textContent: message }));
    if (ctaLabel && typeof onCta === 'function') {
      box.appendChild(el('button', {
        type: 'button',
        className: 'btn btn-primary',
        textContent: ctaLabel,
        style: { marginTop: '12px' },
        onClick: onCta
      }));
    }
    container.appendChild(box);
  }

  /* ============================ SHARED COMPONENTS ============================ */

  function statCard(opts) {
    const card = el('div', { className: 'stat-card' + (opts.accent ? ' accent' : '') });
    card.appendChild(el('div', { className: 'stat-label', textContent: opts.label || '' }));
    card.appendChild(el('div', { className: 'stat-value', textContent: String(opts.value != null ? opts.value : '') }));
    if (opts.sub) card.appendChild(el('div', { className: 'stat-sub', textContent: opts.sub }));
    return card;
  }

  function progressBar(percent, cls) {
    const p = Math.max(0, Math.min(100, Math.round(num(percent))));
    const wrap = el('div', { className: 'progress' });
    const fill = el('div', { className: 'progress-bar' + (cls ? ' ' + cls : '') });
    fill.style.width = p + '%';
    wrap.appendChild(fill);
    return wrap;
  }

  function rankLabel(rank) {
    const r = num(rank);
    if (!r) return '\u2014';
    const s = (r % 100 >= 11 && r % 100 <= 13) ? 'th'
            : (r % 10 === 1) ? 'st'
            : (r % 10 === 2) ? 'nd'
            : (r % 10 === 3) ? 'rd' : 'th';
    return r + s;
  }

  function huntProgressCard(hunt, onClick) {
    const card = el('div', { className: 'hunt-card clickable' });
    card.appendChild(el('h3', { textContent: hunt.name || 'Treasure Hunt' }));
    if (hunt.description) {
      card.appendChild(el('p', { className: 'hunt-desc', textContent: hunt.description }));
    }
    const pct = num(hunt.percent);
    const row = el('div', { className: 'progress-row' });
    row.appendChild(el('span', { textContent: num(hunt.completed || hunt.completedChallenges) + ' of ' + num(hunt.total || hunt.totalChallenges) + ' challenges' }));
    row.appendChild(el('span', { textContent: pct + '%' }));
    card.appendChild(row);
    card.appendChild(progressBar(pct));
    if (hunt.earnedPoints != null && hunt.maxPoints != null) {
      card.appendChild(el('div', {
        className: 'muted',
        style: { fontSize: '.82rem', marginTop: '8px' },
        textContent: num(hunt.earnedPoints) + ' / ' + num(hunt.maxPoints) + ' points'
      }));
    }
    if (typeof onClick === 'function') card.addEventListener('click', onClick);
    return card;
  }

  function activityList(items, emptyText) {
    if (!items || !items.length) {
      return el('p', { className: 'muted', textContent: emptyText || 'No activity yet.' });
    }
    const list = el('ul', { className: 'activity-list' });
    items.forEach(function (a) {
      const li = el('li');
      const left = el('div');
      left.appendChild(el('div', { textContent: a.challengeName || a.name || 'Challenge' }));
      if (a.time) {
        left.appendChild(el('div', { className: 'act-meta', textContent: window.APP.ui.relativeTime(a.time) }));
      }
      li.appendChild(left);
      if (a.points != null) {
        li.appendChild(el('span', {
          className: 'badge badge-green',
          textContent: '+' + num(a.points) + ' pts'
        }));
      }
      list.appendChild(li);
    });
    return list;
  }

  /* =========================================================
     VIEW: student.home
     ========================================================= */
  async function renderStudentHome(container, ctx) {
    renderLoadingState(container, 'Loading your dashboard\u2026');

    let data;
    try {
      data = await api().getStudentDashboard();
    } catch (err) {
      if (api().isAuthError && api().isAuthError(err)) return;
      renderErrorState(
        container,
        'Could not load dashboard',
        safeMsg(err),
        function () { renderStudentHome(container, ctx); }
      );
      return;
    }
    if (!data) {
      renderErrorState(container, 'No data', 'Dashboard is empty.', function () { renderStudentHome(container, ctx); });
      return;
    }

    container.innerHTML = '';

    /* ---- Stats ---- */
    const studentName = (data.student && data.student.displayName) ? data.student.displayName : 'Student';
    const header = el('div', { style: { marginBottom: '16px' } });
    header.appendChild(el('h2', { textContent: 'Welcome back, ' + studentName, style: { margin: '0 0 4px' } }));
    if (data.student && data.student.className) {
      header.appendChild(el('p', { className: 'muted', textContent: data.student.className, style: { margin: '0' } }));
    }
    container.appendChild(header);

    const statGrid = el('div', { className: 'stat-grid' });
    statGrid.appendChild(statCard({ label: 'Total Points', value: num(data.totalPoints), accent: true }));
    statGrid.appendChild(statCard({ label: 'Challenges Completed', value: num(data.challengesCompleted) }));
    statGrid.appendChild(statCard({ label: 'Challenges Remaining', value: num(data.challengesRemaining) }));
    statGrid.appendChild(statCard({
      label: 'Current Class Rank',
      value: rankLabel(data.classRank),
      sub: 'School rank: ' + rankLabel(data.schoolRank)
    }));
    container.appendChild(statGrid);

    /* ---- Hunts progress ---- */
    const huntsSection = el('div', { style: { marginBottom: '24px' } });
    huntsSection.appendChild(el('div', { className: 'section-title', textContent: 'Your Treasure Hunts' }));

    if (data.hunts && data.hunts.length) {
      const grid = el('div', { className: 'grid grid-2' });
      data.hunts.forEach(function (h) {
        const card = huntProgressCard(h, function () {
          ctx.navigate('student.hunts', { huntId: h.huntId });
        });
        grid.appendChild(card);
      });
      huntsSection.appendChild(grid);
    } else {
      const box = el('div', { className: 'empty-state' });
      box.appendChild(el('h3', { textContent: 'No active treasure hunts' }));
      box.appendChild(el('p', { textContent: 'Your teacher has not published a hunt for your class yet.' }));
      huntsSection.appendChild(box);
    }
    container.appendChild(huntsSection);

    /* ---- Recent results + activity ---- */
    const bottomGrid = el('div', { className: 'grid grid-2' });

    const resultsCard = el('div', { className: 'card' });
    const resultsHeader = el('div', { className: 'card-header' });
    resultsHeader.appendChild(el('h3', { textContent: 'Recent Quiz Results' }));
    resultsCard.appendChild(resultsHeader);
    const resultsBody = el('div', { className: 'card-body' });
    if (data.recentResults && data.recentResults.length) {
      const ul = el('ul', { className: 'activity-list' });
      data.recentResults.forEach(function (r) {
        const li = el('li');
        const left = el('div');
        left.appendChild(el('div', { textContent: r.challengeName || 'Challenge' }));
        left.appendChild(el('div', {
          className: 'act-meta',
          textContent: num(r.score) + ' / ' + num(r.maxScore) + ' \u00b7 ' + window.APP.ui.relativeTime(r.submittedAt)
        }));
        li.appendChild(left);
        li.appendChild(el('span', {
          className: 'badge ' + (r.passed ? 'badge-green' : 'badge-red'),
          textContent: r.passed ? 'Passed' : 'Failed'
        }));
        ul.appendChild(li);
      });
      resultsBody.appendChild(ul);
    } else {
      resultsBody.appendChild(el('p', { className: 'muted', textContent: 'No quiz results yet.' }));
    }
    resultsCard.appendChild(resultsBody);
    bottomGrid.appendChild(resultsCard);

    const activityCard = el('div', { className: 'card' });
    const activityHeader = el('div', { className: 'card-header' });
    activityHeader.appendChild(el('h3', { textContent: 'Recent Activity' }));
    activityCard.appendChild(activityHeader);
    const activityBody = el('div', { className: 'card-body' });
    activityBody.appendChild(activityList(data.recentActivity, 'No points earned yet. Scan a QR code to get started.'));
    activityCard.appendChild(activityBody);
    bottomGrid.appendChild(activityCard);

    container.appendChild(bottomGrid);
  }

  /* =========================================================
     VIEW: student.hunts  (list OR detail via ?huntId=)
     ========================================================= */
  async function renderStudentHunts(container, ctx) {
    const huntId = (ctx.params && ctx.params.huntId) || '';
    if (huntId) {
      return renderHuntDetail(container, ctx, huntId);
    }
    return renderHuntsList(container, ctx);
  }

  async function renderHuntsList(container, ctx) {
    renderLoadingState(container, 'Loading treasure hunts\u2026');

    let hunts;
    try {
      hunts = await api().getTreasureHunts();
    } catch (err) {
      if (api().isAuthError && api().isAuthError(err)) return;
      renderErrorState(container, 'Could not load treasure hunts', safeMsg(err),
        function () { renderHuntsList(container, ctx); });
      return;
    }

    if (!hunts || !hunts.length) {
      renderEmptyState(container,
        'No active treasure hunts',
        'Your teacher has not published a hunt for your class yet. Check back later.'
      );
      return;
    }

    container.innerHTML = '';
    container.appendChild(el('p', {
      className: 'muted',
      textContent: 'Tap a hunt to see its challenges.',
      style: { marginBottom: '14px' }
    }));

    const grid = el('div', { className: 'grid grid-2' });
    hunts.forEach(function (h) {
      grid.appendChild(huntProgressCard(h, function () {
        ctx.navigate('student.hunts', { huntId: h.huntId });
      }));
    });
    container.appendChild(grid);
  }

  async function renderHuntDetail(container, ctx, huntId) {
    renderLoadingState(container, 'Loading hunt\u2026');

    let data;
    try {
      data = await api().getHunt(huntId);
    } catch (err) {
      if (api().isAuthError && api().isAuthError(err)) return;
      renderErrorState(container, 'Could not load hunt', safeMsg(err),
        function () { renderHuntDetail(container, ctx, huntId); });
      return;
    }

    if (!data || !data.hunt) {
      renderErrorState(container, 'Hunt not found', 'This hunt is no longer available.',
        function () { ctx.navigate('student.hunts'); });
      return;
    }

    container.innerHTML = '';

    /* ---- Back button ---- */
    const back = el('button', {
      type: 'button',
      className: 'btn btn-outline btn-sm',
      textContent: '\u2190 Back to hunts',
      onClick: function () { ctx.navigate('student.hunts'); }
    });
    back.style.marginBottom = '14px';
    container.appendChild(back);

    /* ---- Hunt header ---- */
    const head = el('div', { className: 'card', style: { marginBottom: '16px' } });
    const headBody = el('div', { className: 'card-body' });
    headBody.appendChild(el('h2', { textContent: data.hunt.name || 'Treasure Hunt', style: { marginBottom: '6px' } }));
    if (data.hunt.description) {
      headBody.appendChild(el('p', { className: 'text-soft', textContent: data.hunt.description }));
    }
    if (data.hunt.instructions) {
      const box = el('div', {
        style: {
          background: '#f4f6f9',
          borderLeft: '3px solid #1f9d55',
          padding: '10px 14px',
          marginTop: '10px',
          borderRadius: '6px'
        }
      });
      box.appendChild(el('div', {
        style: { fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.05em', color: '#64748b', fontWeight: '600', marginBottom: '4px' },
        textContent: 'Instructions'
      }));
      box.appendChild(el('div', { textContent: data.hunt.instructions, style: { fontSize: '.9rem' } }));
      headBody.appendChild(box);
    }
    const dateRow = el('div', { className: 'muted', style: { fontSize: '.82rem', marginTop: '10px', display: 'flex', gap: '12px', flexWrap: 'wrap' } });
    if (data.hunt.startDate) dateRow.appendChild(el('span', { textContent: 'Starts ' + window.APP.ui.formatDate(data.hunt.startDate) }));
    if (data.hunt.endDate)   dateRow.appendChild(el('span', { textContent: 'Ends ' + window.APP.ui.formatDate(data.hunt.endDate) }));
    if (dateRow.childNodes.length) headBody.appendChild(dateRow);
    head.appendChild(headBody);
    container.appendChild(head);

    /* ---- Challenge checklist ---- */
    const listCard = el('div', { className: 'card' });
    const listHeader = el('div', { className: 'card-header' });
    const challenges = data.challenges || [];
    const doneCount = challenges.filter(function (c) { return c.completed; }).length;
    listHeader.appendChild(el('h3', { textContent: 'Challenges' }));
    listHeader.appendChild(el('span', {
      className: 'badge badge-grey',
      textContent: doneCount + ' / ' + challenges.length + ' completed'
    }));
    listCard.appendChild(listHeader);

    const listBody = el('div', { className: 'card-body' });

    if (!challenges.length) {
      listBody.appendChild(el('p', { className: 'muted', textContent: 'No challenges in this hunt yet.' }));
    } else {
      challenges.forEach(function (c, idx) {
        const row = el('div', {
          style: {
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
            padding: '12px 0',
            borderBottom: idx < challenges.length - 1 ? '1px solid #e2e8f0' : 'none'
          }
        });
        const marker = el('div', {
          style: {
            width: '28px',
            height: '28px',
            borderRadius: '50%',
            background: c.completed ? '#1f9d55' : '#eef1f5',
            color: c.completed ? '#fff' : '#64748b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: '700',
            flexShrink: '0',
            fontSize: '.85rem'
          },
          textContent: c.completed ? '\u2713' : String(num(c.order) || (idx + 1))
        });
        row.appendChild(marker);

        const mid = el('div', { style: { flex: '1', minWidth: '0' } });
        mid.appendChild(el('div', { textContent: c.name || 'Challenge', style: { fontWeight: '600', color: '#0f2a44' } }));
        if (c.description) {
          mid.appendChild(el('div', { className: 'muted', textContent: c.description, style: { fontSize: '.85rem', marginTop: '2px' } }));
        }
        row.appendChild(mid);

        const right = el('div', { style: { textAlign: 'right', flexShrink: '0' } });
        right.appendChild(el('div', {
          className: 'badge ' + (c.completed ? 'badge-green' : 'badge-gold'),
          textContent: num(c.maxPoints) + ' pts'
        }));
        if (c.passingPercent) {
          right.appendChild(el('div', {
            className: 'muted',
            style: { fontSize: '.75rem', marginTop: '4px' },
            textContent: 'Pass ' + num(c.passingPercent) + '%'
          }));
        }
        row.appendChild(right);

        listBody.appendChild(row);
      });

      const hint = el('div', {
        style: {
          marginTop: '14px',
          padding: '10px 14px',
          background: '#e6f5ec',
          borderRadius: '8px',
          fontSize: '.85rem',
          color: '#178a48'
        }
      });
      hint.appendChild(el('strong', { textContent: 'How to start: ' }));
      hint.appendChild(document.createTextNode(
        'Find each challenge\u2019s QR code around school and scan it with the app.'
      ));
      listBody.appendChild(hint);

      const scanBtn = el('button', {
        type: 'button',
        className: 'btn btn-primary',
        textContent: 'Open scanner',
        style: { marginTop: '10px' },
        onClick: function () { ctx.navigate('student.scan'); }
      });
      listBody.appendChild(scanBtn);
    }

    listCard.appendChild(listBody);
    container.appendChild(listCard);
  }

  /* =========================================================
     VIEW: student.progress
     ========================================================= */
  async function renderStudentProgress(container, ctx) {
    renderLoadingState(container, 'Loading your progress\u2026');

    let data;
    try {
      data = await api().getMyProgress();
    } catch (err) {
      if (api().isAuthError && api().isAuthError(err)) return;
      renderErrorState(container, 'Could not load progress', safeMsg(err),
        function () { renderStudentProgress(container, ctx); });
      return;
    }

    const hunts = (data && data.hunts) || [];
    if (!hunts.length) {
      renderEmptyState(container,
        'No progress yet',
        'Once you complete challenges, your progress will appear here.',
        'Open scanner',
        function () { ctx.navigate('student.scan'); }
      );
      return;
    }

    container.innerHTML = '';
    container.appendChild(el('h2', { textContent: 'My Progress', style: { marginBottom: '4px' } }));
    container.appendChild(el('p', {
      className: 'muted',
      textContent: 'Your challenge-by-challenge breakdown across every hunt.',
      style: { marginBottom: '16px' }
    }));

    hunts.forEach(function (hunt) {
      const card = el('div', { className: 'card', style: { marginBottom: '16px' } });
      const header = el('div', { className: 'card-header' });
      const titleWrap = el('div');
      titleWrap.appendChild(el('h3', { textContent: hunt.name || 'Treasure Hunt', style: { margin: '0' } }));
      if (hunt.maxPoints) {
        titleWrap.appendChild(el('div', {
          className: 'muted',
          style: { fontSize: '.82rem', marginTop: '2px' },
          textContent: num(hunt.earnedPoints) + ' / ' + num(hunt.maxPoints) + ' points'
        }));
      }
      header.appendChild(titleWrap);
      const total = (hunt.challenges || []).length;
      const done = (hunt.challenges || []).filter(function (c) { return c.completed; }).length;
      header.appendChild(el('span', {
        className: 'badge ' + (done === total && total > 0 ? 'badge-green' : 'badge-grey'),
        textContent: done + ' / ' + total
      }));
      card.appendChild(header);

      const body = el('div', { className: 'card-body' });
      const pct = total ? Math.round((done / total) * 100) : 0;
      body.appendChild(progressBar(pct));
      body.appendChild(el('div', { className: 'muted', style: { fontSize: '.8rem', margin: '4px 0 12px' }, textContent: pct + '% complete' }));

      (hunt.challenges || []).forEach(function (c) {
        const row = el('div', {
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '8px 0',
            borderTop: '1px solid #eef1f5'
          }
        });
        const left = el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', minWidth: '0' } });
        left.appendChild(el('span', {
          textContent: c.completed ? '\u2713' : '\u25cb',
          style: {
            color: c.completed ? '#1f9d55' : '#94a3b8',
            fontWeight: '700',
            flexShrink: '0'
          }
        }));
        left.appendChild(el('span', { textContent: c.name || 'Challenge', style: { fontWeight: '500' } }));
        row.appendChild(left);
        row.appendChild(el('span', {
          className: 'badge ' + (c.completed ? 'badge-green' : 'badge-grey'),
          textContent: num(c.maxPoints) + ' pts'
        }));
        body.appendChild(row);
      });

      card.appendChild(body);
      container.appendChild(card);
    });
  }

  /* =========================================================
     VIEW: student.achievements
     ========================================================= */
  async function renderStudentAchievements(container, ctx) {
    renderLoadingState(container, 'Loading achievements\u2026');

    let data;
    try {
      data = await api().getMyAchievements();
    } catch (err) {
      if (api().isAuthError && api().isAuthError(err)) return;
      renderErrorState(container, 'Could not load achievements', safeMsg(err),
        function () { renderStudentAchievements(container, ctx); });
      return;
    }

    const badges = (data && data.badges) || [];
    const earnedCount = badges.filter(function (b) { return b.earned; }).length;

    container.innerHTML = '';
    container.appendChild(el('h2', { textContent: 'Achievements', style: { marginBottom: '4px' } }));
    container.appendChild(el('p', {
      className: 'muted',
      textContent: 'Earn badges as you complete challenges and score points.',
      style: { marginBottom: '16px' }
    }));

    /* ---- Summary ---- */
    const summary = el('div', { className: 'stat-grid', style: { marginBottom: '20px' } });
    summary.appendChild(statCard({ label: 'Total Points', value: num(data.points), accent: true }));
    summary.appendChild(statCard({ label: 'Challenges Completed', value: num(data.completions) }));
    summary.appendChild(statCard({ label: 'Badges Earned', value: earnedCount + ' / ' + badges.length }));
    container.appendChild(summary);

    /* ---- Next badge ---- */
    if (data.nextBadge) {
      const next = el('div', {
        className: 'card',
        style: { marginBottom: '20px', background: '#fbf3dd', borderColor: '#f0dfa8' }
      });
      const body = el('div', { className: 'card-body' });
      body.appendChild(el('div', {
        style: { fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.05em', color: '#b7791f', fontWeight: '700', marginBottom: '4px' },
        textContent: 'Next badge'
      }));
      body.appendChild(el('h3', { textContent: data.nextBadge.name, style: { marginBottom: '6px', color: '#7a5a00' } }));
      body.appendChild(el('p', {
        className: 'muted',
        style: { margin: '0', color: '#7a5a00' },
        textContent: num(data.nextBadge.remaining) + ' more to go (target ' + num(data.nextBadge.target) + ')'
      }));
      next.appendChild(body);
      container.appendChild(next);
    }

    /* ---- Badge grid ---- */
    const grid = el('div', { className: 'badge-grid' });
    badges.forEach(function (b) {
      const card = el('div', {
        className: 'badge-card ' + (b.earned ? 'earned' : 'locked')
      });
      const icon = el('div', { className: 'badge-icon' });
      icon.textContent = b.earned ? '\u2605' : '\u25cb';
      card.appendChild(icon);
      card.appendChild(el('h4', { textContent: b.name || 'Badge' }));
      card.appendChild(el('p', { textContent: b.description || '' }));
      const pct = (num(b.target) > 0) ? Math.round((num(b.progress) / num(b.target)) * 100) : 0;
      card.appendChild(progressBar(pct, b.earned ? '' : 'gold'));
      card.appendChild(el('div', {
        className: 'muted',
        style: { fontSize: '.75rem', marginTop: '6px' },
        textContent: num(b.progress) + ' / ' + num(b.target)
      }));
      grid.appendChild(card);
    });
    container.appendChild(grid);
  }

  /* =========================================================
     VIEW: student.profile
     ========================================================= */
  async function renderStudentProfile(container, ctx) {
    renderLoadingState(container, 'Loading your profile\u2026');

    let profile;
    try {
      profile = await api().getMyProfile();
    } catch (err) {
      if (api().isAuthError && api().isAuthError(err)) return;
      renderErrorState(container, 'Could not load profile', safeMsg(err),
        function () { renderStudentProfile(container, ctx); });
      return;
    }

    container.innerHTML = '';
    container.appendChild(el('h2', { textContent: 'My Profile', style: { marginBottom: '4px' } }));
    container.appendChild(el('p', {
      className: 'muted',
      textContent: 'View and update your display name.',
      style: { marginBottom: '16px' }
    }));

    /* ---- Avatar card ---- */
    const avatarCard = el('div', { className: 'card', style: { marginBottom: '16px' } });
    const avatarBody = el('div', {
      className: 'card-body',
      style: { display: 'flex', alignItems: 'center', gap: '16px' }
    });
    const bigAvatar = el('div', {
      className: 'avatar',
      style: { width: '64px', height: '64px', fontSize: '1.5rem' }
    });
    bigAvatar.textContent = String(profile.displayName || '?').trim().charAt(0).toUpperCase() || '?';
    avatarBody.appendChild(bigAvatar);

    const idWrap = el('div', { style: { minWidth: '0' } });
    idWrap.appendChild(el('div', {
      style: { fontSize: '1.1rem', fontWeight: '600', color: '#0f2a44' },
      textContent: profile.displayName || 'Student'
    }));
    idWrap.appendChild(el('div', { className: 'muted', textContent: profile.email || '' }));
    if (profile.className) {
      idWrap.appendChild(el('div', {
        className: 'muted',
        style: { fontSize: '.82rem', marginTop: '2px' },
        textContent: 'Class: ' + profile.className
      }));
    }
    avatarBody.appendChild(idWrap);
    avatarCard.appendChild(avatarBody);
    container.appendChild(avatarCard);

    /* ---- Edit form ---- */
    const formCard = el('div', { className: 'card' });
    const formHeader = el('div', { className: 'card-header' });
    formHeader.appendChild(el('h3', { textContent: 'Edit display name' }));
    formCard.appendChild(formHeader);

    const formBody = el('div', { className: 'card-body' });
    const form = el('form', { className: 'form' });

    const nameLabel = el('label');
    nameLabel.appendChild(el('span', { textContent: 'Display name' }));
    const nameInput = el('input', {
      type: 'text',
      value: profile.displayName || '',
      maxlength: '60',
      required: 'required',
      autocomplete: 'off'
    });
    nameLabel.appendChild(nameInput);
    form.appendChild(nameLabel);

    const actions = el('div', { className: 'form-actions' });
    const saveBtn = el('button', {
      type: 'submit',
      className: 'btn btn-primary',
      textContent: 'Save changes'
    });
    actions.appendChild(saveBtn);
    form.appendChild(actions);

    const errorEl = el('div', { className: 'error-text hidden' });
    form.appendChild(errorEl);

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      errorEl.classList.add('hidden');
      errorEl.textContent = '';

      const newName = String(nameInput.value || '').trim();
      if (!newName || newName.length > 60) {
        errorEl.textContent = 'Display name must be 1\u201360 characters.';
        errorEl.classList.remove('hidden');
        return;
      }
      if (newName === profile.displayName) {
        toast('No changes to save.', 'warn', 2000);
        return;
      }

      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="spinner-sm"></span>Saving\u2026';

      try {
        await api().updateMyProfile(newName);

        // Update local auth state so the sidebar chip refreshes
        const currentUser = window.APP.auth.getUser() || {};
        window.APP.auth.updateUser(Object.assign({}, currentUser, { displayName: newName }));

        toast('Display name updated.', 'success', 2200);
        // Re-render this view so the new name is reflected
        if (window.APP.app && typeof window.APP.app.refresh === 'function') {
          window.APP.app.refresh();
        }
      } catch (err) {
        if (api().isAuthError && api().isAuthError(err)) return;
        errorEl.textContent = safeMsg(err);
        errorEl.classList.remove('hidden');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save changes';
      }
    });

    formBody.appendChild(form);

    /* ---- Info note ---- */
    const note = el('p', {
      className: 'muted',
      style: { marginTop: '14px', fontSize: '.85rem' },
      textContent: 'Contact your teacher or administrator to change your email, class, or password.'
    });
    formBody.appendChild(note);

    formCard.appendChild(formBody);
    container.appendChild(formCard);
  }

  /* =========================================================
     REGISTER
     ========================================================= */
  window.APP.views.renderStudentHome         = renderStudentHome;
  window.APP.views.renderStudentHunts        = renderStudentHunts;
  window.APP.views.renderStudentProgress     = renderStudentProgress;
  window.APP.views.renderStudentAchievements = renderStudentAchievements;
  window.APP.views.renderStudentProfile      = renderStudentProfile;
})();
