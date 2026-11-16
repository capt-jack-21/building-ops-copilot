import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { generateSeed } from "../data/seed.js";
import { InMemoryRepository } from "../data/inMemoryRepository.js";
import { DemoLlmClient } from "../agent/demoClient.js";
import { createToolRegistry } from "../tools/index.js";
import { createDefaultPolicy } from "../policy/defaultPolicy.js";
import { SessionStore } from "../server/sessions.js";
import { createApp } from "../server/app.js";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
  if (!ok) failures++;
}

const app = createApp({
  llm: new DemoLlmClient(),
  registry: createToolRegistry(),
  policy: createDefaultPolicy(),
  ctx: { repo: new InMemoryRepository(generateSeed()), now: () => new Date() },
  sessions: new SessionStore({ ttlMs: 60_000, max: 10 }),
  model: "demo",
  demo: true,
  system: "test",
  maxTokens: 512,
  maxIterations: 4,
  publicDir: fileURLToPath(new URL("../../public", import.meta.url)),
  logRequests: false,
});
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", () => resolve()));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

// Every element id the front-end JavaScript looks up. A missing id means a broken UI.
const REQUIRED_IDS = [
  "new-chat",
  "tool-count",
  "tool-list",
  "mode-badge",
  "messages",
  "welcome",
  "composer",
  "input",
  "send",
  "st-in",
  "st-out",
  "st-cr",
  "st-cw",
  "st-hit",
  "st-calls",
  "st-tools",
  "st-sid",
  "loop",
  "clock",
  "gauge",
  "toollog",
  "twin",
];

try {
  const page = await fetch(`${base}/`);
  const html = await page.text();
  check(
    "GET / serves the HTML page",
    page.status === 200 &&
      (page.headers.get("content-type") ?? "").includes("text/html") &&
      html.includes("Building Ops Copilot"),
  );
  check("page links the stylesheet", html.includes('href="/styles.css"'));

  const scriptTags = html.match(/<script\b[^>]*>/gi) ?? [];
  check(
    "no inline scripts (CSP-safe)",
    scriptTags.length > 0 && scriptTags.every((tag) => /\ssrc=/.test(tag)),
    `${scriptTags.length} script tag(s)`,
  );

  const csp = page.headers.get("content-security-policy") ?? "";
  check(
    "CSP restricts scripts to same origin",
    csp.includes("script-src 'self'") && csp.includes("script-src-attr 'none'"),
  );

  const css = await fetch(`${base}/styles.css`);
  check("GET /styles.css", css.status === 200 && (css.headers.get("content-type") ?? "").includes("text/css"));

  const missing = REQUIRED_IDS.filter((id) => !html.includes(`id="${id}"`));
  check(
    "all element ids used by the JS exist in the HTML",
    missing.length === 0,
    missing.length ? "missing: " + missing.join(", ") : `${REQUIRED_IDS.length} ids`,
  );

  const scripts = [...html.matchAll(/<script\b[^>]*\ssrc="([^"]+)"/gi)].map((m) => m[1] ?? "");
  for (const src of scripts) {
    const res = await fetch(`${base}${src}`);
    const source = await res.text();
    let syntaxOk = true;
    try {
      new Function(source); // compiles only, never runs
    } catch (err) {
      syntaxOk = false;
      console.log("  syntax error:", err instanceof Error ? err.message : err);
    }
    const safe = !/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/.test(source);
    check(
      `script ${src}: served, valid syntax, no unsafe DOM APIs`,
      res.status === 200 && (res.headers.get("content-type") ?? "").includes("javascript") && syntaxOk && safe,
    );
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  if (failures > 0) process.exitCode = 1;
} catch (err) {
  console.error("UI checks crashed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  server.closeAllConnections();
  server.close();
}
