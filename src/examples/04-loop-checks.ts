import { generateSeed } from "../data/seed.js";
import { InMemoryRepository } from "../data/inMemoryRepository.js";
import { runAgent } from "../agent/loop.js";
import type { AgentEvent } from "../agent/loop.js";
import type { LlmClient, LlmResponse, Message } from "../agent/llm.js";
import { getLatestReading } from "../tools/getLatestReading.js";
import type { ToolContext } from "../tools/types.js";

class ScriptedLlm implements LlmClient {
  calls = 0;
  constructor(private readonly script: LlmResponse[]) {}
  async complete(): Promise<LlmResponse> {
    const next = this.script[this.calls++];
    if (!next) throw new Error("script exhausted");
    return next;
  }
}

const usage = { inputTokens: 10, outputTokens: 5 };
const use = (id: string, input: unknown, name = "get_latest_reading") => ({ type: "tool_use" as const, id, name, input });
const say = (text: string): LlmResponse => ({ content: [{ type: "text", text }], stopReason: "end_turn", usage });
const asks = (...blocks: ReturnType<typeof use>[]): LlmResponse => ({ content: blocks, stopReason: "tool_use", usage });

const ctx: ToolContext = { repo: new InMemoryRepository(generateSeed()), now: () => new Date() };
const base = { tools: [getLatestReading], ctx, system: "test" };

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
  if (!ok) failures++;
}
const resultIds = (m: Message | undefined): string[] =>
  m && m.role === "user" && typeof m.content !== "string" ? m.content.map((r) => r.tool_use_id) : [];

try {
  const t0 = performance.now();

  {
    const history: Message[] = [];
    const llm = new ScriptedLlm([asks(use("t1", { meter_id: "m-01-main-kw" })), say("Done.")]);
    const r = await runAgent(history, "q", { ...base, llm });
    check("one tool round trip: 2 iterations, 1 tool call", r.iterations === 2 && r.toolCalls === 1 && r.termination === "end_turn");
    check("history is user, assistant, user(tool_result), assistant", history.map((m) => m.role).join(",") === "user,assistant,user,assistant");
    check("tool_result id matches tool_use id", resultIds(history[2]).join() === "t1");
    check("final text returned", r.finalText === "Done.");
  }

  {
    const history: Message[] = [];
    const llm = new ScriptedLlm([
      asks(use("a", { meter_id: "m-01-ch1-kw" }), use("b", { meter_id: "m-01-ch2-kw" })),
      say("Both read."),
    ]);
    await runAgent(history, "q", { ...base, llm });
    check("parallel tool calls answered in ONE user message", resultIds(history[2]).join() === "a,b");
  }

  {
    const history: Message[] = [];
    const llm = new ScriptedLlm([
      asks(use("x", { meter_id: "m-99-nope" }), use("y", {}, "no_such_tool")),
      say("Could not read."),
    ]);
    const r = await runAgent(history, "q", { ...base, llm });
    const m = history[2];
    const flags = m && m.role === "user" && typeof m.content !== "string" ? m.content.map((b) => b.is_error) : [];
    check("errors become is_error results and the loop continues", flags.join() === "true,true" && r.termination === "end_turn");
  }

  {
    const history: Message[] = [];
    const llm = new ScriptedLlm(Array.from({ length: 10 }, (_, i) => asks(use(`l${i}`, { meter_id: "m-01-main-kw" }))));
    const r = await runAgent(history, "q", { ...base, llm, maxIterations: 3 });
    check("iteration cap stops a runaway loop", r.termination === "max_iterations" && llm.calls === 3, `${llm.calls} model calls`);
  }

  {
    const history: Message[] = [];
    const events: AgentEvent[] = [];
    const cut: LlmResponse = {
      content: [{ type: "text", text: "Let me" }, use("z", { meter_id: "m-01-ma" })],
      stopReason: "max_tokens",
      usage,
    };
    const r = await runAgent(history, "q", { ...base, llm: new ScriptedLlm([cut]), onEvent: (e) => events.push(e) });
    check("truncated tool_use is dropped from history", history.length === 1 && r.termination === "max_tokens");
    check("a warning event was emitted", events.some((e) => e.type === "warning"));
  }

  {
    const history: Message[] = [];
    const llm = new ScriptedLlm([say("First."), say("Second.")]);
    await runAgent(history, "q1", { ...base, llm });
    await runAgent(history, "q2", { ...base, llm });
    check("same history array continues the conversation", history.map((m) => m.role).join(",") === "user,assistant,user,assistant");
  }

  console.log(`\nTotal time: ${(performance.now() - t0).toFixed(1)} ms`);
  console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
  if (failures > 0) process.exitCode = 1;
} catch (err) {
  console.error("Loop checks crashed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
