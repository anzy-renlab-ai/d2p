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

  // ─── Exhibit + voice 3D mouse-tracked tilt ────────────────
  // Subtle parallax, max 6deg, eases back when mouse leaves
  if (!prefersReduced) {
    var tiltTargets = document.querySelectorAll(
      '.exhibit, .voice, .compare, .strip-cell',
    );
    tiltTargets.forEach(function (card) {
      card.style.transformStyle = 'preserve-3d';
      card.style.willChange = 'transform';

      card.addEventListener('mousemove', function (e) {
        var rect = card.getBoundingClientRect();
        var x = (e.clientX - rect.left) / rect.width;  // 0..1
        var y = (e.clientY - rect.top) / rect.height;  // 0..1
        var tiltX = (0.5 - y) * 5;   // up-down rotation
        var tiltY = (x - 0.5) * 5;   // left-right rotation
        card.style.transform =
          'perspective(900px) rotateX(' +
          tiltX.toFixed(2) +
          'deg) rotateY(' +
          tiltY.toFixed(2) +
          'deg) translateY(-3px)';
      });

      card.addEventListener('mouseleave', function () {
        card.style.transform = '';
      });
    });
  }

  // ─── Floating ambient orbs (canvas, very low-density) ─────
  // 8 mint dots drifting slowly. Pure visual flair, no interaction.
  if (!prefersReduced && document.querySelector('.hero')) {
    var orbCanvas = document.createElement('canvas');
    orbCanvas.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:1;opacity:0.55;';
    document.body.appendChild(orbCanvas);
    var ctx2 = orbCanvas.getContext('2d');

    function resizeOrb() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      orbCanvas.width = window.innerWidth * dpr;
      orbCanvas.height = window.innerHeight * dpr;
      orbCanvas.style.width = window.innerWidth + 'px';
      orbCanvas.style.height = window.innerHeight + 'px';
      ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resizeOrb();
    window.addEventListener('resize', resizeOrb, { passive: true });

    var ORBS = 7;
    var orbs = [];
    for (var k = 0; k < ORBS; k++) {
      orbs.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        r: 1 + Math.random() * 2,
        vx: (Math.random() - 0.5) * 0.15,
        vy: -0.08 - Math.random() * 0.12,
        hue: Math.random() > 0.7 ? 'gold' : 'mint',
        a: 0.3 + Math.random() * 0.4,
      });
    }

    function drawOrbs() {
      ctx2.clearRect(0, 0, orbCanvas.width, orbCanvas.height);
      orbs.forEach(function (o) {
        o.x += o.vx;
        o.y += o.vy;
        // wrap
        if (o.x < -10) o.x = window.innerWidth + 10;
        if (o.x > window.innerWidth + 10) o.x = -10;
        if (o.y < -10) o.y = window.innerHeight + 10;

        var col =
          o.hue === 'gold'
            ? 'rgba(255, 214, 107,'
            : 'rgba(124, 255, 178,';

        // glow
        var grad = ctx2.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r * 8);
        grad.addColorStop(0, col + (o.a * 0.8) + ')');
        grad.addColorStop(0.4, col + (o.a * 0.25) + ')');
        grad.addColorStop(1, col + '0)');
        ctx2.fillStyle = grad;
        ctx2.beginPath();
        ctx2.arc(o.x, o.y, o.r * 8, 0, Math.PI * 2);
        ctx2.fill();

        // core
        ctx2.fillStyle = col + o.a + ')';
        ctx2.beginPath();
        ctx2.arc(o.x, o.y, o.r, 0, Math.PI * 2);
        ctx2.fill();
      });
      requestAnimationFrame(drawOrbs);
    }
    requestAnimationFrame(drawOrbs);
  }

  // ─── Counter blur during ticker (extends animateCounter feel) ──
  // wraps existing counter logic: add a `.is-ticking` class while running
  // already happens via animateCounter — we just style it. CSS hook below.
})();
    // ╔══════════════════════════════════════════════════════════╗
    //   Feature moments preview · inline JS
    // ╚══════════════════════════════════════════════════════════╝

    var prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ─── M1 · lane oscilloscope ────────────────────────────────
    (function () {
      var stage = document.querySelector('[data-fm-lanes]');
      if (!stage) return;
      if (prefersReduced) return;
      var lanes  = stage.querySelectorAll('.fm-lane');
      var chip   = stage.querySelector('[data-fm-chip]');
      var sink   = stage.querySelector('[data-fm-sink]');
      var label  = stage.querySelector('[data-fm-label]');
      var demos = [
        { label: 'fix #27 · docs-changelog-missing', chip: 'ok',
          lanes: [
            { v: 'PASS · 0 err' },
            { v: 'PASS · 0.98' },
            { v: 'APPROVE · 88%' },
            { v: 'SKIPPED · low', skipped: true },
          ],
          sink: { mark: '✓ merged → main', state: 'pass' } },
        { label: 'fix #18 · auth-csrf-protection', chip: 'ok',
          lanes: [
            { v: 'PASS · 0 err' },
            { v: 'REJECT · 0.41', fail: true },
            { v: '— halted', halt: true },
            { v: '— halted', halt: true },
          ],
          sink: { mark: '✗ NEED_HUMAN', state: 'fail' } },
      ];
      var demoIdx = 0;
      function resetLanes() {
        lanes.forEach(function (lane) {
          lane.classList.remove('is-active', 'is-pass', 'is-fail', 'is-skipped');
          var v = lane.querySelector('[data-verdict]');
          if (v) v.textContent = '—';
          var blip = lane.querySelector('[data-blip]');
          if (blip) { blip.style.animation = 'none'; blip.offsetHeight; blip.style.animation = ''; }
        });
        sink.textContent = '— waiting —';
        sink.removeAttribute('data-state');
        chip.removeAttribute('data-state');
      }
      function runDemo(d) {
        resetLanes();
        label.textContent = d.label;
        chip.setAttribute('data-state', d.chip === 'fail' ? 'fail' : 'ok');
        var i = 0;
        function nextLane() {
          if (i >= lanes.length) {
            sink.textContent = d.sink.mark;
            sink.setAttribute('data-state', d.sink.state);
            setTimeout(advance, 2800); return;
          }
          var step = d.lanes[i];
          var lane = lanes[i];
          if (step.halt) {
            lane.classList.add('is-skipped');
            lane.querySelector('[data-verdict]').textContent = step.v;
            i++; setTimeout(nextLane, 200); return;
          }
          lane.classList.add('is-active');
          setTimeout(function () {
            lane.classList.remove('is-active');
            if (step.fail) lane.classList.add('is-fail');
            else if (step.skipped) lane.classList.add('is-skipped', 'is-pass');
            else lane.classList.add('is-pass');
            lane.querySelector('[data-verdict]').textContent = step.v;
            i++;
            if (step.fail) {
              for (var k = i; k < lanes.length; k++) {
                lanes[k].classList.add('is-skipped');
                lanes[k].querySelector('[data-verdict]').textContent = '— halted';
              }
              sink.textContent = d.sink.mark;
              sink.setAttribute('data-state', d.sink.state);
              setTimeout(advance, 3000);
            } else setTimeout(nextLane, 220);
          }, 950);
        }
        setTimeout(nextLane, 350);
      }
      function advance() {
        demoIdx = (demoIdx + 1) % demos.length;
        runDemo(demos[demoIdx]);
      }
      // Start immediately on preview page (no IO gate so screenshots are deterministic)
      runDemo(demos[0]);
    })();

    // ─── M2 · ledger ───────────────────────────────────────────
    (function () {
      var stage = document.querySelector('[data-fm-ledger]');
      if (!stage) return;
      var rows = stage.querySelectorAll('.fm-row[data-sev]');
      var more = stage.querySelector('[data-more]');
      rows.forEach(function (row) {
        var sev = document.createElement('span');
        sev.className = 'fm-row-sev';
        sev.textContent = row.getAttribute('data-sev');
        var code = document.createElement('span');
        code.className = 'fm-row-code';
        code.textContent = row.getAttribute('data-code');
        row.appendChild(sev);
        row.appendChild(code);
      });
      if (more) more.style.opacity = '0';
      function revealAll() {
        rows.forEach(function (row, i) {
          setTimeout(function () { row.classList.add('is-in'); }, prefersReduced ? 0 : 60 + i * 70);
        });
        if (more) setTimeout(function () { more.classList.add('is-in'); more.style.opacity = '1'; }, prefersReduced ? 0 : 80 + rows.length * 70);
      }
      revealAll();
    })();

    // ─── M3 · orbit ────────────────────────────────────────────
    (function () {
      var stage = document.querySelector('[data-fm-orbit]');
      if (!stage) return;
      if (prefersReduced) return;
      var agents = stage.querySelectorAll('.fm-agent');
      var core   = stage.querySelector('[data-fm-core]');
      var cycleEl= stage.querySelector('[data-fm-cycle]');
      var svg    = stage.querySelector('.fm-orbit-lines');
      var lineD  = svg.querySelector('[data-line="dispatch"]');
      var lineV  = svg.querySelector('[data-line="verdict"]');
      var stageRectEl = stage.querySelector('.fm-orbit-stage');

      function agentCenter(agent) {
        var s = stageRectEl.getBoundingClientRect();
        var a = agent.getBoundingClientRect();
        return { x: a.left - s.left + a.width / 2, y: a.top - s.top + a.height / 2 };
      }
      function coreCenter() {
        var s = stageRectEl.getBoundingClientRect();
        var c = core.getBoundingClientRect();
        return { x: c.left - s.left + c.width / 2, y: c.top - s.top + c.height / 2 };
      }
      function viewBoxScale() {
        var s = stageRectEl.getBoundingClientRect();
        return { sx: 600 / s.width, sy: 400 / s.height };
      }
      function setLine(line, from, to, opacity) {
        var s = viewBoxScale();
        line.setAttribute('x1', from.x * s.sx);
        line.setAttribute('y1', from.y * s.sy);
        line.setAttribute('x2', to.x   * s.sx);
        line.setAttribute('y2', to.y   * s.sy);
        line.setAttribute('opacity', opacity);
      }

      var idx = 0, cycle = 0;
      function tick() {
        var agent = agents[idx];
        agent.classList.remove('is-done');
        var status = agent.querySelector('[data-status]');
        var c = coreCenter(); var a = agentCenter(agent);
        setLine(lineD, c, a, 0);
        setLine(lineV, c, c, 0);
        requestAnimationFrame(function () { setLine(lineD, c, a, 1); });
        setTimeout(function () { agent.classList.add('is-active'); core.setAttribute('data-pulse', '1'); status.textContent = 'working'; }, 400);
        setTimeout(function () { status.textContent = 'reporting'; }, 1700);
        setTimeout(function () { setLine(lineD, c, a, 0); setLine(lineV, a, c, 1); }, 2100);
        setTimeout(function () { agent.classList.remove('is-active'); agent.classList.add('is-done'); status.textContent = 'done'; core.removeAttribute('data-pulse'); setLine(lineV, a, c, 0); }, 2800);
        setTimeout(function () {
          idx = (idx + 1) % agents.length;
          if (idx === 0) {
            cycle++;
            cycleEl.textContent = cycle;
            agents.forEach(function (ag) { ag.classList.remove('is-done'); ag.querySelector('[data-status]').textContent = 'idle'; });
          }
          tick();
        }, 3200);
      }
      cycleEl.textContent = '1';
      cycle = 1;
      // Slight delay for layout to settle (positions depend on getBoundingClientRect)
      setTimeout(tick, 400);
    })();

    // ─── M4 · overnight ────────────────────────────────────────
    (function () {
      var stage = document.querySelector('[data-fm-overnight]');
      if (!stage) return;
      var hourHand = stage.querySelector('[data-clock-hour]');
      var minHand  = stage.querySelector('[data-clock-min]');
      var readout  = stage.querySelector('[data-clock-readout]');
      var commits  = stage.querySelectorAll('.fm-commit');
      var ticks    = stage.querySelectorAll('[data-tick]');
      var startMin = 22 * 60 + 11;
      var endMin   = 23 * 60 + 43;
      var totalMs  = 8000;

      function clockAngles(minutes) {
        var minA  = ((minutes % 60) / 60) * 360;
        var hourA = (((minutes / 60) % 12) / 12) * 360;
        return { hour: hourA, min: minA };
      }
      function setHands(minutes) {
        var a = clockAngles(minutes);
        hourHand.style.transform = 'rotate(' + a.hour + 'deg)';
        minHand.style.transform  = 'rotate(' + a.min + 'deg)';
        var h = Math.floor(minutes / 60);
        var m = Math.floor(minutes % 60);
        readout.textContent = (h < 10 ? '0' + h : h) + ':' + (m < 10 ? '0' + m : m);
      }
      function parseAt(s) {
        var p = s.split(':');
        return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
      }
      function tickerUpdate(p) {
        ticks.forEach(function (el) {
          var to = parseFloat(el.getAttribute('data-to'));
          var fmt = el.getAttribute('data-fmt');
          var v = to * p;
          if (fmt === 'float') el.textContent = v.toFixed(2);
          else el.textContent = String(Math.round(v));
        });
      }
      function run() {
        if (prefersReduced) {
          setHands(endMin);
          commits.forEach(function (c) { c.classList.add('is-in'); });
          tickerUpdate(1);
          return;
        }
        var startTs = performance.now();
        function loop(now) {
          var elapsed = now - startTs;
          var p = Math.min(1, elapsed / totalMs);
          var ease = 1 - Math.pow(1 - p, 2);
          var cur = startMin + (endMin - startMin) * ease;
          setHands(cur);
          tickerUpdate(ease);
          commits.forEach(function (c) {
            var t = parseAt(c.getAttribute('data-at'));
            if (cur >= t) c.classList.add('is-in');
          });
          if (p < 1) requestAnimationFrame(loop);
          else {
            setTimeout(function () {
              commits.forEach(function (c) { c.classList.remove('is-in'); });
              setHands(startMin); tickerUpdate(0);
              startTs = performance.now();
              requestAnimationFrame(loop);
            }, 2200);
          }
        }
        requestAnimationFrame(loop);
      }
      run();
    })();

// ─── Section transitions · sweep + radar on entry ─────────────────
(function () {
  var prefersR = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersR) return;

  // Mark every direct main > section + the cases inner case wrappers
  var trans = document.querySelectorAll(
    'main > section, main > .cases, main > .live-console-wrap'
  );
  trans.forEach(function (s) {
    s.setAttribute('data-section-trans', '');
    // insert radar element (kept in DOM so CSS can animate it)
    var r = document.createElement('span');
    r.className = 'section-radar';
    r.setAttribute('aria-hidden', 'true');
    s.insertBefore(r, s.firstChild);
  });

  if (!('IntersectionObserver' in window)) {
    trans.forEach(function (s) { s.classList.add('section-in', 'section-fully-in'); });
    return;
  }

  var ioT = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        e.target.classList.add('section-in');
        setTimeout(function () { e.target.classList.add('section-fully-in'); }, 1300);
        ioT.unobserve(e.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -8% 0px' });

  trans.forEach(function (s) { ioT.observe(s); });
})();
