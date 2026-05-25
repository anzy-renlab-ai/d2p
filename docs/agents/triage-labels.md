# Triage Labels

The Matt Pocock engineering skills speak in terms of five canonical triage roles (a state machine). This repo additionally uses **priority** and **type** label axes that are orthogonal to the triage state.

## Triage state labels (state machine — used by `triage` skill)

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding string from the right-hand column.

## Priority labels (always apply exactly one)

| Label | Meaning                                                                   |
| ----- | ------------------------------------------------------------------------- |
| `p1`  | Must-fix in current PR / sprint. Blocks merge or ship.                    |
| `p2`  | Should-fix before next release. Acceptable to land in a follow-up PR.     |
| `p3`  | Nice-to-have / nit / cosmetic. Acceptable to defer indefinitely.          |

The CLAUDE.md `POSTPR` hard rule (P1/P2 must be fixed in the current PR, P3 may be deferred) hinges on this vocabulary. Reviewer verdicts use the same letters.

## Type labels (always apply exactly one)

| Label   | Meaning                                                                |
| ------- | ---------------------------------------------------------------------- |
| `bug`   | Existing behavior is wrong. Conventional commit prefix: `fix(...)`.    |
| `feat`  | New capability or public surface. Conventional commit prefix: `feat(...)`. |
| `chore` | Maintenance, refactor, docs, deps. Conventional commit prefix: `chore(...)` / `docs(...)` / `refactor(...)`. |

## Combination rule

Every open issue MUST carry: one triage state + one priority + one type label.
Example: `needs-triage` + `p2` + `bug`.
