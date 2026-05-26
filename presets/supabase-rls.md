---
id: supabase-rls
version: 2
name: Supabase Row-Level Security check
appliesTo: []
rules:
  - ruleId: rls-policy-file-present
    label: Supabase RLS policy migration file required
    severity: P1
    mechanism: file-exists
    source: supabase-rls/v2
    rationale: Without an RLS policy migration, every Supabase table defaults to no row-level checks, exposing arbitrary client reads/writes.
    detection:
      paths:
        - supabase/migrations/000_rls.sql
      expect: present
    fix:
      kind: template
      command: "echo 'create supabase/migrations/000_rls.sql with ENABLE ROW LEVEL SECURITY statements per table'"
      verifyCommand: "test -f supabase/migrations/000_rls.sql"
  - ruleId: enable-rls-statement-present
    label: ENABLE ROW LEVEL SECURITY statement must appear in migrations
    severity: P1
    mechanism: static-grep
    source: supabase-rls/v2
    rationale: Even with a migrations dir, RLS only activates when each table has an explicit ENABLE ROW LEVEL SECURITY. This grep confirms the directive is referenced at least once.
    detection:
      pattern: ENABLE ROW LEVEL SECURITY
      filePattern: supabase/migrations/*.sql
    fix:
      kind: template
      command: "echo 'add ENABLE ROW LEVEL SECURITY statements to each table migration'"
      verifyCommand: "grep -r 'ENABLE ROW LEVEL SECURITY' supabase/migrations/"
---

# Supabase RLS check

Supabase tables default to no row-level security. Without RLS policies any
anon client can read/write any row, making the database effectively public.

## Two-rule structure

1. **`rls-policy-file-present`** — a migration file dedicated to RLS exists.
2. **`enable-rls-statement-present`** — the directive appears in at least
   one migration file (this rule deliberately uses `static-grep` rather than
   `file-exists` to assert content, not just file existence).

Note: rule 2 inverts the typical "finding = bad" semantics — here the
*absence* of the pattern is what would matter. For v0.2 we report each
matching line as evidence the directive is present; integrating projects
should pair this with project-level "fail if zero findings".

## Remediation

```sql
-- supabase/migrations/000_rls.sql
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can read own row"
  ON public.users
  FOR SELECT
  USING (auth.uid() = id);
```

Run `supabase db push` after authoring; then re-run `zerou audit`.
