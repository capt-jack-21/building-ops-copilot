import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { generateSeed } from "../data/seed.js";
import { InMemoryRepository } from "../data/inMemoryRepository.js";
import { DemoLlmClient } from "../agent/demoClient.js";
import { createToolRegistry } from "../tools/index.js";
import { createDefaultPolicy } from "../policy/defaultPolicy.js";
import { SessionStore } from "../server/sessions.js";
import { createApp } from "../server/app.js";
import { readSse } from "./sseClient.js";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
  if (!ok) failures++;
}
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const sessions = new SessionStore({ ttlMs: 60_000, max: 10 });
const app = createApp({
  llm: new DemoLlmClient(),
  registry: createToolRegistry(),
  policy: createDefaultPolicy(),
  ctx: { repo: new InMemoryRepository(generateSeed()), now: () => new Date() },
  sessions,
  model: "demo",
  demo: true,
  system: "test",
  maxTokens: 512,
  maxIterations: 6,
  publicDir: fileURLToPath(new URL("../../public", import.meta.url)),
  rateLimitPerMinute: 1000,
  logRequests: false,
});
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", () => resolve()));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const chat = (message: string, signal?: AbortSignal): Promise<Response> =>
  fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message }), ...(signal ? { signal } : {}) });

try {
  const events: Array<{ event: string; data: any }> = [];
  for await (const e of readSse(await chat("Any active alarms?"))) events.push(e);

  const deltas = events.filter((e) => e.event === "text_delta");
  const finalText: string = events.find((e) => e.event === "text")?.data.text ?? "";
  const firstDelta = events.findIndex((e) => e.event === "text_delta");
  const finalIndex = events.findIndex((e) => e.event === "text");

  check("text arrives as several deltas before the final text event", deltas.length >= 3 && firstDelta >= 0 && firstDelta < finalIndex, `${deltas.length} deltas`);
  check("the deltas add up to the final text", finalText.length > 0 && deltas.map((e) => e.data.text).join("") === finalText);
  check("every delta names its model call", deltas.every((e) => typeof e.data.iteration === "number"));
  check("the turn still ends with done", events.at(-1)?.event === "done");

  const controller = new AbortController();
  const res = await chat("Any active alarms?", controller.signal);
  let sessionId = "";
  for await (const e of readSse(res)) {
    if (e.event === "session") sessionId = e.data.session_id;
    if (e.event === "text_delta") break;
  }
  controller.abort();
  let freed = false;
  for (let i = 0; i < 100 && !freed; i++) {
    freed = sessions.get(sessionId)?.busy === false;
    if (!freed) await sleep(20);
  }
  check("disconnecting mid-stream cancels the turn and frees the session", freed);

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  if (failures > 0) process.exitCode = 1;
} catch (err) {
  console.error("Stream checks crashed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  server.closeAllConnections();
  server.close();
}
