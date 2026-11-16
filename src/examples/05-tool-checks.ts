import { generateSeed } from "../data/seed.js";
import { InMemoryRepository } from "../data/inMemoryRepository.js";
import { createToolRegistry } from "../tools/index.js";
import { listBuildings } from "../tools/listBuildings.js";
import { executeTool } from "../tools/types.js";
import type { ToolContext } from "../tools/types.js";

const registry = createToolRegistry();
const ctx: ToolContext = { repo: new InMemoryRepository(generateSeed()), now: () => new Date() };

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
  if (!ok) failures++;
}

async function call(name: string, input: unknown) {
  const tool = registry.get(name);
  if (!tool) throw new Error(`No such tool: ${name}`);
  const out = await executeTool(tool, input, ctx);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { isError: out.isError, ms: out.ms, data: JSON.parse(out.content) as any };
}

try {
  const t0 = performance.now();
  const H = 3_600_000;
  const now = Date.now();
  const iso = (ms: number): string => new Date(ms).toISOString();

  check("7 tools registered", registry.size === 7, registry.list().map((t) => t.name).join(", "));
  check(
    "every tool has an object schema and a real description",
    registry.list().every((t) => t.jsonSchema.type === "object" && t.description.length >= 60),
  );
  let duplicateRejected = false;
  try {
    registry.register(listBuildings);
  } catch {
    duplicateRejected = true;
  }
  check("duplicate tool names are rejected", duplicateRejected);

  const b = await call("list_buildings", {});
  check("list_buildings returns 2", !b.isError && b.data.length === 2);

  const m = await call("list_meters", { building_id: "bld-01", asset_type: "chiller" });
  check("list_meters filters: 4 chiller meters in bld-01", m.data.count === 4, `${m.data.count}`);

  const ts = await call("query_timeseries", { meter_id: "m-01-ch2-kw", from: iso(now - 24 * H), to: iso(now) });
  const values: number[] = ts.data.points.map((p: { value: number }) => p.value);
  check("query_timeseries: hourly buckets for 24h", values.length >= 24 && values.length <= 26, `${values.length} points`);
  check("query_timeseries: the chiller 2 trip is visible", Math.min(...values) < 10, `min ${Math.min(...values)} kW`);

  const bad = await call("query_timeseries", { meter_id: "m-01-ch2-kw", from: "yesterday", to: iso(now) });
  check("bad timestamp -> validation error", bad.isError && bad.data.error.category === "validation");

  const big = await call("query_timeseries", { meter_id: "m-01-ch2-kw", from: iso(now - 168 * H), to: iso(now), bucket: "15m" });
  check("too many buckets -> validation error that suggests a fix", big.isError && /larger bucket/.test(big.data.error.message));

  const nf = await call("query_timeseries", { meter_id: "m-99-nope", from: iso(now - H), to: iso(now) });
  check("unknown meter -> not_found", nf.isError && nf.data.error.category === "not_found");

  const c2 = await call("compare_to_baseline", { meter_id: "m-01-ch2-temp", hours: 24 });
  check("compare_to_baseline flags chiller 2 temperature", c2.data.flagged === true, `${c2.data.deviation_pct}%`);

  const c1 = await call("compare_to_baseline", { meter_id: "m-01-ch1-temp", hours: 24 });
  check("compare_to_baseline does not flag chiller 1 temperature", c1.data.flagged === false, `${c1.data.deviation_pct}%`);

  const active = await call("list_alarms", { active_only: true });
  check("list_alarms active_only -> 2", active.data.count === 2, `${active.data.count}`);

  const crit = await call("list_alarms", { severity: "critical" });
  check("list_alarms critical -> 1", crit.data.count === 1 && crit.data.alarms[0].code === "CH2_TRIP");

  const t = await call("create_ticket", { title: "Chiller 2 trip", description: "Tripped overnight", priority: "high", asset_id: "a-01-chiller-2" });
  check("create_ticket returns T-0001", !t.isError && t.data.ticket_id === "T-0001");

  const tBad = await call("create_ticket", { title: "x", description: "d", priority: "urgent" });
  check("create_ticket rejects a bad priority and short title", tBad.isError && tBad.data.error.category === "validation");

  console.log(`\nTotal time: ${(performance.now() - t0).toFixed(1)} ms`);
  console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
  if (failures > 0) process.exitCode = 1;
} catch (err) {
  console.error("Tool checks crashed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
