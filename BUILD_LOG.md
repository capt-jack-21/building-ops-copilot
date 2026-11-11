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
