---
id: supabase-rls
version: 2
name: Supabase Row-Level Security check
appliesTo: []
rules:
  - ruleId: supabase-service-role-in-client
    label: Supabase service-role key used outside server-only paths
    severity: P1
    mechanism: static-grep
    source: supabase-rls/v2
    rationale: `SUPABASE_SERVICE_ROLE_KEY` bypasses every RLS policy and grants full DB access. It must only ever appear in server-side code (Next.js `app/api/`, route handlers, server actions, Node scripts). Any reference in client-side bundles leaks the key to the browser and is functionally identical to a public master password.
    detection:
      pattern: createClient\s*\([^)]*SUPABASE_SERVICE_ROLE_KEY
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: llm-only
      command: "echo 'manual remediation: move createClient(...SERVICE_ROLE_KEY) into server-only code (Next.js app/api/, route handlers); use ANON_KEY + RLS policies for client'"
      verifyCommand: "echo 'manual review required — confirm file path is server-only'"
  - ruleId: supabase-no-rls-policy
    label: Migration defines table without enabling RLS + policies
    severity: P2
    mechanism: llm-judgment
    source: supabase-rls/v2
    rationale: Supabase tables default to no row-level security. Every `create table` in a migration should be followed by `alter table ... enable row level security;` and at least one `create policy` statement. LLM judges whether each table has both.
    detection:
      pattern: create\s+table
      filePattern: supabase/migrations/*.sql
    fix:
      kind: llm-only
      command: "echo 'manual remediation: append alter table NAME enable row level security; + create policy stanzas to every create table migration'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: supabase-disable-rls
    label: Migration disables row level security
    severity: P1
    mechanism: static-grep
    source: supabase-rls/v2
    rationale: `alter table ... disable row level security` removes ALL access control on the table — anon clients can read and write any row. There is essentially no legitimate reason to ship this in production; if a migration emits it, the table is exposed.
    detection:
      pattern: disable\s+row\s+level\s+security
      filePattern: supabase/migrations/*.sql
    fix:
      kind: template
      command: "echo 'manual remediation: remove disable row level security from the migration. If a service path needs full access, use the service-role key from server code, not RLS disable.'"
      verifyCommand: "! grep -rE 'disable\\s+row\\s+level\\s+security' supabase/migrations/"
  - ruleId: supabase-from-without-eq
    label: supabase.from(...).select() without an .eq() filter (LLM-judged)
    severity: P2
    mechanism: llm-judgment
    source: supabase-rls/v2
    rationale: Calls like `supabase.from('users').select()` rely entirely on RLS to filter rows. If RLS is misconfigured the call returns every row. Best practice is to explicitly `.eq('id', auth.uid())` so the intent is visible and a missing RLS policy fails closed at the application layer too.
    detection:
      pattern: supabase\.from\s*\(\s*['"][^'"]+['"]\s*\)\s*\.select\s*\(
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: llm-only
      command: "echo 'manual remediation: chain .eq(column, value) after .select() so the application also constrains the query — defence in depth alongside RLS'"
      verifyCommand: "echo 'manual review required'"
---

# Supabase Row-Level Security check

Supabase tables default to no row-level security. Without RLS policies, any
anon client can read or write any row, making the database effectively public.
The risk doubles when the service-role key (which bypasses RLS) is referenced
from client-side code.

## Rules

1. **`supabase-service-role-in-client`** — `createClient(...SERVICE_ROLE_KEY...)`
   appearing anywhere outside server-only paths.
2. **`supabase-no-rls-policy`** — `create table` migrations without a paired
   `enable row level security` + policy (LLM-judged).
3. **`supabase-disable-rls`** — `disable row level security` statements in
   migrations.
4. **`supabase-from-without-eq`** — `supabase.from(...).select()` without
   an `.eq()` filter — relies entirely on RLS (LLM-judged).

## Remediation

### Enable RLS + write a policy

```sql
-- supabase/migrations/000_rls.sql
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  body text not null
);

alter table public.notes enable row level security;

create policy "users read own notes"
  on public.notes for select
  using (auth.uid() = user_id);

create policy "users insert own notes"
  on public.notes for insert
  with check (auth.uid() = user_id);
```

### Keep service-role key server-only

```ts
// app/api/admin/route.ts — server-only, fine
import { createClient } from '@supabase/supabase-js';
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// components/Dashboard.tsx — NEVER
const admin = createClient(URL, process.env.NEXT_PUBLIC_SERVICE_KEY!); // leaks to browser
```

### Defence in depth — explicit filters

```ts
// Bad — trusts RLS entirely
const { data } = await supabase.from('notes').select();

// Good — filter at the app layer too
const { data } = await supabase
  .from('notes')
  .select()
  .eq('user_id', session.user.id);
```

Run `supabase db push` after authoring migrations; then re-run `zerou audit`.
