import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { generateSeed } from "../data/seed.js";
import { InMemoryRepository } from "../data/inMemoryRepository.js";
import { executeTool } from "../tools/types.js";
import type { ToolContext } from "../tools/types.js";
import { getLatestReading } from "../tools/getLatestReading.js";

const MODEL = "claude-sonnet-5-5";
const SYSTEM =
  "You are the Building Ops Copilot, an assistant for building operations engineers. " +
  "Use the provided tools to get data. Never guess a measurement. Timestamps are UTC.";

const question = process.argv[2] ?? "What is the latest reading of meter m-01-main-kw?";
const tools = [getLatestReading];

try {
  const client = new Anthropic();
  const ctx: ToolContext = { repo: new InMemoryRepository(generateSeed()), now: () => new Date() };

  const toolDefs = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.jsonSchema as Anthropic.Tool["input_schema"],
  }));

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: question }];
  console.log(`Question: ${question}\n`);

  // Call 1: Claude decides whether it needs a tool.
  let t0 = performance.now();
  const first = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM,
    tools: toolDefs,
    messages,
  });
  console.log(
    `Call 1: stop_reason=${first.stop_reason}, ${(performance.now() - t0).toFixed(0)} ms, ` +
      `tokens in/out=${first.usage.input_tokens}/${first.usage.output_tokens}`,
  );

  if (first.stop_reason !== "tool_use") {
    for (const b of first.content) if (b.type === "text") console.log(b.text);
    process.exit(0);
  }

  // Run every tool Claude asked for and build the matching tool_result blocks.
  const results: Anthropic.ToolResultBlockParam[] = [];
  for (const block of first.content) {
    if (block.type !== "tool_use") continue;
    console.log(`Claude requested: ${block.name}(${JSON.stringify(block.input)})`);
    const tool = tools.find((t) => t.name === block.name);
    const outcome = tool
      ? await executeTool(tool, block.input, ctx)
      : {
          isError: true,
          ms: 0,
          content: JSON.stringify({
            error: { category: "not_found", retryable: false, message: `Unknown tool ${block.name}` },
          }),
        };
    console.log(`  -> ${outcome.isError ? "ERROR" : "ok"} in ${outcome.ms.toFixed(1)} ms: ${outcome.content}`);
    results.push({ type: "tool_result", tool_use_id: block.id, content: outcome.content, is_error: outcome.isError });
  }

  // Call 2: send Claude's own turn back, then our results as a user message.
  messages.push({ role: "assistant", content: first.content });
  messages.push({ role: "user", content: results });

  t0 = performance.now();
  const second = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM,
    tools: toolDefs,
    messages,
  });
  console.log(
    `\nCall 2: stop_reason=${second.stop_reason}, ${(performance.now() - t0).toFixed(0)} ms, ` +
      `tokens in/out=${second.usage.input_tokens}/${second.usage.output_tokens}\n`,
  );
  for (const b of second.content) if (b.type === "text") console.log(b.text);
} catch (err) {
  if (err instanceof Anthropic.APIError) {
    console.error(`API error ${err.status}: ${err.message}`);
  } else {
    console.error("Failed:", err instanceof Error ? err.message : err);
  }
  process.exitCode = 1;
}
