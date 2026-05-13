import type { Migration } from './index.js';

export const m004ModeGithub: Migration = {
  version: 4,
  name: 'mode-github',
  upSql: `
    ALTER TABLE sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'local-merge'
      CHECK (mode IN ('local-merge','github-pr'));
    ALTER TABLE sessions ADD COLUMN github_repo TEXT;
    ALTER TABLE sessions ADD COLUMN base_branch TEXT NOT NULL DEFAULT 'main';

    ALTER TABLE fixes ADD COLUMN pr_number INTEGER;
    ALTER TABLE fixes ADD COLUMN pr_url TEXT;
  `,
};
