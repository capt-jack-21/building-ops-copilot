import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { generateSeed } from "./data/seed.js";
import { InMemoryRepository } from "./data/inMemoryRepository.js";
import { AnthropicLlmClient } from "./agent/anthropicClient.js";
import { DemoLlmClient } from "./agent/demoClient.js";
import type { LlmClient } from "./agent/llm.js";
import { SYSTEM_PROMPT } from "./agent/prompt.js";
import { createToolRegistry } from "./tools/index.js";
import { createDefaultPolicy } from "./policy/defaultPolicy.js";
import { SessionStore } from "./server/sessions.js";
import { createApp } from "./server/app.js";

if (!config.demoMode && !config.apiKey) {
  console.error("ANTHROPIC_API_KEY is not set. Add it to .env, or set DEMO_MODE=1 to use the scripted demo model.");
  process.exit(1);
}

const llm: LlmClient = config.demoMode ? new DemoLlmClient() : new AnthropicLlmClient(config.model);
const registry = createToolRegistry();

const app = createApp({
  llm,
  registry,
  policy: createDefaultPolicy(),
  ctx: { repo: new InMemoryRepository(generateSeed()), now: () => new Date() },
  sessions: new SessionStore({ ttlMs: 30 * 60_000, max: 200 }),
  model: config.demoMode ? "demo" : config.model,
  demo: config.demoMode,
  system: SYSTEM_PROMPT,
  maxTokens: config.maxTokens,
  maxIterations: config.maxIterations,
  publicDir: fileURLToPath(new URL("../public", import.meta.url)),
});

const server = app.listen(config.port, config.host, () => {
  const mode = config.demoMode ? "DEMO mode (scripted model, no API calls)" : `model ${config.model}`;
  console.log(`Building Ops Copilot listening on http://${config.host}:${config.port}  [${mode}]`);
});

function shutdown(signal: string): void {
  console.log(`${signal} received, shutting down...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
