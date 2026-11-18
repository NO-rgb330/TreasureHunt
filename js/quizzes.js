/* =========================================================
   TREASURE HUNT APP — quizzes.js
   ---------------------------------------------------------
   View: student.quiz  →  APP.views.renderStudentQuiz

   Reached via:
     ctx.navigate('student.quiz', { challengeId: 'ch_...' })
   from the QR scanner ("Start quiz") or a hunt's challenge card.

   Backend contract (backend/Code.gs):
     getQuizForStudent(challengeId)
       → { quiz:{ quizId,title,description,timeLimitMinutes,passingPercent },
           questions:[{ questionId,type,text,options[],marks,order }] }

     submitQuiz(challengeId, answers, submissionId)
       → { submissionId, score, maxScore, percent?, passed,
           pointsAwarded, passingPercent?, alreadyProcessed? }

   Idempotency:
     submissionId is generated ONCE per attempt. Retries of the
     same attempt reuse the SAME id → backend returns cached
     result and does not double-award points. "Try again" after
     a failed attempt generates a NEW id (a genuinely new attempt).

   Scoring:
     Never computed client-side. All numbers rendered come from the
     server response. Client cannot award points by design.

   Cleanup:
     ctx.onCleanup clears the countdown interval and marks the
     view unmounted so in-flight promises stop touching the DOM.
   ========================================================= */

window.APP = window.APP || {};
window.APP.views = window.APP.views || {};

