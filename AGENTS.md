# Workbench (desktop)

Brand name: **Workbench** — a config-driven OpenCode desktop shell. Drop a
complete `.opencode/` profile into `app-config/`, build, and you get a dedicated
desktop app for that configuration. (Bundle identifier `com.workbench.app`;
internal `@workbench/*` package names.)

Project rules and working context for AI agents (Claude Code, Cursor, Codex,
etc.). `CLAUDE.md` is a symlink to this file — edit only `AGENTS.md`.

## Design principles

Keep it **simple, explicit, clear, complete**.

- **Simple** — no over-engineering; if not necessary, do not add entities.
- **Explicit** — no ambiguity; no bugs.
- **Clear** — understandable at a glance.
- **Complete** — cover the key points; prioritize safety.

## What this project is

A reusable, local-first desktop shell around the bundled OpenCode agent
runtime. The app ships no runtime configuration UI — providers, model, skills,
agents, commands, MCP, and permissions are all decided by the packager's
`app-config/.opencode/` profile and deployed to the app's private OpenCode
config dir on every sidecar start.

Recommended stack: **Electron + React + TypeScript + Vite**, Tailwind + Radix UI,
**OpenCode** as the agent runtime (bundled single-binary sidecar; HTTP + SSE
API), local workspace + JSONL provenance.

## Repository map

- `app-config/.opencode/` — the OpenCode profile the app bundles (packager-owned).
- `apps/desktop/` — Electron + React desktop shell (`src/` frontend, `src/main/` main process).
- `packages/` — `sdk` (the `OpenCodeClient` wrapper + agent-runtime abstraction),
  `shared` (domain types + patch overlay), `browser-mcp` / `terminal` /
  `scheduler` (Electron plugin packages), `ui` (placeholder).
- `runtime/` — `kernel` (Python/R bridges), `manager`, `mcp`.
- `scripts/` — release and dev scripts.
- `relay/` — **standalone project**: relay server + admin UI (`admin/`), self-owned
  pnpm workspace (own `pnpm-lock.yaml`). Protocol in `src/protocol.ts`.
- `client/` — **standalone project**: remote client (drive the desktop from
  phone/another machine), self-owned workspace including `sdk/`/`shared/` copies.

The three projects (Workbench, relay, client) are code-independent — they talk
over WS/HTTP only. Each owns a copy of the wire protocol contract
(`apps/desktop/src/main/relay-protocol.ts`, `relay/src/protocol.ts`,
`client/src/protocol.ts`); keep them in sync manually.

## Architecture guardrails

- The UI never calls OpenCode directly — it goes through `packages/sdk`
  (`OpenCodeClient`). Pin the OpenCode version (see
  `scripts/dev/fetch-opencode.sh`) and bundle it as a sidecar.
- Keep the frontend, desktop shell, and agent runtime decoupled.
- Skills, MCP servers, and model providers are pluggable through the `.opencode`
  profile — the app itself adds none at runtime.

## Engineering conventions (工程规范)

Quality gates live at the repo root (`pnpm format / lint / typecheck / test /
md:check`) and are the single source of truth: CI
(`.github/workflows/ci.yml`) calls the same scripts, never a separate
definition. Config files carry their rationale inline — 配置即文档, modeled on
openai/codex (see `.bazelrc`-style comments in `.prettierrc.toml`,
`.markdownlint-cli2.yaml`, `eslint.config.mjs`).

### Formatting (prettier + markdownlint + editorconfig)

- All code (ts/tsx/js/mjs/json/css/yaml) is prettier-formatted; run
  `pnpm format` after edits, `pnpm format:check` to verify.
- Markdown is owned by markdownlint (`pnpm md:check`), not prettier —
  Chinese docs keep long lines (MD013 relaxed to 240, tables exempt).
- Exemptions (same list in `.prettierignore` / `.markdownlint-cli2.yaml`):
  `docs/**/*.md` is prettier-ignored by design; build artifacts
  (out/dist/release), `app-config/` and `.zcode/` are excluded from both.

### Linting (eslint 9 flat)

- One root config (`eslint.config.mjs`) covers the whole repo. relay/client
  are separate workspaces but resolve the root config upward — always run
  `pnpm lint` from the repo root.
- Import order is enforced via simple-import-sort (`pnpm lint:fix`
  autofixes). `react-refresh/only-export-components` is intentionally off:
  mixed component/util exports are the existing style. `no-unused-vars` is a
  warning with `^_` ignore patterns — keep new code warning-free; a stray
  `require()` is only acceptable with a `eslint-disable-next-line` comment
  stating why the lazy load matters.

### Tests

- `pnpm test` runs desktop (vitest + jsdom), relay (vitest) and
  `packages/sdk` (vitest, node env). New core logic in sdk/shared should come
  with tests — `packages/sdk/src/mockServer.ts` makes client tests
  sidecar-free.
- The jsdom test setup (`apps/desktop/src/renderer/test/setup.ts`) stubs the
  Electron preload bridge (`window.electronAPI`) with a noop proxy (`on*`
  returns an unsubscribe, other methods resolve undefined), so AppShell-level
  tests can mount components that subscribe to IPC. Tests that need to assert
  a specific call can overwrite the property or `vi.spyOn` it.

### Versioning

- Single version source: root `package.json` `version`; all workspace
  packages stay in lockstep at the same number.
- Bump patch for bugfixes, minor for UI/protocol changes. Update the
  Unreleased section of `CHANGELOG.md` in the same commit; when releasing,
  archive it under the version and tag `v<version>`.

## Safety defaults (non-negotiable for the desktop)

- The agent may only access the current workspace.
- Command execution, file deletion, dependency install, and remote connections
  require approval (manual approval mode by default — never ship `full`).
- API keys go to the app-private config dir; never into provenance, logs, crash
  reports, git, or exported projects.

## Working conventions

- Default working language for discussion is Chinese; **all project files and
  code are in English** (this is a pure-English project).
- Avoid adding new Markdown docs unless requested — too many docs become debt.
- Prefer minimal, verifiable changes; every step should produce a checkable result.
- Do not write inferences as verified facts; tie conclusions to code or data.

## Karpathy programming guidelines

Derived from [Andrej Karpathy's observations](https://x.com/karpathy/status/2015883857489522876)
on LLM coding pitfalls. These guidelines bias toward caution over speed.

### 1. Think before coding

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity first

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

### 3. Surgical changes

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.
- Remove imports/variables/functions that YOUR changes made unused.
- Every changed line should trace directly to the user's request.

### 4. Goal-driven execution

- Define success criteria. Loop until verified.
- Transform tasks into verifiable goals: "Write a test that reproduces it, then make it pass."
- For multi-step tasks, state a brief plan with verification steps.
- Strong success criteria let you loop independently. Weak criteria require constant clarification.

## 用户偏好

<!-- 用户说"请记住""下次要""不能"时，agent 自动追加到此列表 -->

- 方案文档、注释、README 等所有文档类内容默认使用简体中文。代码（变量名、函数名等）保持英文。
- 需求变更流程：先在 docs/ 下生成方案文档，再修改代码。方案文档必须包含「设计」和「验证状态」两个章节。
- 方案文档命名格式：`YYYYMMDD-NN-描述.md`（日期 + 两位序号 + 描述）。
