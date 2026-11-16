# Building Ops Copilot

TypeScript/Node agent for smart-building operations, built on the Claude Messages API. Public showcase repo: keep it clean, tested and honest.

## Commands

- `npm run dev` start the server (demo mode if no `ANTHROPIC_API_KEY`; `DEMO_MODE=1` forces it)
- `npm run verify` typecheck + lint + prettier check + tests. Run before finishing any change.
- `npm test` runs every offline check script (`src/examples/*-checks.ts`) through vitest
- `npm run format` applies prettier

## Architecture (see docs/architecture.svg)

- `src/agent/loop.ts` tool-use loop, driven by `stop_reason`; emits `AgentEvent`s
- `src/agent/llm.ts` the `LlmClient` interface; `anthropicClient.ts` (real, caching + streaming) and `demoClient.ts` (scripted)
- `src/tools/` one file per tool via `defineTool` (zod schema = validator = JSON schema); register in `index.ts`
- `src/policy/` rules decide allow / require_approval; `src/approvals/` + `server/webApprovalBroker.ts` ask a human
- `src/domain/types.ts` + `src/data/` the `TelemetryRepository` interface and its in-memory implementation (a TimescaleDB one is planned)
- `src/server/` Express app, SSE, sessions, `/api/twin`
- `public/` vanilla JS/CSS UI, no build step

## Rules

- Never use `innerHTML`/`outerHTML`/`insertAdjacentHTML` in `public/`: model output is untrusted. Build DOM with `textContent`. ESLint enforces this.
- No inline scripts: the CSP is `script-src 'self'`.
- Tools never touch data directly; they go through `ctx.repo`.
- Tool handlers return small JSON and throw `ToolError` for expected failures; `executeTool` never throws.
- Any state-changing tool is `risk: "write"` or `"critical"` and goes through the policy gate.
- CI and tests must not need an API key or network; use the demo model.
- TypeScript is pinned to 6.0.x because typescript-eslint does not support 7 yet.
- Windows/PowerShell is the author's environment: keep scripts cross-platform (Node), not shell-specific.

## Adding a tool

Use the `/add-tool` slash command.
