import type { Migration } from './index.js';

export const m003Cost: Migration = {
  version: 3,
  name: 'cost',
  upSql: `
    CREATE TABLE cost_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      ts INTEGER NOT NULL
    );
    CREATE INDEX idx_cost_session ON cost_records(session_id, ts);
  `,
};