(function () {
  'use strict';

  const cfg = window.APP.config;

  /* ---------------------------------------------------------
     Small helpers (delegate to APP.ui when available)
     --------------------------------------------------------- */
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

  /* ---------------------------------------------------------
     Question normalisation
     --------------------------------------------------------- */
  function questionOptions(q) {
    const opts = Array.isArray(q.options) ? q.options.slice() : [];
    const type = String(q.type || 'mc').toLowerCase();
    if (type === 'tf' && opts.length < 2) return ['True', 'False'];
    return opts.map(function (o) { return String(o); });
  }

  function formatRemaining(secs) {
    const s = Math.max(0, Math.floor(secs));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  /* =========================================================
     VIEW
     ========================================================= */
  function renderStudentQuiz(container, ctx) {
    container.innerHTML = '';
    const api = window.APP.api;

    const challengeId = (ctx.params && ctx.params.challengeId) || '';
    if (!challengeId) {
      renderFatal(
        'No challenge selected',
        'Open a challenge from the scanner or your treasure hunts.',
        'Back to scanner',
        function () { ctx.navigate('student.scan'); }
      );
      return;
    }

    /* ---------- State ---------- */
    let submissionId = api.generateSubmissionId();
    let quizData = null;
    let answers = {};              // { [questionId]: number }
    let phase = 'loading';         // loading | answering | submitting | result
    let timerInterval = null;
    let remainingSeconds = 0;
    let submitError = '';
    let mounted = true;

    /* ---------- Timer helpers ---------- */
    function clearTimers() {
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
    }

    function updateTimerDisplay() {
      const node = container.querySelector('[data-quiz-timer]');
      if (!node) return;
      node.textContent = formatRemaining(remainingSeconds);
      if (remainingSeconds <= (cfg.QUIZ.WARN_SECONDS_REMAINING || 30)) {
        node.style.color = '#d64545';
      }
    }

    function maybeStartTimer() {
      if (timerInterval) return;
      if (!quizData) return;
      if (phase !== 'answering') return;
      const totalMin = Number(quizData.quiz.timeLimitMinutes || 0);
      if (!(totalMin > 0)) return;
      if (remainingSeconds <= 0) return;

      timerInterval = setInterval(function () {
        if (!mounted) { clearTimers(); return; }
        remainingSeconds -= 1;
        updateTimerDisplay();
        if (remainingSeconds <= 0) {
          clearTimers();
          toast('Time is up. Submitting your answers\u2026', 'warn', 3000);
          if (cfg.QUIZ.AUTO_SUBMIT_ON_TIMEOUT) {
            doSubmit();
          }
        } else if (remainingSeconds === (cfg.QUIZ.WARN_SECONDS_REMAINING || 30)) {
          toast(remainingSeconds + ' seconds remaining', 'warn', 2500);
        }
      }, 1000);
    }

    /* ---------- Screens ---------- */
    function renderLoading() {
      container.innerHTML = '';
      const box = el('div', { className: 'empty-state' });
      box.appendChild(el('div', { className: 'spinner', style: { margin: '0 auto 12px' } }));
      box.appendChild(el('p', { textContent: 'Loading quiz\u2026' }));
      container.appendChild(box);
    }

    function renderFatal(title, message, backLabel, onBack) {
      container.innerHTML = '';
      const card = el('div', { className: 'card' });
      const body = el('div', { className: 'card-body', style: { textAlign: 'center', padding: '36px 24px' } });
      body.appendChild(el('h3', { textContent: title || 'Something went wrong' }));
      body.appendChild(el('p', { className: 'muted', textContent: message || '' }));
      if (backLabel && typeof onBack === 'function') {
        body.appendChild(el('button', {
          type: 'button',
          className: 'btn btn-primary',
          textContent: backLabel,
          onClick: onBack
        }));
      }
      card.appendChild(body);
      container.appendChild(card);
    }

    /* ---------- Load ---------- */
    async function load() {
      try {
        const data = await api.getQuizForStudent(challengeId);
        if (!mounted) return;
        if (!data || !data.quiz || !Array.isArray(data.questions) || !data.questions.length) {
          throw new Error('This quiz is not available right now.');
        }
        quizData = data;
        startAttempt();
      } catch (err) {
        if (!mounted) return;
        if (api.isAuthError && api.isAuthError(err)) return;
        const msg = api.safeMessage ? api.safeMessage(err) : 'Could not load quiz.';
        renderFatal(
          'Could not load quiz',
          msg,
          'Back to scanner',
          function () { ctx.navigate('student.scan'); }
        );
      }
    }

    /* ---------- Attempt lifecycle ---------- */
    function startAttempt() {
      clearTimers();
      answers = {};
      submitError = '';
      submissionId = api.generateSubmissionId();
      phase = 'answering';

      const totalMin = Number(quizData.quiz.timeLimitMinutes || 0);
      remainingSeconds = totalMin > 0 ? totalMin * 60 : 0;

      renderQuiz();
      maybeStartTimer();
    }

    /* ---------- Quiz UI ---------- */
    function renderQuiz() {
      container.innerHTML = '';

      /* --- Header --- */
      const header = el('div', { className: 'quiz-header' });
      header.appendChild(el('h2', { textContent: quizData.quiz.title || 'Quiz' }));
      if (quizData.quiz.description) {
        header.appendChild(el('p', { className: 'text-soft', textContent: quizData.quiz.description }));
      }

      const meta = el('div', { className: 'quiz-meta' });
      const qCount = quizData.questions.length;
      meta.appendChild(el('span', {
        textContent: qCount + ' question' + (qCount === 1 ? '' : 's')
      }));
      const totalMarks = quizData.questions.reduce(function (s, q) {
        return s + (Number(q.marks) || 1);
      }, 0);
      meta.appendChild(el('span', { textContent: totalMarks + ' total marks' }));

      if (quizData.quiz.passingPercent != null && quizData.quiz.passingPercent !== '') {
        meta.appendChild(el('span', {
          textContent: 'Pass at ' + Number(quizData.quiz.passingPercent) + '%'
        }));
      }
      if (Number(quizData.quiz.timeLimitMinutes) > 0) {
        const tSpan = el('span');
        tSpan.appendChild(document.createTextNode('Time: '));
        const tValue = el('span', {
          'data-quiz-timer': '1',
          textContent: formatRemaining(remainingSeconds)
        });
        tValue.style.fontWeight = '700';
        if (remainingSeconds <= (cfg.QUIZ.WARN_SECONDS_REMAINING || 30)) {
          tValue.style.color = '#d64545';
        }
        tSpan.appendChild(tValue);
        meta.appendChild(tSpan);
      }
      header.appendChild(meta);
      container.appendChild(header);

      /* --- Questions --- */
      quizData.questions.forEach(function (q, idx) {
        container.appendChild(renderQuestion(q, idx));
      });

      /* --- Submission error banner --- */
      if (submitError) {
        const banner = el('div', {
          className: 'card',
          style: { borderColor: '#d64545', background: '#fdecec', marginTop: '16px' }
        });
        const body = el('div', { className: 'card-body', style: { color: '#d64545' } });
        body.appendChild(el('p', { textContent: submitError, style: { margin: '0' } }));
        banner.appendChild(body);
        container.appendChild(banner);
      }

      /* --- Submit bar --- */
      const submitBar = el('div', { className: 'card', style: { marginTop: '16px' } });
      const submitBody = el('div', {
        className: 'card-body',
        style: {
          display: 'flex',
          gap: '12px',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap'
        }
      });

      const progress = el('div', { className: 'muted', 'data-quiz-progress': '1' });
      updateProgressText(progress);
      submitBody.appendChild(progress);

      const submitBtn = el('button', {
        type: 'button',
        className: 'btn btn-primary btn-lg',
        textContent: 'Submit answers'
      });
      if (phase === 'submitting') {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner-sm"></span>Submitting\u2026';
      }
      submitBtn.addEventListener('click', confirmAndSubmit);
      submitBody.appendChild(submitBtn);

      submitBar.appendChild(submitBody);
      container.appendChild(submitBar);

      updateAllProgress();
    }

    function renderQuestion(q, idx) {
      const card = el('div', { className: 'quiz-question', 'data-qid': q.questionId });
      card.appendChild(el('div', { className: 'q-num', textContent: 'Question ' + (idx + 1) }));
      card.appendChild(el('div', { className: 'q-text', textContent: q.text || '' }));

      const opts = questionOptions(q);
      const optionsWrap = el('div', { className: 'quiz-options' });

      if (!opts.length) {
        optionsWrap.appendChild(el('p', {
          className: 'muted',
          textContent: 'This question cannot be displayed. Please contact your teacher.'
        }));
        card.appendChild(optionsWrap);
        return card;
      }

      const previouslySelected = answers[q.questionId];

      opts.forEach(function (opt, i) {
        const optId = 'opt_' + q.questionId + '_' + i;
        const label = el('label', { className: 'quiz-option', 'for': optId });
        const radio = el('input', {
          type: 'radio',
          id: optId,
          name: 'q_' + q.questionId,
          value: String(i)
        });
        if (previouslySelected !== undefined && Number(previouslySelected) === i) {
          radio.checked = true;
          label.classList.add('selected');
        }
        radio.addEventListener('change', function () {
          answers[q.questionId] = i;
          optionsWrap.querySelectorAll('.quiz-option').forEach(function (l) {
            l.classList.remove('selected');
          });
          label.classList.add('selected');
          updateAllProgress();
        });
        label.appendChild(radio);
        label.appendChild(el('span', { textContent: opt }));
        optionsWrap.appendChild(label);
      });

      card.appendChild(optionsWrap);
      return card;
    }

    function updateProgressText(node) {
      node = node || container.querySelector('[data-quiz-progress]');
      if (!node || !quizData) return;
      const total = quizData.questions.length;
      const answered = quizData.questions.filter(function (q) {
        return answers[q.questionId] !== undefined && answers[q.questionId] !== null;
      }).length;
      node.textContent = answered + ' of ' + total + ' answered';
    }
    function updateAllProgress() { updateProgressText(); }

    /* ---------- Submit ---------- */
    async function confirmAndSubmit() {
      if (phase === 'submitting' || !quizData) return;

      const total = quizData.questions.length;
      const answered = quizData.questions.filter(function (q) {
        return answers[q.questionId] !== undefined && answers[q.questionId] !== null;
      }).length;

      if (answered < total) {
        const unanswered = total - answered;
        const ok = (window.APP.ui && typeof window.APP.ui.confirm === 'function')
          ? await window.APP.ui.confirm(
              'You have ' + unanswered + ' unanswered question' + (unanswered === 1 ? '' : 's') + '. Submit anyway?',
              { title: 'Submit quiz?', confirmLabel: 'Submit', cancelLabel: 'Keep answering' }
            )
          : true;
        if (!ok) return;
      }

      doSubmit();
    }

    async function doSubmit() {
      if (phase === 'submitting' || !quizData) return;
      clearTimers();
      phase = 'submitting';
      submitError = '';
      renderQuiz();

      try {
        const result = await api.submitQuiz(challengeId, answers, submissionId);
        if (!mounted) return;
        phase = 'result';
        renderResult(result || {});
      } catch (err) {
        if (!mounted) return;
        if (api.isAuthError && api.isAuthError(err)) return;

        phase = 'answering';
        submitError = (api.isNetworkError && api.isNetworkError(err))
          ? 'Could not submit. Check your connection and try again. Your answers have been kept.'
          : (api.safeMessage ? api.safeMessage(err) : 'Could not submit your answers.');

        renderQuiz();
        maybeStartTimer();
      }
    }

    /* ---------- Result ---------- */
    function renderResult(result) {
      container.innerHTML = '';

      const pct = (result.percent != null)
        ? Math.round(Number(result.percent))
        : (Number(result.maxScore) > 0
            ? Math.round((Number(result.score) / Number(result.maxScore)) * 100)
            : 0);

      const passed = !!result.passed;
      const points = Number(result.pointsAwarded || 0);
      const already = !!result.alreadyProcessed;

      const card = el('div', { className: 'quiz-result' + (passed ? '' : ' failed') });
      card.appendChild(el('h2', { textContent: passed ? 'Well done!' : 'Not quite there yet' }));

      const scoreRow = el('div', { style: { margin: '16px 0' } });
      scoreRow.appendChild(el('div', {
        className: 'result-points',
        textContent: Number(result.score || 0) + ' / ' + Number(result.maxScore || 0)
      }));
      scoreRow.appendChild(el('div', { className: 'muted', textContent: pct + '%' }));
      card.appendChild(scoreRow);

      if (passed) {
        if (points > 0) {
          card.appendChild(el('div', {
            style: {
              display: 'inline-block',
              background: '#e6f5ec',
              color: '#1f9d55',
              padding: '10px 20px',
              borderRadius: '999px',
              fontWeight: '700',
              fontSize: '1.1rem',
              marginBottom: '16px'
            },
            textContent: '+' + points + ' points earned'
          }));
        } else if (already) {
          card.appendChild(el('p', {
            className: 'muted',
            textContent: 'Your score has been recorded.',
            style: { marginBottom: '16px' }
          }));
        } else {
          card.appendChild(el('p', {
            className: 'muted',
            textContent: 'You have already earned points for this challenge.',
            style: { marginBottom: '16px' }
          }));
        }
      } else {
        const need = (result.passingPercent != null)
          ? Number(result.passingPercent)
          : (quizData.quiz.passingPercent != null ? Number(quizData.quiz.passingPercent) : null);
        card.appendChild(el('p', {
          className: 'muted',
          textContent: need != null
            ? ('You needed ' + need + '% to pass. You can try again.')
            : 'You can try again.',
          style: { marginBottom: '16px' }
        }));
      }

      const actions = el('div', {
        style: {
          display: 'flex',
          gap: '10px',
          justifyContent: 'center',
          flexWrap: 'wrap',
          marginTop: '16px'
        }
      });

      if (!passed) {
        actions.appendChild(el('button', {
          type: 'button',
          className: 'btn btn-primary',
          textContent: 'Try again',
          onClick: function () { startAttempt(); }
        }));
      }

      actions.appendChild(el('button', {
        type: 'button',
        className: 'btn btn-outline',
        textContent: 'My Progress',
        onClick: function () { ctx.navigate('student.progress'); }
      }));

      actions.appendChild(el('button', {
        type: 'button',
        className: 'btn btn-outline',
        textContent: 'Back to scanner',
        onClick: function () { ctx.navigate('student.scan'); }
      }));

      card.appendChild(actions);
      container.appendChild(card);
    }

    /* ---------- Cleanup ---------- */
    ctx.onCleanup(function () {
      mounted = false;
      clearTimers();
    });

    /* ---------- Boot ---------- */
    renderLoading();
    load();
  }

  /* =========================================================
     Register
     ========================================================= */
  window.APP.views.renderStudentQuiz = renderStudentQuiz;
})();
