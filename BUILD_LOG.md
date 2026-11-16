# Build log

A short record of how this project was built, one step at a time.

## 01. First Claude API call

- Goal: call the Messages API from TypeScript and inspect the response.
- Example: `npm run example:01` runs `src/examples/01-first-call.ts`.
- Learned:
  - The response `content` is a list of blocks, not a string.
  - `stop_reason` says why generation ended (`end_turn`, `max_tokens`, `tool_use`).
  - `usage` reports input and output tokens, plus prompt-cache counters.
  - Setting `max_tokens` too low truncates the answer, so code must check `stop_reason`.

## 03. First tool, end to end

- Goal: one tool (`get_latest_reading`) through the full tool_use / tool_result round trip.
- Example: `npm run example:03`.
- Learned:
  - Claude requests tools; our code runs them. Every `tool_use` id needs a matching `tool_result`.
  - Tool input is untrusted: validate it (zod) before running.
  - Failures return as `is_error` results with a category and retryable flag, never as crashes.

## 04. The agent loop

- Goal: repeat model calls until `stop_reason` is no longer `tool_use`.
- Examples: `npm run example:04-checks` (offline, scripted fake model) and `npm run example:04` (real API).
- Learned:
  - `stop_reason` drives the loop; the iteration cap is only a safety net.
  - Parallel tool calls are answered together in one user message.
  - A tool_use cut off by `max_tokens` must be dropped, or the next call fails.
  - Hiding the SDK behind an `LlmClient` interface makes the loop testable for free.
  - History is just an array; reusing it gives multi-turn memory.
