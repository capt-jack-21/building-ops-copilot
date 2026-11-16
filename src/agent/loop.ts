import { executeTool } from "../tools/types.js";
import type { Gate, Tool, ToolContext, ToolOutcome } from "../tools/types.js";
import type { Policy, PolicyDecision } from "../policy/policy.js";
import type { ApprovalBroker } from "../approvals/broker.js";
import type { LlmClient, Message, ToolResultBlock, ToolUseBlock } from "./llm.js";

export type AgentEvent =
  | {
      type: "model_call"; iteration: number; stopReason: string | null; ms: number;
      inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number;
    }
  | { type: "text"; text: string }
  | { type: "tool_start"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; name: string; isError: boolean; ms: number; content: string }
  | { type: "approval_required"; id: string; name: string; input: unknown; reason: string }
  | { type: "approval_result"; id: string; name: string; approved: boolean }
  | { type: "warning"; message: string };

export type Termination = "end_turn" | "max_iterations" | "max_tokens" | "other";

export interface AgentOptions {
  llm: LlmClient;
  tools: Tool[];
  ctx: ToolContext;
  system: string;
  policy?: Policy;
  approvals?: ApprovalBroker;
  signal?: AbortSignal;
  maxTokens?: number;
  maxIterations?: number;
  onEvent?: (event: AgentEvent) => void;
}

export interface AgentResult {
  finalText: string;
  termination: Termination;
  stopReason: string | null;
  iterations: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalMs: number;
}

function unknownTool(name: string): ToolOutcome {
  return {
    isError: true,
    ms: 0,
    content: JSON.stringify({ error: { category: "not_found", retryable: false, message: `Unknown tool "${name}".` } }),
  };
}

/**
 * Run one user turn to completion. `history` is mutated: the user message, every
 * assistant turn and every tool_result turn are appended, so passing the same
 * array again continues the conversation. If `signal` aborts, this throws at the
 * next step; callers should discard the unfinished turn.
 */
export async function runAgent(history: Message[], userText: string, opts: AgentOptions): Promise<AgentResult> {
  const { llm, tools, ctx, system, policy, approvals, signal, onEvent = () => undefined, maxTokens = 1024, maxIterations = 10 } = opts;
  const started = performance.now();
  const toolDefs = tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.jsonSchema }));
  const stats = { toolCalls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let lastText = "";

  const finish = (termination: Termination, stopReason: string | null, iterations: number): AgentResult => ({
    finalText: lastText,
    termination,
    stopReason,
    iterations,
    ...stats,
    totalMs: performance.now() - started,
  });

  /** Policy decides; if approval is needed, a human decides. Runs on VALIDATED input. */
  const makeGate = (tool: Tool, use: ToolUseBlock): Gate => async (parsed) => {
    const decision: PolicyDecision = policy ? policy.evaluate(tool, parsed) : { action: "allow" };
    if (decision.action === "allow") return { allow: true };
    if (decision.action === "deny") {
      onEvent({ type: "warning", message: `Policy denied ${tool.name}: ${decision.reason}` });
      return { allow: false, message: decision.reason };
    }
    onEvent({ type: "approval_required", id: use.id, name: tool.name, input: parsed, reason: decision.reason });
    if (!approvals) {
      return { allow: false, message: "This action needs human approval, but no approver is available." };
    }
    const answer = await approvals.request({ id: use.id, toolName: tool.name, input: parsed, reason: decision.reason });
    onEvent({ type: "approval_result", id: use.id, name: tool.name, approved: answer.approved });
    return answer.approved
      ? { allow: true }
      : { allow: false, message: answer.note ?? "The user declined this action. Do not retry it." };
  };

  history.push({ role: "user", content: userText });

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    signal?.throwIfAborted();

    const t0 = performance.now();
    const res = await llm.complete({ system, tools: toolDefs, messages: history, maxTokens, signal });
    const cacheRead = res.usage.cacheReadTokens ?? 0;
    const cacheWrite = res.usage.cacheWriteTokens ?? 0;
    stats.inputTokens += res.usage.inputTokens;
    stats.outputTokens += res.usage.outputTokens;
    stats.cacheReadTokens += cacheRead;
    stats.cacheWriteTokens += cacheWrite;
    onEvent({
      type: "model_call", iteration, stopReason: res.stopReason, ms: performance.now() - t0,
      inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens,
      cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite,
    });

    const uses = res.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
    lastText = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    if (lastText) onEvent({ type: "text", text: lastText });

    // A tool_use that was cut off by max_tokens (or any non-tool_use stop) can never be answered,
    // and a dangling tool_use would break the next API call. Drop that turn.
    if (res.stopReason !== "tool_use") {
      if (uses.length > 0) onEvent({ type: "warning", message: "Dropped an incomplete tool request (response was cut off)." });
      else history.push({ role: "assistant", content: res.content });
      const termination: Termination =
        res.stopReason === "end_turn" ? "end_turn" : res.stopReason === "max_tokens" ? "max_tokens" : "other";
      return finish(termination, res.stopReason, iteration);
    }

    history.push({ role: "assistant", content: res.content });

    // Run every requested tool, then answer them all in ONE user message.
    const results: ToolResultBlock[] = await Promise.all(
      uses.map(async (use) => {
        onEvent({ type: "tool_start", id: use.id, name: use.name, input: use.input });
        const tool = tools.find((t) => t.name === use.name);
        const outcome = tool ? await executeTool(tool, use.input, ctx, makeGate(tool, use)) : unknownTool(use.name);
        stats.toolCalls++;
        onEvent({ type: "tool_result", id: use.id, name: use.name, isError: outcome.isError, ms: outcome.ms, content: outcome.content });
        return { type: "tool_result" as const, tool_use_id: use.id, content: outcome.content, is_error: outcome.isError };
      }),
    );
    history.push({ role: "user", content: results });
  }

  onEvent({ type: "warning", message: `Stopped after ${maxIterations} iterations.` });
  return finish("max_iterations", "tool_use", maxIterations);
}
