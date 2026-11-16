import { generateSeed } from "../data/seed.js";
import { InMemoryRepository } from "../data/inMemoryRepository.js";
import { runAgent } from "../agent/loop.js";
import type { AgentEvent } from "../agent/loop.js";
import type { LlmClient, LlmResponse, Message, ToolResultBlock } from "../agent/llm.js";
import { createToolRegistry } from "../tools/index.js";
import type { ToolContext } from "../tools/types.js";
import { createDefaultPolicy } from "../policy/defaultPolicy.js";
import { CliApprovalBroker } from "../approvals/cliBroker.js";
import type { ApprovalAnswer, ApprovalBroker, ApprovalRequest } from "../approvals/broker.js";

class ScriptedLlm implements LlmClient {
  calls = 0;
  constructor(private readonly script: LlmResponse[]) {}
  async complete(): Promise<LlmResponse> {
    const next = this.script[this.calls++];
    if (!next) throw new Error("script exhausted");
    return next;
  }
}

class CountingBroker implements ApprovalBroker {
  requests: ApprovalRequest[] = [];
  constructor(private readonly answer: ApprovalAnswer) {}
  async request(req: ApprovalRequest): Promise<ApprovalAnswer> {
    this.requests.push(req);
    return this.answer;
  }
}

const usage = { inputTokens: 10, outputTokens: 5 };
const use = (id: string, name: string, input: unknown) => ({ type: "tool_use" as const, id, name, input });
const asks = (...blocks: ReturnType<typeof use>[]): LlmResponse => ({ content: blocks, stopReason: "tool_use", usage });
const say = (text: string): LlmResponse => ({ content: [{ type: "text", text }], stopReason: "end_turn", usage });
const ticket = (id: string, priority: string) =>
  use(id, "create_ticket", { title: "Chiller 2 trip", description: "Tripped overnight", priority });

const registry = createToolRegistry();
const policy = createDefaultPolicy();
const tool = (name: string) => {
  const t = registry.get(name);
  if (!t) throw new Error(`No such tool: ${name}`);
  return t;
};

function lastResults(history: Message[]): ToolResultBlock[] {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m && m.role === "user" && typeof m.content !== "string") return m.content;
  }
  return [];
}

async function scenario(script: LlmResponse[], broker?: ApprovalBroker) {
  const ctx: ToolContext = { repo: new InMemoryRepository(generateSeed()), now: () => new Date() };
  const history: Message[] = [];
  const events: AgentEvent[] = [];
  const opts = {
    llm: new ScriptedLlm(script),
    tools: registry.list(),
    ctx,
    system: "t",
    policy,
    onEvent: (e: AgentEvent) => events.push(e),
  };
  const result = await runAgent(history, "q", broker ? { ...opts, approvals: broker } : opts);
  return { ctx, history, events, result };
}

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
  if (!ok) failures++;
}

try {
  const t0 = performance.now();

  check("policy: reads are allowed", policy.evaluate(tool("list_alarms"), {}).action === "allow");
  const low = policy.evaluate(tool("create_ticket"), { priority: "low" });
  check("policy: every write needs approval (fail-safe default)", low.action === "require_approval");
  const crit = policy.evaluate(tool("create_ticket"), { priority: "critical" });
  check(
    "policy: critical ticket gets the stronger reason",
    crit.action === "require_approval" && /Critical/.test(crit.reason),
  );

  {
    const broker = new CountingBroker({ approved: true });
    const { history, events, result } = await scenario([asks(ticket("t1", "critical")), say("Raised.")], broker);
    const block = lastResults(history)[0];
    const data = block ? JSON.parse(block.content) : {};
    check(
      "approved: the ticket is created",
      !block?.is_error && data.ticket_id === "T-0001" && result.termination === "end_turn",
    );
    check(
      "approved: the human saw the exact input that ran",
      broker.requests[0]?.toolName === "create_ticket" &&
        (broker.requests[0]?.input as { priority?: string }).priority === "critical" &&
        data.priority === "critical",
    );
    check(
      "approval events were emitted",
      events.some((e) => e.type === "approval_required") &&
        events.some((e) => e.type === "approval_result" && e.approved),
    );
  }

  {
    const broker = new CountingBroker({ approved: false, note: "The user declined this action." });
    const { ctx, history } = await scenario([asks(ticket("t1", "high")), say("Understood.")], broker);
    const block = lastResults(history)[0];
    const data = block ? JSON.parse(block.content) : {};
    check(
      "declined: permission error returned to the model",
      block?.is_error === true && data.error?.category === "permission",
    );
    const probe = await ctx.repo.createTicket({ title: "probe", description: "p", priority: "low" });
    check("declined: nothing was created", probe.id === "T-0001", probe.id);
  }

  {
    const { history } = await scenario([asks(ticket("t1", "high")), say("Cannot.")]);
    const block = lastResults(history)[0];
    const data = block ? JSON.parse(block.content) : {};
    check(
      "no approver available: fails closed",
      block?.is_error === true && /no approver/.test(data.error?.message ?? ""),
    );
  }

  {
    const broker = new CountingBroker({ approved: true });
    const { history } = await scenario([asks(ticket("t1", "urgent")), say("Fixing.")], broker);
    const block = lastResults(history)[0];
    const data = block ? JSON.parse(block.content) : {};
    check(
      "invalid input: validation error and the human is NOT asked",
      broker.requests.length === 0 && data.error?.category === "validation",
    );
  }

  {
    const broker = new CountingBroker({ approved: true });
    await scenario([asks(use("r1", "list_alarms", { active_only: true })), say("Two active.")], broker);
    check("read tools never prompt", broker.requests.length === 0);
  }

  {
    let active = 0;
    let maxActive = 0;
    const ask = async (): Promise<string> => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active--;
      return "y";
    };
    const cli = new CliApprovalBroker(ask, () => undefined);
    const req = (id: string): ApprovalRequest => ({ id, toolName: "create_ticket", input: {}, reason: "test" });
    const [a, b] = await Promise.all([cli.request(req("a")), cli.request(req("b"))]);
    check("CLI broker asks one question at a time", maxActive === 1 && a.approved && b.approved);
  }

  console.log(`\nTotal time: ${(performance.now() - t0).toFixed(1)} ms`);
  console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
  if (failures > 0) process.exitCode = 1;
} catch (err) {
  console.error("Policy checks crashed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
