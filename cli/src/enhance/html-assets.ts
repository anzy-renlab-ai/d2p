/**
 * Phase 11 — inlined CSS + JS for the HTML enhance report.
 *
 * Single-file HTML means everything ships inside the document. No external
 * fonts, no CDN. Keep this dependency-free.
 */

export const REPORT_CSS = `
:root {
  --bg: #0e1116;
  --bg-elev: #161b22;
  --bg-row: #1c2128;
  --fg: #c9d1d9;
  --fg-muted: #8b949e;
  --accent: #58a6ff;
  --added-bg: #033a16;
  --added-fg: #aff5b4;
  --removed-bg: #67060c;
  --removed-fg: #ffdcd7;
  --border: #30363d;
  --warn: #d29922;
  --ok: #3fb950;
  --bad: #f85149;
  --code-font: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: light) {
  :root {
    --bg: #ffffff;
    --bg-elev: #f6f8fa;
    --bg-row: #f6f8fa;
    --fg: #1f2328;
    --fg-muted: #57606a;
    --accent: #0969da;
    --added-bg: #dafbe1;
    --added-fg: #1a7f37;
    --removed-bg: #ffebe9;
    --removed-fg: #82071e;
    --border: #d0d7de;
    --warn: #9a6700;
    --ok: #1a7f37;
    --bad: #cf222e;
  }
}
* { box-sizing: border-box; }
html, body {
  margin: 0; padding: 0;
  background: var(--bg); color: var(--fg);
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
}
header.sticky {
  position: sticky; top: 0; z-index: 10;
  background: var(--bg-elev);
  border-bottom: 1px solid var(--border);
  padding: 14px 20px;
  display: flex; flex-wrap: wrap; gap: 12px;
  align-items: center; justify-content: space-between;
}
header.sticky h1 {
  margin: 0; font-size: 18px; font-weight: 600;
}
header.sticky .branch {
  color: var(--fg-muted); font-family: var(--code-font); font-size: 12px;
  margin-top: 4px;
}
header.sticky .actions {
  display: flex; gap: 8px; flex-wrap: wrap;
}
button.copy-btn, button.filter-btn {
  background: var(--bg); color: var(--fg);
  border: 1px solid var(--border); border-radius: 6px;
  padding: 6px 12px; cursor: pointer; font-size: 13px;
  font-family: inherit;
}
button.copy-btn:hover, button.filter-btn:hover {
  background: var(--bg-row); border-color: var(--accent);
}
button.filter-btn[aria-pressed=true] {
  background: var(--accent); color: var(--bg); border-color: var(--accent);
}
button.copy-btn .copied { color: var(--ok); }
section.summary {
  display: flex; gap: 16px; flex-wrap: wrap;
  padding: 16px 20px; background: var(--bg-elev);
  border-bottom: 1px solid var(--border);
}
section.summary .stat {
  font-size: 13px; color: var(--fg-muted);
}
nav.module-filter {
  display: flex; gap: 8px; flex-wrap: wrap;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}
main.changes { padding: 20px; }
main.changes .empty {
  color: var(--fg-muted); font-style: italic;
  padding: 40px; text-align: center;
}
article.file-change {
  margin-bottom: 28px;
  border: 1px solid var(--border); border-radius: 8px;
  background: var(--bg-elev); overflow: hidden;
}
article.file-change > h2 {
  margin: 0; padding: 10px 14px;
  font-size: 14px; font-weight: 600;
  background: var(--bg-row); border-bottom: 1px solid var(--border);
  font-family: var(--code-font);
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
}
article.file-change > h2 .badge {
  font-family: inherit; font-weight: 500;
  font-size: 11px; padding: 2px 8px; border-radius: 10px;
  background: var(--bg); color: var(--fg-muted);
  border: 1px solid var(--border);
}
article.file-change > h2 .badge.added { background: var(--added-bg); color: var(--added-fg); }
article.file-change > h2 .badge.removed { background: var(--removed-bg); color: var(--removed-fg); }
article.file-change > p.why {
  margin: 0; padding: 10px 14px;
  background: var(--bg);
  color: var(--fg-muted); font-size: 13px;
  border-bottom: 1px solid var(--border);
}
article.file-change > .omitted {
  padding: 14px;
  color: var(--fg-muted); font-style: italic;
}
.diff-sxs {
  font-family: var(--code-font); font-size: 12px; line-height: 1.6;
  overflow-x: auto;
}
.diff-row {
  display: grid;
  grid-template-columns: 50px 1fr 50px 1fr;
  border-top: 1px solid var(--border);
}
.diff-row .lineno {
  text-align: right; padding: 0 8px;
  color: var(--fg-muted);
  background: var(--bg-elev);
  user-select: none;
}
.diff-row .code {
  padding: 0 8px;
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
}
.code-added { background: var(--added-bg); color: var(--added-fg); }
.code-removed { background: var(--removed-bg); color: var(--removed-fg); }
.code-blank { background: var(--bg); }
.code-unchanged { background: var(--bg-elev); }
.diff-marker {
  padding: 6px 14px;
  font-family: var(--code-font); font-size: 12px;
  color: var(--fg-muted);
  background: var(--bg);
  border-top: 1px solid var(--border);
}
.diff-marker-hunk { color: var(--accent); }
.diff-marker-truncation { font-style: italic; color: var(--warn); }
footer {
  padding: 20px;
  color: var(--fg-muted); font-size: 12px;
  border-top: 1px solid var(--border); background: var(--bg-elev);
}
footer a { color: var(--accent); }
.hidden { display: none !important; }
.status-running { color: var(--warn); }
.status-pass { color: var(--ok); }
.status-fail { color: var(--bad); }
`;

export const REPORT_JS = `
(function(){
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function(){ flash(event && event.target); });
    } else {
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); flash(event && event.target); } catch(e) {}
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
  function applyFilter(moduleId) {
    var arts = document.querySelectorAll('article.file-change');
    var btns = document.querySelectorAll('nav.module-filter button.filter-btn');
    for (var i=0; i<btns.length; i++) {
      btns[i].setAttribute('aria-pressed', btns[i].getAttribute('data-module') === moduleId ? 'true' : 'false');
    }
    for (var j=0; j<arts.length; j++) {
      var mods = (arts[j].getAttribute('data-modules') || '').split(',');
      if (moduleId === '__all__' || mods.indexOf(moduleId) !== -1) {
        arts[j].classList.remove('hidden');
      } else {
        arts[j].classList.add('hidden');
      }
    }
  }
  window.zerouCopy = copyText;
  window.zerouFilter = applyFilter;
  document.addEventListener('DOMContentLoaded', function(){
    document.querySelectorAll('[data-copy]').forEach(function(b){
      b.addEventListener('click', function(){ copyText(b.getAttribute('data-copy')); });
    });
    document.querySelectorAll('nav.module-filter button.filter-btn').forEach(function(b){
      b.addEventListener('click', function(){ applyFilter(b.getAttribute('data-module') || '__all__'); });
    });
  });
})();
`;
