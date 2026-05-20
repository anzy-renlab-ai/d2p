// ZeroU · landing — interaction
// On-theme motion: scroll progress, reveal stagger, verdict stamp,
// pipeline live readout, thinking counters, copy CLI.
// Respects prefers-reduced-motion and avoids layout thrash.

(function () {
  'use strict';

  var prefersReduced =
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ─── Mark reveal targets + per-child stagger ─────────────────
  function tagReveal(selector, baseDelayMs, stepMs) {
    var nodes = document.querySelectorAll(selector);
    nodes.forEach(function (n, i) {
      n.setAttribute('data-reveal', '');
      n.style.setProperty('--reveal-d', (baseDelayMs + i * stepMs) / 1000 + 's');
    });
  }

  // Hero is animated via CSS keyframes; don't re-reveal it.
  tagReveal('.case-head', 0, 0);
  tagReveal('.case .exhibits .exhibit', 80, 90);
  tagReveal('.rehearsal-subject', 0, 0);
  tagReveal('.rehearsal-voices .voice', 80, 90);
  tagReveal('.comparison .compare', 0, 100);
  tagReveal('.receipt', 200, 0);
  tagReveal('.verdict', 220, 0);
  tagReveal('.theatre-frame', 100, 0);
  tagReveal('.theatre-strip .strip-cell', 220, 80);
  tagReveal('.gate', 0, 70);
  tagReveal('.promise', 0, 60);
  tagReveal('.affirmation-body', 0, 0);
  tagReveal('.download-text', 0, 0);
  tagReveal('.download-actions', 100, 0);

  // ─── IntersectionObserver-driven reveal + side effects ───────
  if (!prefersReduced && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var el = entry.target;
          el.classList.add('is-in');

          // Trigger counter when verdict enters viewport
          if (el.classList.contains('verdict')) {
            el.querySelectorAll('[data-count-to]').forEach(function (counter) {
              animateCounter(
                counter,
                parseInt(counter.getAttribute('data-count-to'), 10) || 0,
                1400,
              );
            });
          }
          io.unobserve(el);
        });
      },
      { threshold: 0.14, rootMargin: '0px 0px -6% 0px' },
    );

    document.querySelectorAll('[data-reveal]').forEach(function (el) {
      io.observe(el);
    });
  } else {
    // Reduced motion: flip everything on immediately.
    document.querySelectorAll('[data-reveal]').forEach(function (el) {
      el.classList.add('is-in');
    });
    document.querySelectorAll('[data-count-to]').forEach(function (el) {
      el.textContent = el.getAttribute('data-count-to');
    });
  }

  // ─── Counter (number ticker) ────────────────────────────────
  function animateCounter(el, to, durMs) {
    if (prefersReduced) {
      el.textContent = String(to);
      return;
    }
    var from = parseInt(el.textContent, 10) || 0;
    var start = performance.now();
    function tick(t) {
      var p = Math.min(1, (t - start) / durMs);
      var eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      el.textContent = String(Math.round(from + (to - from) * eased));
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // ─── Docket scroll progress + shadow state ──────────────────
  var docket = document.querySelector('.docket');
  var docketProg = document.querySelector('.docket-progress');
  var lastScrollUpdate = 0;
  function onScroll() {
    var now = performance.now();
    if (now - lastScrollUpdate < 14) return;
    lastScrollUpdate = now;

    var sy = window.scrollY || window.pageYOffset || 0;
    if (docket) {
      if (sy > 8) docket.classList.add('is-scrolled');
      else docket.classList.remove('is-scrolled');
    }
    if (docketProg) {
      var max =
        document.documentElement.scrollHeight - window.innerHeight || 1;
      var pct = Math.max(0, Math.min(1, sy / max));
      docketProg.style.transform = 'scaleX(' + pct.toFixed(4) + ')';
    }
  }
  if (docket || docketProg) {
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
  }

  // ─── Case watermark slide-in ────────────────────────────────
  document.querySelectorAll('.case[data-case-num]').forEach(function (c) {
    if (c.querySelector('.case-watermark')) return;
    var w = document.createElement('span');
    w.className = 'case-watermark';
    w.setAttribute('aria-hidden', 'true');
    w.textContent = 'shift ' + c.getAttribute('data-case-num');
    c.insertBefore(w, c.firstChild);
  });

  if (!prefersReduced && 'IntersectionObserver' in window) {
    var caseIO = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('case-in');
            caseIO.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.06, rootMargin: '0px 0px -4% 0px' },
    );
    document.querySelectorAll('.case[data-case-num]').forEach(function (el) {
      caseIO.observe(el);
    });
  } else {
    document.querySelectorAll('.case[data-case-num]').forEach(function (el) {
      el.classList.add('case-in');
    });
  }

  // ─── Pipeline live readout · 4-stage cycle ──────────────────
  // Cycles through scenarios:
  //   1) all pass (the docs-changelog happy path)
  //   2) alignment low → fail at G2
  //   3) adversarial break → fail at G4
  //   4) reset to idle
  var pipeline = document.querySelector('[data-pipeline]');
  if (pipeline && !prefersReduced) {
    var stages = pipeline.querySelectorAll('.pstage');
    var scenarios = [
      // Each scenario is an array of stage outcomes:
      // 'pass' | 'fail' | 'skip'
      ['pass', 'pass', 'pass', 'skip'], // happy path (docs)
      ['pass', 'fail', null, null],     // alignment low
      ['pass', 'pass', 'pass', 'fail'], // adversarial break (auth)
    ];
    var scenarioVerdicts = [
      ['0 ERR', '0.98 / 0.7', 'APPROVE', 'SKIPPED'],
      ['0 ERR', '0.55 / 0.7', '—', '—'],
      ['0 ERR', '0.92 / 0.7', 'APPROVE', 'BREAK · session-fixation'],
    ];

    var scenarioIdx = 0;

    function resetStages() {
      stages.forEach(function (s) {
        s.classList.remove('is-active', 'is-pass', 'is-fail');
        var v = s.querySelector('[data-verdict]');
        if (v) v.textContent = '—';
      });
    }

    function runScenario(idx) {
      resetStages();
      var pattern = scenarios[idx];
      var verdicts = scenarioVerdicts[idx];
      var i = 0;
      function step() {
        if (i >= stages.length) {
          // Hold the final state for a beat, then advance
          setTimeout(function () {
            scenarioIdx = (scenarioIdx + 1) % scenarios.length;
            runScenario(scenarioIdx);
          }, 2400);
          return;
        }
        var stage = stages[i];
        var outcome = pattern[i];
        var verdict = verdicts[i];

        // Light up
        stages.forEach(function (s) {
          s.classList.remove('is-active');
        });
        stage.classList.add('is-active');

        setTimeout(function () {
          stage.classList.remove('is-active');
          if (outcome === 'pass') stage.classList.add('is-pass');
          else if (outcome === 'fail') stage.classList.add('is-fail');
          else if (outcome === 'skip') stage.classList.add('is-pass');

          var v = stage.querySelector('[data-verdict]');
          if (v) v.textContent = verdict || '—';

          i++;
          // If this stage failed, halt the rest (verdicts already null)
          if (outcome === 'fail') {
            setTimeout(function () {
              scenarioIdx = (scenarioIdx + 1) % scenarios.length;
              runScenario(scenarioIdx);
            }, 2400);
            return;
          }
          if (outcome === null) {
            setTimeout(function () {
              scenarioIdx = (scenarioIdx + 1) % scenarios.length;
              runScenario(scenarioIdx);
            }, 2400);
            return;
          }
          setTimeout(step, 600);
        }, 700);
      }
      step();
    }

    // Kick off after hero entry settles
    setTimeout(function () {
      runScenario(scenarioIdx);
    }, 2600);
  } else if (pipeline) {
    // Reduced motion: show a single static "all pass" state
    var stages2 = pipeline.querySelectorAll('.pstage');
    var staticVerdicts = ['0 ERR', '0.98 / 0.7', 'APPROVE', 'SKIPPED'];
    stages2.forEach(function (s, i) {
      s.classList.add('is-pass');
      var v = s.querySelector('[data-verdict]');
      if (v) v.textContent = staticVerdicts[i];
    });
  }

  // ─── Copy CLI command ───────────────────────────────────────
  document.querySelectorAll('.copy-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var text = btn.getAttribute('data-copy') || '';
      var label = btn.textContent;
      var done = function () {
        btn.setAttribute('data-copied', 'true');
        btn.textContent = '已复制';
        setTimeout(function () {
          btn.removeAttribute('data-copied');
          btn.textContent = label;
        }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(fallback);
      } else {
        fallback();
      }
      function fallback() {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
          done();
        } catch (e) {
          /* noop */
        }
        document.body.removeChild(ta);
      }
    });
  });

  // ─── Footer year (if any data-year attr) ────────────────────
  var yearEl = document.querySelector('[data-year]');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());
})();
