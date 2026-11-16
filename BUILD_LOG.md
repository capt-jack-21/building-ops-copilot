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
