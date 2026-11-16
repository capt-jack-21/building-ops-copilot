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
import type { SseEvent } from "./sseClient.js";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
  if (!ok) failures++;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (condition()) return true;
    await sleep(20);
  }
  return condition();
}

const sessions = new SessionStore({ ttlMs: 60_000, max: 50 });
const registry = createToolRegistry();
const app = createApp({
  llm: new DemoLlmClient(),
  registry,
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

const JSON_HEADERS = { "content-type": "application/json" };
const chat = (body: unknown, signal?: AbortSignal): Promise<Response> =>
  fetch(`${base}/api/chat`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
const approve = (sessionId: string, id: string, approved: boolean): Promise<Response> =>
  fetch(`${base}/api/approvals/${id}`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ session_id: sessionId, approved }),
  });

async function drain(res: Response, onEvent?: (e: SseEvent) => Promise<void>): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  for await (const e of readSse(res)) {
    events.push(e);
    if (onEvent) await onEvent(e);
  }
  return events;
}

try {
  const t0 = performance.now();

  const health = await (await fetch(`${base}/api/health`)).json();
  check(
    "GET /api/health",
    health.status === "ok" && health.demo === true && health.tools === 7,
    JSON.stringify(health),
  );

  const tools = await (await fetch(`${base}/api/tools`)).json();
  check(
    "GET /api/tools lists 7 tools with risk levels",
    tools.length === 7 &&
      tools.some((t: { name: string; risk: string }) => t.name === "create_ticket" && t.risk === "write"),
  );

  const hdr = await fetch(`${base}/api/health`);
  check(
    "security headers set, x-powered-by hidden",
    hdr.headers.get("x-content-type-options") === "nosniff" && hdr.headers.get("x-powered-by") === null,
  );

  check("empty message -> 400", (await chat({ message: "   " })).status === 400);
  check("oversized message -> 400", (await chat({ message: "x".repeat(2001) })).status === 400);
  const bad = await fetch(`${base}/api/chat`, { method: "POST", headers: JSON_HEADERS, body: "{not json" });
  check(
    "malformed JSON -> 400 (no stack trace leaked)",
    bad.status === 400 && !(await bad.text()).includes("SyntaxError"),
  );

  let sid = "";
  {
    const res = await chat({ message: "Any active alarms?" });
    const events = await drain(res);
    const names = events.map((e) => e.event);
    sid = events[0]?.data.session_id ?? "";
    const text = events.find((e) => e.event === "text")?.data.text ?? "";
    check(
      "chat streams session, tool_start, tool_result, text, done in order",
      names[0] === "session" &&
        names.indexOf("tool_start") < names.indexOf("tool_result") &&
        names.indexOf("text") < names.indexOf("done"),
      names.join(">"),
    );
    check("the answer contains real tool data", text.includes("GEN1_FUEL_LOW"));
  }

  {
    const events = await drain(await chat({ session_id: sid, message: "List the buildings" }));
    check(
      "same session_id continues the conversation",
      events[0]?.data.session_id === sid && events.at(-1)?.event === "done",
    );
  }

  {
    let id = "";
    let status = 0;
    let sessionId = "";
    const events = await drain(await chat({ message: "Create a critical ticket for the chiller trip" }), async (e) => {
      if (e.event === "session") sessionId = e.data.session_id;
      if (e.event === "approval_required") {
        id = e.data.id;
        status = (await approve(sessionId, id, true)).status;
      }
    });
    const result = events.find((e) => e.event === "tool_result");
    const data = result ? JSON.parse(result.data.content) : {};
    check(
      "approval over HTTP: approve -> ticket created",
      status === 200 &&
        result?.data.isError === false &&
        data.ticket_id === "T-0001" &&
        events.at(-1)?.event === "done",
    );
  }

  {
    let sessionId = "";
    const events = await drain(await chat({ message: "Create a ticket for the chiller trip" }), async (e) => {
      if (e.event === "session") sessionId = e.data.session_id;
      if (e.event === "approval_required") await approve(sessionId, e.data.id, false);
    });
    const result = events.find((e) => e.event === "tool_result");
    check(
      "approval over HTTP: decline -> permission error, nothing created",
      result?.data.isError === true && /permission/.test(result.data.content),
    );
  }

  {
    const wrongSession = await approve("00000000-0000-4000-8000-000000000000", "nope", true);
    check("approval with an unknown session -> 404", wrongSession.status === 404);
    const unknownId = await approve(sid, "no-such-approval", true);
    check("approval for an id that is not pending -> 404", unknownId.status === 404);
  }

  {
    const res = await chat({ message: "Create a ticket please" });
    const it = readSse(res)[Symbol.asyncIterator]();
    let sessionId = "";
    let approvalId = "";
    for (;;) {
      const next = await it.next();
      if (next.done) break;
      if (next.value.event === "session") sessionId = next.value.data.session_id;
      if (next.value.event === "approval_required") {
        approvalId = next.value.data.id;
        break;
      }
    }
    const second = await chat({ session_id: sessionId, message: "Any alarms?" });
    const body = await second.json();
    check("second message while busy -> 409", second.status === 409 && body.error.code === "session_busy");
    await approve(sessionId, approvalId, false);
    for (;;) {
      const next = await it.next();
      if (next.done) break;
    }
  }

  {
    const controller = new AbortController();
    const res = await chat({ message: "Create a critical ticket now" }, controller.signal);
    let sessionId = "";
    for await (const e of readSse(res)) {
      if (e.event === "session") sessionId = e.data.session_id;
      if (e.event === "approval_required") break;
    }
    controller.abort(); // the browser tab closes while waiting for approval
    const session = sessions.get(sessionId);
    const freed = await waitFor(() => session?.busy === false && session.approvals.pendingCount === 0);
    check("client disconnect cancels the turn and frees the session", freed);
  }

  check("unknown API route -> 404", (await fetch(`${base}/api/nope`)).status === 404);

  console.log(`\nTotal time: ${(performance.now() - t0).toFixed(0)} ms`);
  console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
  if (failures > 0) process.exitCode = 1;
} catch (err) {
  console.error("Server checks crashed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  server.closeAllConnections();
  server.close();
}
