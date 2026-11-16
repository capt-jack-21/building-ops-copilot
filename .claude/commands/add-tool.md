---
description: Add a new tool to the agent (schema, handler, registration, test)
argument-hint: <tool_name> <what it does>
---

Add a new agent tool: $ARGUMENTS

Follow the existing pattern exactly:

1. Read `src/tools/listAlarms.ts` (read tool) and `src/tools/createTicket.ts` (write tool) as references, and `src/tools/types.ts` for `defineTool`.
2. Create `src/tools/<camelCaseName>.ts` using `defineTool`:
   - `name` is snake_case, letters/digits/`_`/`-` only.
   - `description` says WHEN to use the tool and how it relates to other tools (the model chooses tools from this text).
   - `risk` is `read`, `write` or `critical`. Anything that changes state is not `read`.
   - `inputSchema` is a `z.object` with `.describe()` on every field; bound numbers with `.min/.max`.
   - Return small, plain JSON (trim lists; include IDs the model can chain into the next call). Throw `ToolError` for expected failures.
3. If the tool needs new data access, extend `TelemetryRepository` in `src/domain/types.ts` and implement it in `src/data/inMemoryRepository.ts`. Never reach into the data layer from a tool directly.
4. Register it with one `.register(...)` line in `src/tools/index.ts`.
5. If it should need human approval in some cases, add a rule in `src/policy/defaultPolicy.ts`.
6. Add checks to `src/examples/05-tool-checks.ts` (valid input, invalid input, not-found). If it needs a demo route, add a keyword route in `src/agent/demoClient.ts`.
7. Run `npm run verify`. Everything must pass before you report done.
