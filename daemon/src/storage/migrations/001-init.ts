import type { Migration } from './index.js';

export const m001Init: Migration = {
  version: 1,
  name: 'init',
  upSql: `
    CREATE TABLE demos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      first_seen_at INTEGER NOT NULL,
      last_session_at INTEGER,
      inferred_type TEXT
    );
    CREATE INDEX idx_demos_path ON demos(path);

    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      demo_id INTEGER NOT NULL REFERENCES demos(id) ON DELETE CASCADE,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      status TEXT NOT NULL CHECK (status IN ('SETUP','LOOPING','PAUSED','DONE','ENDED')),
      vision_md_path TEXT,
      preset_type TEXT
    );
    CREATE INDEX idx_sessions_demo ON sessions(demo_id);
    CREATE INDEX idx_sessions_status ON sessions(status);

    CREATE TABLE vision_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      round_index INTEGER NOT NULL,
      question_id TEXT NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(session_id, question_id)
    );
    CREATE INDEX idx_vision_drafts_session ON vision_drafts(session_id);

    CREATE TABLE gaps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      category TEXT NOT NULL,
      severity TEXT NOT NULL CHECK (severity IN ('P1','P2','P3')),
      source TEXT NOT NULL CHECK (source IN ('preset','vision','both')),
      suggested_approach TEXT NOT NULL,
      expected_files_changed TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('PENDING','IN_PROGRESS','DONE','SKIPPED','NEED_HUMAN','SPLIT_DONE')),
      dynamic_k INTEGER,
      parent_gap_id INTEGER REFERENCES gaps(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      finished_at INTEGER,
      UNIQUE(session_id, slug)
    );
    CREATE INDEX idx_gaps_session_status ON gaps(session_id, status);

    CREATE TABLE fixes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gap_id INTEGER NOT NULL REFERENCES gaps(id) ON DELETE CASCADE,
      attempt INTEGER NOT NULL,
      branch TEXT NOT NULL,
      worktree_path TEXT NOT NULL,
      commit_sha TEXT,
      static_gate_passed INTEGER,
      alignment_score REAL,
      reviewer_verdict TEXT,
      reason_code TEXT,
      status TEXT NOT NULL CHECK (status IN (
        'STARTED','IMPLEMENTING','STATIC_GATE_RUNNING','STATIC_GATE_FAILED',
        'ALIGNMENT_RUNNING','ALIGNMENT_FAILED','BEHAVIORAL_RUNNING','BEHAVIORAL_FAILED',
        'ADVERSARIAL_RUNNING','ADVERSARIAL_FAILED','MERGED','DROPPED'
      )),
      stderr_excerpt TEXT,
      files_changed TEXT,
      confidence REAL,
      created_at INTEGER NOT NULL,
      finished_at INTEGER,
      UNIQUE(gap_id, attempt)
    );
    CREATE INDEX idx_fixes_gap ON fixes(gap_id);

    CREATE TABLE reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fix_id INTEGER NOT NULL REFERENCES fixes(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('alignment','behavioral','adversarial')),
      model TEXT NOT NULL CHECK (model IN ('haiku','sonnet','opus')),
      verdict TEXT,
      hints TEXT,
      reason_code TEXT,
      difficulty INTEGER,
      split_into TEXT,
      raw_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX idx_reviews_fix ON reviews(fix_id);

    CREATE TABLE log_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      ts INTEGER NOT NULL,
      level TEXT NOT NULL CHECK (level IN ('info','warn','error')),
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX idx_log_events_session_ts ON log_events(session_id, ts);

    CREATE TABLE runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
      gap_id INTEGER REFERENCES gaps(id) ON DELETE SET NULL,
      fix_id INTEGER REFERENCES fixes(id) ON DELETE SET NULL,
      role TEXT NOT NULL,
      model TEXT,
      prompts_version INTEGER,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      exit_code INTEGER,
      duration_ms INTEGER,
      ok INTEGER NOT NULL CHECK (ok IN (0,1)),
      error_code TEXT,
      error_message TEXT
    );
    CREATE INDEX idx_runs_session ON runs(session_id);
    CREATE INDEX idx_runs_role ON runs(role, started_at DESC);
  `,
};
