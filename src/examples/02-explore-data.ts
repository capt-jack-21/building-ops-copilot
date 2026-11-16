import { generateSeed } from "../data/seed.js";
import { InMemoryRepository } from "../data/inMemoryRepository.js";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
  if (!ok) failures++;
}

try {
  const t0 = performance.now();
  const now = new Date();
  const seed = generateSeed(now);
  const repo = new InMemoryRepository(seed);
  const genMs = performance.now() - t0;
  console.log(`Generated seed data in ${genMs.toFixed(1)} ms\n`);

  const buildings = await repo.listBuildings();
  check("2 buildings", buildings.length === 2, `${buildings.length}`);

  const meters = await repo.listMeters();
  check("16 meters", meters.length === 16, `${meters.length}`);

  const allFull = meters.every((m) => seed.readings.get(m.id)?.length === 672);
  check("every meter has 672 readings (7 days x 96)", allFull);

  const again = generateSeed(now);
  check(
    "deterministic: same seed gives same data",
    again.readings.get("m-01-main-kw")?.[10]?.value === seed.readings.get("m-01-main-kw")?.[10]?.value,
  );

  const H = 3600 * 1000;
  const iso = (ms: number): string => new Date(ms).toISOString();
  const tripRows = await repo.queryRange("m-01-ch2-kw", iso(now.getTime() - 14 * H), iso(now.getTime() - 12 * H));
  check(
    "chiller 2 power is near zero during the trip",
    tripRows.length > 0 && tripRows.every((r) => r.value < 10),
    `${tripRows.length} rows`,
  );

  const normalRows = await repo.queryRange("m-01-ch2-kw", iso(now.getTime() - 30 * H), iso(now.getTime() - 26 * H));
  const avg = normalRows.reduce((s, r) => s + r.value, 0) / Math.max(1, normalRows.length);
  check("chiller 2 power is normal outside the trip", avg > 30, `avg ${avg.toFixed(1)} kW`);

  const active = await repo.listAlarms({ activeOnly: true });
  check("2 active alarms", active.length === 2, active.map((a) => a.code).join(", "));

  const critical = await repo.listAlarms({ severity: "critical", buildingId: "bld-01" });
  check("critical CH2_TRIP alarm exists for bld-01", critical[0]?.code === "CH2_TRIP");

  const ticket = await repo.createTicket({ title: "Test", description: "Test ticket", priority: "low" });
  check("first ticket id is T-0001", ticket.id === "T-0001", ticket.id);

  console.log("\nLatest readings, Nila Tower:");
  const rows = [];
  for (const m of await repo.listMeters({ buildingId: "bld-01" })) {
    const last = await repo.getLatest(m.id);
    rows.push({ meter: m.id, name: m.name, value: last?.value, unit: m.unit, at: last?.ts });
  }
  console.table(rows);

  console.log(`\nTotal time: ${(performance.now() - t0).toFixed(1)} ms`);
  console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
  if (failures > 0) process.exitCode = 1;
} catch (err) {
  console.error("Data layer test crashed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
