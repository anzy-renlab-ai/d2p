import type { Migration } from './index.js';

export const m002Presets: Migration = {
  version: 2,
  name: 'presets',
  upSql: `
    CREATE TABLE preset_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      ts INTEGER NOT NULL,
      status_json TEXT NOT NULL
    );
    CREATE INDEX idx_preset_status_session_ts ON preset_status_history(session_id, ts DESC);

    CREATE TABLE repo_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      ts INTEGER NOT NULL,
      head_sha TEXT,
      summary_json TEXT NOT NULL
    );
    CREATE INDEX idx_repo_summaries_session_ts ON repo_summaries(session_id, ts DESC);
  `,
};
