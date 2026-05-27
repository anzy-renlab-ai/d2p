/**
 * Phase 11.4 — inlined CSS + JS for the dense table-driven enhance report.
 *
 * Single-file HTML means everything ships inside the document. No external
 * fonts, no CDN. Keep this dependency-free.
 *
 * Design language: GitHub PR file list + VSCode source control + k9s. Dense
 * monospace rows, click-to-expand inline diff, hotkey-driven filtering.
 */

export const REPORT_CSS = `
:root {
  --bg: #0e1116;
  --bg-elev: #161b22;
  --bg-row: #1c2128;
  --bg-row-hover: #22272e;
  --fg: #c9d1d9;
  --fg-muted: #8b949e;
  --fg-dim: #6e7681;
  --accent: #58a6ff;
  --added-bg: #033a16;
  --added-fg: #aff5b4;
  --removed-bg: #67060c;
  --removed-fg: #ffdcd7;
  --border: #30363d;
  --border-soft: #21262d;
  --warn: #d29922;
  --warn-bg: #2d2306;
  --ok: #3fb950;
  --bad: #f85149;
  --bad-bg: #2d0808;
  --sev-p1-fg: #f85149;
  --sev-p1-bg: #2d0808;
  --sev-p2-fg: #d29922;
  --sev-p2-bg: #2d2306;
  --sev-p3-fg: #58a6ff;
  --sev-p3-bg: #0c1f33;
  --code-font: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: light) {
  :root {
    --bg: #ffffff;
    --bg-elev: #f6f8fa;
    --bg-row: #f6f8fa;
    --bg-row-hover: #eaeef2;
    --fg: #1f2328;
    --fg-muted: #57606a;
    --fg-dim: #8c959f;
    --accent: #0969da;
    --added-bg: #dafbe1;
    --added-fg: #1a7f37;
    --removed-bg: #ffebe9;
    --removed-fg: #82071e;
    --border: #d0d7de;
    --border-soft: #d8dee4;
    --warn: #9a6700;
    --warn-bg: #fff8c5;
    --ok: #1a7f37;
    --bad: #cf222e;
    --bad-bg: #ffebe9;
    --sev-p1-fg: #cf222e;
    --sev-p1-bg: #ffebe9;
    --sev-p2-fg: #9a6700;
    --sev-p2-bg: #fff8c5;
    --sev-p3-fg: #0969da;
    --sev-p3-bg: #ddf4ff;
  }
}
* { box-sizing: border-box; }
html, body {
  margin: 0; padding: 0;
  background: var(--bg); color: var(--fg);
  font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
}
header.sticky {
  position: sticky; top: 0; z-index: 10;
  background: var(--bg-elev);
  border-bottom: 1px solid var(--border);
  padding: 10px 16px;
  display: flex; flex-wrap: wrap; gap: 12px;
  align-items: center; justify-content: space-between;
}
header.sticky .title {
  display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
  font-family: var(--code-font); font-size: 13px;
}
header.sticky .title h1 {
  margin: 0; font-size: 14px; font-weight: 600;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
}
header.sticky .title .sep { color: var(--fg-dim); }
header.sticky .title .meta { color: var(--fg-muted); }
header.sticky .hotkey-hint {
  font-family: var(--code-font); font-size: 11px;
  color: var(--fg-dim);
}
header.sticky .hotkey-hint kbd {
  background: var(--bg-row); border: 1px solid var(--border);
  border-radius: 3px; padding: 0 4px; font-size: 11px;
  color: var(--fg-muted);
}
section.summary {
  display: flex; gap: 18px; flex-wrap: wrap;
  padding: 8px 16px; background: var(--bg);
  border-bottom: 1px solid var(--border-soft);
  font-family: var(--code-font); font-size: 12px;
}
section.summary .stat { color: var(--fg-muted); }
section.summary .stat strong {
  color: var(--fg); font-weight: 600;
}
section.summary .stat .plus { color: var(--ok); }
section.summary .stat .minus { color: var(--bad); }
.filter-bar {
  display: flex; flex-wrap: wrap; gap: 8px;
  align-items: center;
  padding: 8px 16px;
  background: var(--bg-elev);
  border-bottom: 1px solid var(--border);
  font-family: var(--code-font); font-size: 12px;
}
.filter-bar .group {
  display: flex; gap: 4px; align-items: center;
}
.filter-bar .group-label {
  color: var(--fg-muted); padding-right: 6px;
}
button.chip, button.copy-btn {
  background: var(--bg); color: var(--fg-muted);
  border: 1px solid var(--border); border-radius: 4px;
  padding: 2px 8px; cursor: pointer;
  font-family: inherit; font-size: 12px;
  line-height: 1.6;
}
button.chip:hover, button.copy-btn:hover {
  background: var(--bg-row-hover); color: var(--fg); border-color: var(--accent);
}
button.chip[aria-pressed=true] {
  background: var(--accent); color: var(--bg);
  border-color: var(--accent); font-weight: 600;
}
button.copy-btn { padding: 4px 10px; font-size: 12px; }
button.copy-btn.copied { color: var(--ok); border-color: var(--ok); }
.filter-bar select, .filter-bar input[type=text] {
  background: var(--bg); color: var(--fg);
  border: 1px solid var(--border); border-radius: 4px;
  padding: 2px 6px; font-family: inherit; font-size: 12px;
}
.filter-bar input[type=text] { width: 200px; }
section.section {
  border-bottom: 1px solid var(--border-soft);
}
section.section > h2 {
  margin: 0; padding: 8px 16px;
  font-size: 11px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.5px;
  color: var(--fg-muted);
  font-family: var(--code-font);
  background: var(--bg);
  border-bottom: 1px solid var(--border-soft);
  display: flex; align-items: center; gap: 8px;
}
section.section > h2 .count {
  color: var(--fg);
  background: var(--bg-row);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0 8px; font-size: 11px;
}
.empty {
  color: var(--fg-dim); font-style: italic;
  padding: 24px 16px; text-align: center;
  font-family: var(--code-font); font-size: 12px;
}
/* ── Row layout (files + findings) ─────────────────────────────────────── */
details.row {
  border-bottom: 1px solid var(--border-soft);
}
details.row:last-child { border-bottom: none; }
details.row > summary {
  list-style: none;
  cursor: pointer;
  padding: 4px 16px 4px 32px;
  display: grid;
  align-items: center;
  gap: 12px;
  font-family: var(--code-font); font-size: 12px;
  position: relative;
  white-space: nowrap;
  overflow: hidden;
}
details.row > summary::-webkit-details-marker { display: none; }
details.row > summary::before {
  content: '▸';
  position: absolute;
  left: 16px;
  color: var(--fg-dim);
  font-size: 10px;
  transition: transform 0.1s;
}
details.row[open] > summary::before { transform: rotate(90deg); }
details.row > summary:hover { background: var(--bg-row-hover); }
details.row[open] > summary {
  background: var(--bg-row);
  border-bottom: 1px solid var(--border-soft);
}
/* Files table */
details.file-row > summary {
  grid-template-columns: 18px minmax(0, 1fr) 56px 80px minmax(0, 180px);
}
details.file-row > summary .verdict {
  text-align: center;
}
details.file-row > summary .path {
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
}
details.file-row > summary .status-badge {
  font-size: 10px;
  text-align: center;
  color: var(--fg-muted);
  background: var(--bg-row);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 1px 0;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}
details.file-row > summary .status-badge.added { color: var(--added-fg); background: var(--added-bg); border-color: var(--added-bg); }
details.file-row > summary .status-badge.deleted { color: var(--removed-fg); background: var(--removed-bg); border-color: var(--removed-bg); }
details.file-row > summary .counts {
  text-align: right;
  font-size: 11px;
  color: var(--fg-muted);
}
details.file-row > summary .counts .plus { color: var(--ok); }
details.file-row > summary .counts .minus { color: var(--bad); }
details.file-row > summary .modules {
  color: var(--fg-muted);
  font-size: 11px;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
}
.row-expand {
  background: var(--bg);
}
.row-expand .why {
  padding: 8px 32px;
  font-size: 12px;
  color: var(--fg-muted);
  background: var(--bg-elev);
  border-bottom: 1px solid var(--border-soft);
  font-family: var(--code-font);
}
.row-expand .omitted {
  padding: 12px 32px;
  color: var(--fg-muted); font-style: italic;
  font-family: var(--code-font); font-size: 12px;
}
/* Findings table */
details.finding-row > summary {
  grid-template-columns: 32px 18px minmax(0, 1.5fr) minmax(0, 3fr);
}
details.finding-row > summary .sev {
  text-align: center;
  font-weight: 600;
  font-size: 11px;
  border-radius: 3px;
  padding: 1px 0;
  letter-spacing: 0.5px;
}
details.finding-row > summary .sev-P1 { color: var(--sev-p1-fg); background: var(--sev-p1-bg); }
details.finding-row > summary .sev-P2 { color: var(--sev-p2-fg); background: var(--sev-p2-bg); }
details.finding-row > summary .sev-P3 { color: var(--sev-p3-fg); background: var(--sev-p3-bg); }
details.finding-row > summary .glyph {
  text-align: center;
  font-size: 12px;
}
details.finding-row > summary .glyph.applied { color: var(--ok); }
details.finding-row > summary .glyph.rejected { color: var(--bad); }
details.finding-row > summary .target {
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
}
details.finding-row > summary .message {
  color: var(--fg-muted);
  overflow: hidden;
  text-overflow: ellipsis;
}
.finding-detail {
  padding: 10px 32px 14px;
  font-family: var(--code-font); font-size: 12px;
  background: var(--bg);
}
.finding-detail dl {
  display: grid;
  grid-template-columns: 100px 1fr;
  gap: 4px 12px;
  margin: 0;
}
.finding-detail dt {
  color: var(--fg-dim);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}
.finding-detail dd {
  margin: 0;
  color: var(--fg);
  white-space: pre-wrap;
  word-break: break-word;
}
.finding-detail dd.reject {
  color: var(--bad);
}
/* Verify block */
.verify-grid {
  padding: 8px 16px;
  display: flex; flex-wrap: wrap; gap: 12px;
  font-family: var(--code-font); font-size: 12px;
}
.verify-grid .step {
  display: flex; align-items: center; gap: 6px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-elev);
}
.verify-grid .step .name { color: var(--fg); font-weight: 600; }
.verify-grid .step .dur { color: var(--fg-muted); }
.verify-grid .step.pass { border-color: var(--ok); }
.verify-grid .step.fail { border-color: var(--bad); background: var(--bad-bg); }
.verify-grid .step.skipped { color: var(--fg-dim); }
.broken-by {
  padding: 4px 16px 8px;
  color: var(--bad);
  font-family: var(--code-font); font-size: 12px;
}
/* Diff (reuse html-diff.ts) */
.diff-sxs {
  font-family: var(--code-font); font-size: 12px; line-height: 1.5;
  overflow-x: auto;
  background: var(--bg);
}
.diff-row {
  display: grid;
  grid-template-columns: 48px 1fr 48px 1fr;
  border-top: 1px solid var(--border-soft);
}
.diff-row .lineno {
  text-align: right; padding: 0 6px;
  color: var(--fg-dim);
  background: var(--bg-elev);
  user-select: none;
}
.diff-row .code {
  padding: 0 6px;
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
}
.code-added { background: var(--added-bg); color: var(--added-fg); }
.code-removed { background: var(--removed-bg); color: var(--removed-fg); }
.code-blank { background: var(--bg); }
.code-unchanged { background: var(--bg-elev); }
.diff-marker {
  padding: 4px 12px;
  font-family: var(--code-font); font-size: 11px;
  color: var(--fg-muted);
  background: var(--bg);
  border-top: 1px solid var(--border-soft);
}
.diff-marker-hunk { color: var(--accent); }
.diff-marker-truncation { font-style: italic; color: var(--warn); }
/* Footer */
footer {
  padding: 16px;
  color: var(--fg-muted); font-size: 12px;
  border-top: 1px solid var(--border); background: var(--bg-elev);
  display: flex; gap: 12px; flex-wrap: wrap;
  align-items: center; justify-content: space-between;
}
footer .footer-meta { font-family: var(--code-font); }
footer .footer-actions { display: flex; gap: 6px; flex-wrap: wrap; }
footer a { color: var(--accent); }
footer code {
  background: var(--bg);
  padding: 1px 6px; border-radius: 3px;
  border: 1px solid var(--border);
  font-size: 11px;
}
.hidden { display: none !important; }
.status-running { color: var(--warn); }
.status-pass { color: var(--ok); }
.status-fail { color: var(--bad); }
/* Hotkey help overlay */
.hk-overlay {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.6); z-index: 100;
  display: none;
  align-items: center; justify-content: center;
}
.hk-overlay.visible { display: flex; }
.hk-overlay .panel {
  background: var(--bg-elev); border: 1px solid var(--border);
  border-radius: 8px;
  padding: 20px 28px;
  min-width: 280px;
  font-family: var(--code-font); font-size: 13px;
  color: var(--fg);
}
.hk-overlay .panel h3 {
  margin: 0 0 12px; font-size: 13px;
  color: var(--fg-muted); text-transform: uppercase;
  letter-spacing: 0.5px;
}
.hk-overlay .panel dl {
  display: grid; grid-template-columns: auto 1fr;
  gap: 6px 18px; margin: 0;
}
.hk-overlay .panel dt {
  text-align: right;
}
.hk-overlay .panel dt kbd {
  background: var(--bg-row); border: 1px solid var(--border);
  border-radius: 3px; padding: 1px 6px;
  font-family: inherit; font-size: 12px;
}
.hk-overlay .panel dd {
  margin: 0; color: var(--fg-muted);
}
`;

