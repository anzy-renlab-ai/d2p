import type { Migration } from './index.js';

// Batch git-pro-backend (2026-05-19):
// - commit_risk: stores AI/rule risk scoring results per commit sha
// - milestones: vision-level milestone tracking per session
// - session_resume_marks: persists the last known pause point for crash recovery UI

export const m007RiskAndMilestones: Migration = {
  version: 7,
  name: 'risk-and-milestones',
  upSql: `
    CREATE TABLE commit_risk (
      sha TEXT PRIMARY KEY,
      band TEXT NOT NULL CHECK(band IN ('low','mid','high')),
      score REAL NOT NULL,
      reasons_json TEXT NOT NULL,
      review_hunks_json TEXT NOT NULL,
      ts INTEGER NOT NULL
    );

    CREATE TABLE milestones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      vision_excerpt TEXT,
      preset_item_ids_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL CHECK(status IN ('pending','in_progress','done')) DEFAULT 'pending',
      ordinal INTEGER NOT NULL DEFAULT 0,
      completed_at INTEGER
    );

    CREATE INDEX idx_milestones_session ON milestones(session_id, ordinal);

    CREATE TABLE session_resume_marks (
      session_id INTEGER PRIMARY KEY,
      last_seen_ts INTEGER NOT NULL,
      gap_id_at_pause INTEGER,
      run_id_at_pause TEXT
    );
  `,
};
