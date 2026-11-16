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

## 05. Tool registry and the full tool set

- Goal: grow from one tool to seven (`list_buildings`, `list_meters`, `get_latest_reading`, `query_timeseries`, `compare_to_baseline`, `list_alarms`, `create_ticket`).
- Examples: `npm run example:05-checks` (offline) and `npm run chat` (interactive, real API).
- Learned:
  - Tool descriptions are the main routing signal: say what it does, when to use it, and what it does not do.
  - Bound tool output (200 buckets max) and make errors suggest a fix, so the model can self-correct.
  - Do the arithmetic in code (baseline comparison), not in the model.
  - Mark state-changing tools (`risk: "write"`); approvals come next.

## 06. Policy hook and human approval

- Goal: stop state-changing actions until a person approves, without trusting the model to decide.
- Examples: `npm run example:06-checks` (offline) and `npm run chat` (interactive).
- Learned:
  - Order is validate, then policy, then approval, then run; the human sees exactly the input that executes.
  - Default by declared risk (fail safe): anything that is not a read needs approval.
  - Never key a safety rule on a field the model chooses freely (a model could pick a lower priority to skip approval).
  - A declined action is a normal `permission` result; the prompt tells the model not to work around it.
  - No approver means denied (fail closed). Concurrent prompts are queued.

## 08. Web UI

- Goal: a chat UI over the SSE API with a live tool trace, approval buttons and a usage status bar.
- Check: `npm run example:08-checks` (static files, CSP-safe, no unsafe DOM APIs, valid JS syntax).
- Learned:
  - Helmet's CSP blocks inline scripts, so the front-end is a separate file.
  - Model output is untrusted: build DOM nodes with textContent, never innerHTML.
  - A queue between the SSE reader and the renderer keeps animation from blocking the stream.
  - Stop = abort the fetch; the server cancels the loop and denies pending approvals.
  - Status bar sums input + cache read + cache write to show the real prompt size and hit rate.
