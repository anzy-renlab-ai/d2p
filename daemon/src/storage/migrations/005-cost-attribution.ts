import type { Migration } from './index.js';

// F4 — extend cost_records with engine + cache columns so we can attribute
// spend per (role × engine) and surface cache hit % in the Mission Control
// dashboard. Cache columns default to 0 for existing rows; new inserts fill
// them when the engine response exposes cache token usage (anthropic-api
// always, openai-compat for providers that surface it like MiniMax / Moonshot).

export const m005CostAttribution: Migration = {
  version: 5,
  name: 'cost-attribution',
  upSql: `
    ALTER TABLE cost_records ADD COLUMN engine TEXT NOT NULL DEFAULT '';
    ALTER TABLE cost_records ADD COLUMN cache_read_tokens INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE cost_records ADD COLUMN cache_write_tokens INTEGER NOT NULL DEFAULT 0;
    CREATE INDEX idx_cost_session_role ON cost_records(session_id, role);
  `,
};
