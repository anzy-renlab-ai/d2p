// Mock data for the mockup-first phase UI.
// Used by Preview pages and MockupPhasePanel tests.
// The real daemon will replace these with live SSE data in Batch 4.

export type MockupPhaseState = {
  sessionId: number;
  phase: 'drafting' | 'review' | 'approved' | 'revising';
  /** Total pages expected (used for progress during drafting). */
  totalPages: number;
  pages: MockupPage[];
  approvedAt: number | null;
  userFeedback: string | null;
};

export type MockupPage = {
  /** Short identifier, e.g. "landing" */
  name: string;
  /** Route path, e.g. "/" or "/dashboard" */
  route: string;
  /** Human title shown in the nav thumbnail */
  title: string;
  /** One-line description of this page's purpose */
  description: string;
  /** data:text/html URL for embedding in an iframe — present when page is ready */
  htmlPreviewSrc?: string;
};

// ---------------------------------------------------------------------------
// HTML previews for the three saas-web demo pages
// ---------------------------------------------------------------------------

const landingHtml = `data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #F5F2EC; color: #1F1F1E; }
  nav { display: flex; align-items: center; justify-content: space-between; padding: 16px 40px; background: #FAF9F5; border-bottom: 1px solid #E5E1D8; }
  nav .logo { font-weight: 700; font-size: 18px; letter-spacing: -0.5px; }
  nav .actions { display: flex; gap: 10px; }
  nav button { padding: 7px 16px; border-radius: 6px; border: 1px solid #E5E1D8; background: #FAF9F5; cursor: pointer; font-size: 13px; }
  nav button.cta { background: #C96442; color: #fff; border-color: #C96442; }
  .hero { text-align: center; padding: 80px 40px 60px; }
  .hero h1 { font-size: 48px; font-weight: 700; letter-spacing: -1px; line-height: 1.1; margin-bottom: 20px; }
  .hero p { font-size: 18px; color: #5E5C57; max-width: 480px; margin: 0 auto 32px; line-height: 1.6; }
  .hero .cta-row { display: flex; gap: 12px; justify-content: center; }
  .hero .cta-row button { padding: 12px 24px; border-radius: 8px; font-size: 15px; cursor: pointer; border: none; }
  .hero .cta-row .primary { background: #C96442; color: #fff; }
  .hero .cta-row .secondary { background: #FAF9F5; border: 1px solid #E5E1D8; color: #1F1F1E; }
  .features { display: flex; gap: 24px; padding: 40px; max-width: 960px; margin: 0 auto; }
  .feature { flex: 1; background: #FAF9F5; border: 1px solid #E5E1D8; border-radius: 10px; padding: 24px; }
  .feature h3 { font-size: 15px; font-weight: 600; margin-bottom: 8px; }
  .feature p { font-size: 13px; color: #5E5C57; line-height: 1.5; }
  .badge { display: inline-block; background: #EEF3EC; color: #587A4C; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 4px; margin-bottom: 10px; }
</style>
</head>
<body>
<nav>
  <div class="logo">NoteFlow</div>
  <div class="actions">
    <button>Log in</button>
    <button class="cta">Get started free</button>
  </div>
</nav>
<section class="hero">
  <h1>Notes that think<br>with you</h1>
  <p>Capture ideas, sync across devices, and find anything in seconds. Built for people who think in notes.</p>
  <div class="cta-row">
    <button class="primary">Start for free</button>
    <button class="secondary">See demo</button>
  </div>
</section>
<div class="features">
  <div class="feature"><div class="badge">CORE</div><h3>Smart Search</h3><p>Full-text search across all your notes with inline highlights. Find anything instantly.</p></div>
  <div class="feature"><div class="badge">SYNC</div><h3>Multi-device</h3><p>Changes sync in real-time across all your devices. Works offline too.</p></div>
  <div class="feature"><div class="badge">SECURE</div><h3>End-to-end encrypted</h3><p>Your notes are encrypted before they leave your device. Only you can read them.</p></div>
</div>
</body>
</html>`)}`;

const dashboardHtml = `data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #F5F2EC; color: #1F1F1E; display: flex; height: 100vh; }
  aside { width: 220px; background: #FAF9F5; border-right: 1px solid #E5E1D8; display: flex; flex-direction: column; padding: 20px 0; flex-shrink: 0; }
  .sidebar-logo { font-weight: 700; font-size: 16px; padding: 0 20px 20px; border-bottom: 1px solid #E5E1D8; margin-bottom: 12px; }
  .sidebar-nav a { display: block; padding: 8px 20px; font-size: 13px; color: #5E5C57; text-decoration: none; border-radius: 0 6px 6px 0; margin: 2px 8px 2px 0; }
  .sidebar-nav a.active { background: #F0D9CC; color: #C96442; font-weight: 500; }
  .sidebar-nav a:hover:not(.active) { background: #F5F2EC; }
  main { flex: 1; overflow-y: auto; padding: 24px 32px; }
  .top-bar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
  .top-bar h1 { font-size: 22px; font-weight: 700; letter-spacing: -0.5px; }
  .top-bar button { padding: 8px 16px; background: #C96442; color: #fff; border: none; border-radius: 6px; font-size: 13px; cursor: pointer; }
  .search { width: 240px; padding: 7px 12px; border: 1px solid #E5E1D8; border-radius: 6px; background: #FAF9F5; font-size: 13px; }
  .notes-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .note-card { background: #FAF9F5; border: 1px solid #E5E1D8; border-radius: 10px; padding: 18px; cursor: pointer; transition: box-shadow 0.15s; }
  .note-card:hover { box-shadow: 0 2px 8px rgba(31,31,30,0.08); }
  .note-card h3 { font-size: 14px; font-weight: 600; margin-bottom: 6px; }
  .note-card p { font-size: 12px; color: #5E5C57; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .note-card .meta { font-size: 11px; color: #5E5C57; margin-top: 10px; }
  .tag { display: inline-block; background: #EEF3EC; color: #587A4C; font-size: 10px; padding: 2px 7px; border-radius: 4px; margin-right: 4px; }
</style>
</head>
<body>
<aside>
  <div class="sidebar-logo">NoteFlow</div>
  <nav class="sidebar-nav">
    <a href="#" class="active">All Notes</a>
    <a href="#">Favorites</a>
    <a href="#">Shared</a>
    <a href="#">Trash</a>
  </nav>
</aside>
<main>
  <div class="top-bar">
    <h1>All Notes</h1>
    <div style="display:flex;gap:10px;align-items:center">
      <input class="search" placeholder="Search notes…" />
      <button>+ New note</button>
    </div>
  </div>
  <div class="notes-grid">
    <div class="note-card"><h3>Project roadmap Q3</h3><p>Key milestones for the upcoming quarter. Auth overhaul, new dashboard, mobile app beta, and API v2 launch.</p><div class="meta"><span class="tag">work</span><span class="tag">roadmap</span> · 2 hours ago</div></div>
    <div class="note-card"><h3>Meeting notes — design sync</h3><p>Discussed new color palette, component library migration, and responsive breakpoints for the next sprint.</p><div class="meta"><span class="tag">design</span> · Yesterday</div></div>
    <div class="note-card"><h3>Book recommendations</h3><p>The Pragmatic Programmer, SICP, A Philosophy of Software Design, Designing Data-Intensive Applications.</p><div class="meta"><span class="tag">reading</span> · 3 days ago</div></div>
    <div class="note-card"><h3>API design principles</h3><p>REST vs GraphQL tradeoffs, versioning strategy, error response shapes, rate limiting per tier.</p><div class="meta"><span class="tag">dev</span> · 5 days ago</div></div>
    <div class="note-card"><h3>Weekly review — May 18</h3><p>Finished auth middleware, unblocked design team, reviewed 3 PRs. Next: tackle search indexing performance.</p><div class="meta"><span class="tag">review</span> · 1 week ago</div></div>
    <div class="note-card"><h3>Ideas for new features</h3><p>AI-powered tagging, collaborative editing, export to Notion/Obsidian, keyboard shortcut customization.</p><div class="meta"><span class="tag">ideas</span> · 2 weeks ago</div></div>
  </div>
</main>
</body>
</html>`)}`;

const settingsHtml = `data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #F5F2EC; color: #1F1F1E; }
  .page { max-width: 680px; margin: 0 auto; padding: 40px 24px; }
  h1 { font-size: 24px; font-weight: 700; letter-spacing: -0.5px; margin-bottom: 8px; }
  .subtitle { color: #5E5C57; font-size: 14px; margin-bottom: 32px; }
  .section { background: #FAF9F5; border: 1px solid #E5E1D8; border-radius: 10px; padding: 24px; margin-bottom: 20px; }
  .section h2 { font-size: 14px; font-weight: 600; margin-bottom: 16px; }
  .field { margin-bottom: 16px; }
  .field label { display: block; font-size: 12px; font-weight: 500; color: #5E5C57; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; }
  .field input, .field select { width: 100%; padding: 8px 12px; border: 1px solid #E5E1D8; border-radius: 6px; background: #F5F2EC; font-size: 14px; color: #1F1F1E; }
  .field input:focus, .field select:focus { outline: none; border-color: #C96442; }
  .toggle-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #E5E1D8; }
  .toggle-row:last-child { border-bottom: none; }
  .toggle-row .label { font-size: 14px; }
  .toggle-row .desc { font-size: 12px; color: #5E5C57; margin-top: 2px; }
  .toggle { width: 36px; height: 20px; background: #C96442; border-radius: 10px; position: relative; cursor: pointer; flex-shrink: 0; }
  .toggle::after { content: ''; position: absolute; top: 3px; right: 3px; width: 14px; height: 14px; background: #fff; border-radius: 50%; }
  .toggle.off { background: #E5E1D8; }
  .toggle.off::after { right: auto; left: 3px; }
  .save-btn { background: #C96442; color: #fff; border: none; border-radius: 6px; padding: 10px 24px; font-size: 14px; cursor: pointer; margin-top: 4px; }
  .danger { border-color: #B23A48; }
  .danger h2 { color: #B23A48; }
  .danger-btn { background: transparent; color: #B23A48; border: 1px solid #B23A48; border-radius: 6px; padding: 8px 16px; font-size: 13px; cursor: pointer; }
</style>
</head>
<body>
<div class="page">
  <h1>Settings</h1>
  <p class="subtitle">Manage your account, preferences, and integrations.</p>

  <div class="section">
    <h2>Profile</h2>
    <div class="field"><label>Display name</label><input value="Alice Chen" /></div>
    <div class="field"><label>Email</label><input value="alice@example.com" /></div>
    <button class="save-btn">Save changes</button>
  </div>

  <div class="section">
    <h2>Preferences</h2>
    <div class="toggle-row"><div><div class="label">Dark mode</div><div class="desc">Switch to dark theme</div></div><div class="toggle off"></div></div>
    <div class="toggle-row"><div><div class="label">Email digest</div><div class="desc">Weekly summary of your notes activity</div></div><div class="toggle"></div></div>
    <div class="toggle-row"><div><div class="label">Keyboard shortcuts</div><div class="desc">Enable global keyboard shortcuts</div></div><div class="toggle"></div></div>
  </div>

  <div class="section danger">
    <h2>Danger zone</h2>
    <div class="toggle-row"><div><div class="label">Delete account</div><div class="desc">Permanently delete your account and all notes</div></div><button class="danger-btn">Delete account</button></div>
  </div>
</div>
</body>
</html>`)}`;

// ---------------------------------------------------------------------------
// The four canned states
// ---------------------------------------------------------------------------

/** mockup-implementer just started, 0 pages ready yet */
export const mockupDrafting: MockupPhaseState = {
  sessionId: 1,
  phase: 'drafting',
  totalPages: 3,
  pages: [],
  approvedAt: null,
  userFeedback: null,
};

/** All 3 pages ready; user is reviewing */
export const mockupReview: MockupPhaseState = {
  sessionId: 1,
  phase: 'review',
  totalPages: 3,
  pages: [
    {
      name: 'landing',
      route: '/',
      title: 'Landing',
      description: '首页 — 价值主张、CTA、三大核心功能介绍',
      htmlPreviewSrc: landingHtml,
    },
    {
      name: 'dashboard',
      route: '/dashboard',
      title: 'Dashboard',
      description: '主工作区 — 笔记列表、搜索、新建入口',
      htmlPreviewSrc: dashboardHtml,
    },
    {
      name: 'settings',
      route: '/settings',
      title: 'Settings',
      description: '账户设置 — 个人资料、偏好、危险操作',
      htmlPreviewSrc: settingsHtml,
    },
  ],
  approvedAt: null,
  userFeedback: null,
};

/** User submitted feedback; implementer is re-running */
export const mockupRevising: MockupPhaseState = {
  ...mockupReview,
  phase: 'revising',
  userFeedback: '仪表盘的侧边栏太宽了，能不能缩成 180px？另外首页的 CTA 按钮颜色再亮一点。',
};

/** User approved; differ is now running */
export const mockupApproved: MockupPhaseState = {
  ...mockupReview,
  phase: 'approved',
  approvedAt: Date.now() - 45_000,
  userFeedback: null,
};
