import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { generateSeed } from "../data/seed.js";
import { InMemoryRepository } from "../data/inMemoryRepository.js";
import { AnthropicLlmClient } from "../agent/anthropicClient.js";
import { SYSTEM_PROMPT } from "../agent/prompt.js";
import { runAgent } from "../agent/loop.js";
import type { AgentEvent } from "../agent/loop.js";
import type { Message } from "../agent/llm.js";
import { getLatestReading } from "../tools/getLatestReading.js";
import type { ToolContext } from "../tools/types.js";

const questions = process.argv.slice(2);
if (questions.length === 0) {
  questions.push(
    "Compare the latest power of meters m-01-ch1-kw and m-01-ch2-kw.",
    "Which one is higher, and by how much?",
  );
}

function show(e: AgentEvent): void {
  switch (e.type) {
    case "model_call":
      console.log(
        `  [model #${e.iteration}] stop_reason=${e.stopReason} ${e.ms.toFixed(0)} ms in/out=${e.inputTokens}/${e.outputTokens}`,
      );
      break;
    case "tool_start":
      console.log(`  [tool] ${e.name}(${JSON.stringify(e.input)})`);
      break;
    case "tool_result":
      console.log(`  [tool] ${e.isError ? "ERROR" : "ok"} ${e.ms.toFixed(1)} ms`);
      break;
    case "warning":
      console.log(`  [warning] ${e.message}`);
      break;
    default:
      break;
  }
}

try {
  const llm = new AnthropicLlmClient(config.model);
  const ctx: ToolContext = { repo: new InMemoryRepository(generateSeed()), now: () => new Date() };
  const history: Message[] = []; // shared across questions = conversation memory

  for (const q of questions) {
    console.log(`\n> ${q}`);
    const r = await runAgent(history, q, {
      llm,
      tools: [getLatestReading],
      ctx,
      system: SYSTEM_PROMPT,
      maxTokens: config.maxTokens,
      maxIterations: config.maxIterations,
      onEvent: show,
    });
    console.log(`\n${r.finalText}`);
    console.log(
      `\n  summary: ${r.iterations} model call(s), ${r.toolCalls} tool call(s), ` +
        `tokens in/out=${r.inputTokens}/${r.outputTokens}, ${r.totalMs.toFixed(0)} ms, ended: ${r.termination}`,
    );
  }
} catch (err) {
  if (err instanceof Anthropic.APIError) console.error(`API error ${err.status}: ${err.message}`);
  else console.error("Failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
