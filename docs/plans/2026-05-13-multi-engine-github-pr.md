# Multi-Engine LLM + GitHub PR Workflow

> Plan dated 2026-05-13. Driven by user pivot:
> "我订阅了其它平台的tokenplan ... d2p是有自己的运作框架的。可以基于github来修改并且提pr之类的规范化迭代程序"
>
> Supersedes round-10 grill lock "不用key用cc" and extends round-8 lock
> "仓外 worktree + merge 回 main" with a parallel GitHub-PR session mode.

## 1. Plan

### A. LLM engine abstraction
Introduce `daemon/src/engines/` with a `LLMEngine` interface and 3
implementations. All current `agents/*` callers go through the engine
factory; the engine is chosen per-session from config.

Engines:
- `claude-cli` — current behavior (spawn `claude` binary). Default for
  back-compat. No config needed.
- `openai-compat` — OpenAI Chat Completions wire format. Configurable
  `baseUrl` covers OpenAI, OpenRouter, DeepSeek, Z.ai, Moonshot (Kimi),
  Qwen, vLLM, llama.cpp, etc.
- `anthropic-api` — direct Anthropic Messages API (no SDK; raw fetch).

### B. Session mode
Sessions gain a `mode` column: `local-merge` (current) or `github-pr`. In
`github-pr` mode, after a fix is reviewer-approved, the orchestrator:

1. Pushes `fix/<slug>` to the demo's `origin` remote.
2. Opens a PR via GitHub REST against the configured base branch.
3. Marks the gap DONE and continues the loop.
4. Does NOT auto-merge — user merges on GitHub. (Aligns with CLAUDE.md:
   "merge 必须先问用户".)

The GitHub token is stored in `~/.d2p/config.json` (or env
`D2P_GITHUB_TOKEN`), never inlined into prompts.

### C. Per-session config UX
A Settings page (UI) lets the user:
- pick engine + paste API key + set baseUrl + map model IDs
- pick session mode (local-merge / github-pr)
- paste GitHub PAT, configure base branch

## 2. Expected Outputs

```
daemon/src/
├── config/
│   ├── types.ts            # Config + EngineConfig + GitHubConfig
│   ├── load.ts             # read ~/.d2p/config.json with zod validation
│   └── load.test.ts
├── engines/
│   ├── types.ts            # LLMEngine interface, EngineCallOpts
│   ├── claude-cli.ts       # current behavior (moved here)
│   ├── openai-compat.ts    # POST /v1/chat/completions
│   ├── anthropic-api.ts    # POST /v1/messages
│   ├── factory.ts          # buildEngine(config) → LLMEngine
│   ├── openai-compat.test.ts
│   └── anthropic-api.test.ts
├── github/
│   ├── client.ts           # REST: createPR, getRepo, parse origin url
│   └── client.test.ts
├── git/
│   └── push.ts             # pushFixBranch(repo, slug, token) via PAT URL
├── storage/migrations/
│   └── 004-mode-github.ts  # sessions.mode, sessions.github_repo,
│                           #   sessions.base_branch, fixes.pr_number,
│                           #   fixes.pr_url
├── routes/
│   ├── config.ts           # GET/POST /api/config (redacts token in GET)
│   └── github.ts           # POST /api/github/configure-session, GET PR list
└── orchestrator/loop.ts    # branch on session.mode

ui/src/
├── pages/Settings.tsx      # accessible from any page header
├── components/
│   ├── EngineSelector.tsx
│   ├── GitHubSessionSetup.tsx
│   └── PRList.tsx          # for Workspace/Done view in PR mode
└── App.tsx                 # route to Settings
```

## 3. How To Verify

```bash
# Unit
npm test --workspace daemon          # adds ~15 new tests, all green

# Engine smokes (without burning real LLM credit):
node scripts/smoke-engines.mjs       # uses a local stub server for both
                                     #   openai-compat and anthropic-api
                                     # asserts JSON parse + role detection

# Existing walking-skeleton smoke (claude-cli mode) still passes:
node scripts/smoke-walking-skeleton.mjs

# Build:
npm run build                        # 3 workspaces clean
```

## 4. Probes

For each new engine module:
- Mock HTTP server returns canned `chat.completions` / `messages` response
- Engine call returns parsed JSON matching expected schema
- Token usage extraction from response headers/body works
- 401 / 429 / 5xx error paths set `ClaudeCallResult.code` correctly

For GitHub PR flow:
- Mock GitHub API returns PR object with number + html_url
- `createPR` includes correct `head`, `base`, `title`, `body`
- PAT is sent as `Authorization: token ...` (never logged)

## 5. Out of Scope (explicit ¬)

- PR auto-merge (CLAUDE.md: merge needs user)
- Post-PR reviewer loop with CI wait (Later; this PR opens the PR and
  stops — user reviews on GitHub)
- Anthropic SDK dependency (raw `fetch` keeps deps thin)
- Cost-cap (round-10 explicit ¬)
- Mobile UI (round-2 explicit ¬)

## 6. Done

- All new code typechecks
- ≥ 15 new unit tests pass; old 71 tests still pass
- Both smoke scripts pass
- README documents engine config + GitHub PR mode
- Pushed to `origin/main`
