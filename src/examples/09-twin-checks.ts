import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { generateSeed } from "../data/seed.js";
import { InMemoryRepository } from "../data/inMemoryRepository.js";
import { DemoLlmClient } from "../agent/demoClient.js";
import { createToolRegistry } from "../tools/index.js";
import { createDefaultPolicy } from "../policy/defaultPolicy.js";
import { SessionStore } from "../server/sessions.js";
import { createApp } from "../server/app.js";
import { buildTwin } from "../server/twin.js";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
  if (!ok) failures++;
}

const now = new Date();
const repo = new InMemoryRepository(generateSeed(now));
const snap = await buildTwin(repo, now);
const asset = (id: string) => snap.buildings.flatMap((b) => b.assets).find((a) => a.id === id);
const building = (id: string) => snap.buildings.find((b) => b.id === id);

check("two buildings with six assets each", snap.buildings.length === 2 && snap.buildings.every((b) => b.assets.length === 6));

const ch2 = asset("a-01-chiller-2");
check("chiller 2: trip cleared within 24 h -> recovered", ch2?.status === "recovered" && ch2.alarms.some((a) => a.code === "CH2_TRIP" && !a.active), ch2?.status);

const fuel = asset("a-02-fuel-1");
check("generator fuel: active low-fuel alarm -> warning", fuel?.status === "warning" && fuel.alarms.some((a) => a.code === "GEN1_FUEL_LOW" && a.active), fuel?.status);
check("generator fuel headline is the low tank level", fuel?.headline?.quantity === "level_pct" && fuel.headline.value < 20, String(fuel?.headline?.value));
check("AHU 1: info alarm -> info", asset("a-01-ahu-1")?.status === "info");
check("an alarm cleared 72 h ago does not colour the pump", asset("a-02-pump-1")?.status === "ok");
check("building status is the worst of its assets", building("bld-01")?.status === "info" && building("bld-02")?.status === "warning", `${building("bld-01")?.status} / ${building("bld-02")?.status}`);
check("every asset has a headline reading", snap.buildings.every((b) => b.assets.every((a) => a.headline !== null)));
check("meter map covers all 16 meters", Object.keys(snap.meters).length === 16 && snap.meters["m-01-ch2-kw"] === "a-01-chiller-2", String(Object.keys(snap.meters).length));

const app = createApp({
  llm: new DemoLlmClient(),
  registry: createToolRegistry(),
  policy: createDefaultPolicy(),
  ctx: { repo, now: () => new Date() },
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

try {
  const res = await fetch(`${base}/api/twin`);
  const body = (await res.json()) as { buildings?: unknown[] };
  check("GET /api/twin returns the snapshot", res.status === 200 && body.buildings?.length === 2);
  check("GET /api/twin is not cached", (res.headers.get("cache-control") ?? "").includes("no-store"));

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  if (failures > 0) process.exitCode = 1;
} catch (err) {
  console.error("Twin checks crashed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  server.closeAllConnections();
  server.close();
}
