import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Runs each offline check script (src/examples/*-checks.ts) as its own process and
 * asserts that it exits 0 and prints no FAIL line. The scripts stay runnable by hand;
 * this makes them part of `npm test` and CI. None of them need an API key.
 */
const root = fileURLToPath(new URL("..", import.meta.url));

const CHECKS = [
  ["04 agent loop", "src/examples/04-loop-checks.ts"],
  ["05 tools", "src/examples/05-tool-checks.ts"],
  ["06 policy gate", "src/examples/06-policy-checks.ts"],
  ["07 HTTP server and SSE", "src/examples/07-server-checks.ts"],
  ["08 UI files and CSP", "src/examples/08-ui-checks.ts"],
  ["09 building twin", "src/examples/09-twin-checks.ts"],
  ["09e token streaming", "src/examples/09e-stream-checks.ts"],
] as const;

function run(script: string): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", script], {
      cwd: root,
      env: { ...process.env, ANTHROPIC_API_KEY: "", DEMO_MODE: "1" },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out }));
  });
}

describe("offline check scripts", () => {
  for (const [name, script] of CHECKS) {
    it(name, async () => {
      const { code, out } = await run(script);
      expect(out, out).not.toMatch(/^FAIL/m);
      expect(code, out).toBe(0);
    });
  }
});