export const REPORT_JS = `
(function(){
  // ── Filter state stored in URL hash ─────────────────────────────────────
  var state = {
    modules: new Set(),  // empty = all
    severity: 'all',     // 'all' | 'P1' | 'P2' | 'P3'
    query: '',
  };
  function readHash() {
    var h = location.hash.slice(1);
    if (!h) return;
    h.split('&').forEach(function(part){
      var eq = part.indexOf('=');
      if (eq < 0) return;
      var k = decodeURIComponent(part.slice(0, eq));
      var v = decodeURIComponent(part.slice(eq+1));
      if (k === 'm' && v) state.modules = new Set(v.split(','));
      else if (k === 's' && v) state.severity = v;
      else if (k === 'q') state.query = v;
    });
  }
  function writeHash() {
    var parts = [];
    if (state.modules.size > 0) parts.push('m=' + encodeURIComponent(Array.from(state.modules).join(',')));
    if (state.severity !== 'all') parts.push('s=' + encodeURIComponent(state.severity));
    if (state.query) parts.push('q=' + encodeURIComponent(state.query));
    var h = parts.length > 0 ? '#' + parts.join('&') : '';
    if (location.hash !== h) {
      history.replaceState(null, '', location.pathname + location.search + h);
    }
  }
  // ── Copy helper ─────────────────────────────────────────────────────────
  function copyText(text, btn) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function(){ flash(btn); });
    } else {
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); flash(btn); } catch(e) {}
      document.body.removeChild(ta);
    }
  }
  function flash(btn) {
    if (!btn || !btn.classList) return;
    var orig = btn.textContent;
    btn.textContent = '✓ copied';
    btn.classList.add('copied');
    setTimeout(function(){ btn.textContent = orig; btn.classList.remove('copied'); }, 1200);
  }
  // ── Apply filter to rows ────────────────────────────────────────────────
  function applyFilters() {
    var q = state.query.toLowerCase();
    // Files
    var files = document.querySelectorAll('details.file-row');
    for (var i=0; i<files.length; i++) {
      var row = files[i];
      var modAttr = (row.getAttribute('data-modules') || '').split(',').filter(Boolean);
      var fileName = (row.getAttribute('data-file') || '').toLowerCase();
      var modOk = state.modules.size === 0 || modAttr.some(function(m){ return state.modules.has(m); });
      var qOk = !q || fileName.indexOf(q) !== -1 || modAttr.some(function(m){ return m.toLowerCase().indexOf(q) !== -1; });
      if (modOk && qOk) row.classList.remove('hidden'); else row.classList.add('hidden');
    }
    // Findings
    var finds = document.querySelectorAll('details.finding-row');
    for (var j=0; j<finds.length; j++) {
      var fr = finds[j];
      var sev = fr.getAttribute('data-severity') || '';
      var target = (fr.getAttribute('data-target') || '').toLowerCase();
      var msg = (fr.getAttribute('data-message') || '').toLowerCase();
      var sevOk = state.severity === 'all' || sev === state.severity;
      var qOk2 = !q || target.indexOf(q) !== -1 || msg.indexOf(q) !== -1;
      if (sevOk && qOk2) fr.classList.remove('hidden'); else fr.classList.add('hidden');
    }
    // Update chip pressed state
    var chips = document.querySelectorAll('button.chip[data-module]');
    for (var k=0; k<chips.length; k++) {
      var modId = chips[k].getAttribute('data-module');
      var pressed = modId === '__all__'
        ? state.modules.size === 0
        : state.modules.has(modId);
      chips[k].setAttribute('aria-pressed', pressed ? 'true' : 'false');
    }
    // Update empty placeholders
    updateEmptyState('section[data-section=files]', 'details.file-row');
    updateEmptyState('section[data-section=findings]', 'details.finding-row');
    writeHash();
  }
  function updateEmptyState(sectionSel, rowSel) {
    var sec = document.querySelector(sectionSel);
    if (!sec) return;
    var rows = sec.querySelectorAll(rowSel + ':not(.hidden)');
    var placeholder = sec.querySelector('.filter-empty');
    if (rows.length === 0) {
      if (!placeholder) {
        placeholder = document.createElement('div');
        placeholder.className = 'empty filter-empty';
        placeholder.textContent = 'No rows match current filter.';
        sec.appendChild(placeholder);
      }
      placeholder.classList.remove('hidden');
    } else if (placeholder) {
      placeholder.classList.add('hidden');
    }
  }
  function toggleModule(modId) {
    if (modId === '__all__') {
      state.modules.clear();
    } else if (state.modules.has(modId)) {
      state.modules.delete(modId);
    } else {
      state.modules.add(modId);
    }
    applyFilters();
  }
  function setSeverity(s) { state.severity = s; applyFilters(); }
  function setQuery(q) { state.query = q; applyFilters(); }
  function expandAllFiles() {
    var files = document.querySelectorAll('details.file-row');
    for (var i=0; i<files.length; i++) files[i].open = true;
  }
  function collapseAll() {
    var all = document.querySelectorAll('details.row');
    for (var i=0; i<all.length; i++) all[i].open = false;
  }
  // ── Hotkeys ─────────────────────────────────────────────────────────────
  function onKey(e) {
    // Skip if typing in input
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'f') {
      var inp = document.getElementById('filter-input');
      if (inp) { inp.focus(); e.preventDefault(); }
    } else if (e.key === 'e') {
      expandAllFiles(); e.preventDefault();
    } else if (e.key === 'c') {
      collapseAll(); e.preventDefault();
    } else if (e.key === 's') {
      var summary = document.querySelector('section.summary');
      if (summary) summary.scrollIntoView({ behavior: 'smooth' });
      e.preventDefault();
    } else if (e.key === '?') {
      var overlay = document.getElementById('hk-overlay');
      if (overlay) overlay.classList.toggle('visible');
      e.preventDefault();
    } else if (e.key === 'Escape') {
      var overlay2 = document.getElementById('hk-overlay');
      if (overlay2) overlay2.classList.remove('visible');
    }
  }
  // ── Wire up ─────────────────────────────────────────────────────────────
  window.zerouCopy = copyText;
  window.zerouFilter = toggleModule;
  window.zerouSeverity = setSeverity;
  window.zerouQuery = setQuery;
  document.addEventListener('DOMContentLoaded', function(){
    readHash();
    // Copy buttons
    document.querySelectorAll('[data-copy]').forEach(function(b){
      b.addEventListener('click', function(){ copyText(b.getAttribute('data-copy'), b); });
    });
    // Module chips
    document.querySelectorAll('button.chip[data-module]').forEach(function(b){
      b.addEventListener('click', function(){ toggleModule(b.getAttribute('data-module') || '__all__'); });
    });
    // Severity dropdown
    var sevSel = document.getElementById('severity-filter');
    if (sevSel) {
      sevSel.value = state.severity;
      sevSel.addEventListener('change', function(){ setSeverity(sevSel.value); });
    }
    // Query input
    var inp = document.getElementById('filter-input');
    if (inp) {
      inp.value = state.query;
      inp.addEventListener('input', function(){ setQuery(inp.value); });
    }
    // Hotkey overlay close
    var overlay = document.getElementById('hk-overlay');
    if (overlay) {
      overlay.addEventListener('click', function(){ overlay.classList.remove('visible'); });
    }
    // Hotkeys
    document.addEventListener('keydown', onKey);
    // Initial filter pass
    applyFilters();
  });
})();
`;
