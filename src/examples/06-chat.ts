import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { generateSeed } from "../data/seed.js";
import { InMemoryRepository } from "../data/inMemoryRepository.js";
import { AnthropicLlmClient } from "../agent/anthropicClient.js";
import { SYSTEM_PROMPT } from "../agent/prompt.js";
import { runAgent } from "../agent/loop.js";
import type { AgentEvent } from "../agent/loop.js";
import type { Message } from "../agent/llm.js";
import { createToolRegistry } from "../tools/index.js";
import type { ToolContext } from "../tools/types.js";
import { createDefaultPolicy } from "../policy/defaultPolicy.js";
import { CliApprovalBroker } from "../approvals/cliBroker.js";

function show(e: AgentEvent): void {
  switch (e.type) {
    case "model_call":
      console.log(`  [model #${e.iteration}] ${e.stopReason} ${e.ms.toFixed(0)} ms in/out=${e.inputTokens}/${e.outputTokens}`);
      break;
    case "tool_start":
      console.log(`  [tool] ${e.name}(${JSON.stringify(e.input)})`);
      break;
    case "tool_result":
      console.log(`  [tool] ${e.isError ? "ERROR " : ""}${e.name} ${e.ms.toFixed(1)} ms`);
      break;
    case "approval_result":
      console.log(`  [approval] ${e.approved ? "APPROVED" : "DECLINED"}: ${e.name}`);
      break;
    case "warning":
      console.log(`  [warning] ${e.message}`);
      break;
    default:
      break;
  }
}

const registry = createToolRegistry();
const llm = new AnthropicLlmClient(config.model);
const policy = createDefaultPolicy();
const ctx: ToolContext = { repo: new InMemoryRepository(generateSeed()), now: () => new Date() };
let history: Message[] = [];

console.log("Building Ops Copilot (with approvals). Commands: /tools  /reset  /exit");
console.log("Try: Raise a critical ticket for the Chiller 2 trip.\n");

const rl = readline.createInterface({ input: stdin, output: stdout });
const approvals = new CliApprovalBroker((prompt) => rl.question(prompt));

try {
  while (true) {
    const line = (await rl.question("you> ")).trim();
    if (!line) continue;
    if (line === "/exit" || line === "exit") break;
    if (line === "/reset") {
      history = [];
      console.log("History cleared.\n");
      continue;
    }
    if (line === "/tools") {
      for (const t of registry.list()) console.log(`- ${t.name} [${t.risk}]`);
      console.log("");
      continue;
    }

    const before = history.length;
    try {
      const r = await runAgent(history, line, {
        llm, tools: registry.list(), ctx, system: SYSTEM_PROMPT, policy, approvals,
        maxTokens: config.maxTokens, maxIterations: config.maxIterations, onEvent: show,
      });
      console.log(`\n${r.finalText}\n`);
      console.log(
        `  (${r.iterations} model call(s), ${r.toolCalls} tool call(s), tokens in/out=${r.inputTokens}/${r.outputTokens}, ${r.totalMs.toFixed(0)} ms)\n`,
      );
    } catch (err) {
      history.length = before; // discard the failed turn so the history stays valid
      if (err instanceof Anthropic.APIError) console.error(`API error ${err.status}: ${err.message}\n`);
      else console.error("Failed:", err instanceof Error ? err.message : err, "\n");
    }
  }
} finally {
  rl.close();
}
