import { z } from "zod";
import { defineTool, ToolError } from "./types.js";
import { DAY_MS, HOUR_MS, round } from "./util.js";

const FLAG_THRESHOLD_PCT = 10;

function stats(values: number[]): { avg: number; min: number; max: number } {
  return {
    avg: values.reduce((s, v) => s + v, 0) / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

export const compareToBaseline = defineTool({
  name: "compare_to_baseline",
  description:
    "Compare a meter's recent window (ending now) with its normal behaviour: the same hours of the day " +
    "on each of the previous days. Returns averages, min/max and the percentage deviation, and flags a deviation " +
    `of ${FLAG_THRESHOLD_PCT}% or more. Use it to answer 'is this meter behaving abnormally?'. ` +
    "For the detailed shape of the window, follow up with query_timeseries.",
  risk: "read",
  inputSchema: z.object({
    meter_id: z.string().min(1).describe("Meter ID, e.g. m-01-ch2-temp"),
    hours: z.number().int().min(1).max(72).default(24).describe("Length of the recent window in hours"),
  }),
  async handler({ meter_id, hours }, ctx) {
    const meter = await ctx.repo.getMeter(meter_id);
    if (!meter) {
      throw new ToolError("not_found", `No meter with id "${meter_id}". Use list_meters to find valid IDs.`);
    }

    const to = ctx.now().getTime();
    const from = to - hours * HOUR_MS;
    const iso = (ms: number): string => new Date(ms).toISOString();

    const windowValues = (await ctx.repo.queryRange(meter.id, iso(from), iso(to))).map((r) => r.value);
    if (windowValues.length === 0) throw new ToolError("not_found", "No readings in the recent window.");

    const baselineValues: number[] = [];
    for (let day = 1; day <= 6; day++) {
      const rows = await ctx.repo.queryRange(meter.id, iso(from - day * DAY_MS), iso(to - day * DAY_MS));
      for (const r of rows) baselineValues.push(r.value);
    }
    if (baselineValues.length === 0) {
      throw new ToolError("not_found", "Not enough history to build a baseline. Try a shorter window.");
    }

    const win = stats(windowValues);
    const base = stats(baselineValues);
    const deviationPct = base.avg === 0 ? null : ((win.avg - base.avg) / Math.abs(base.avg)) * 100;

    return {
      meter_id: meter.id,
      name: meter.name,
      unit: meter.unit,
      window_hours: hours,
      window: { avg: round(win.avg), min: round(win.min), max: round(win.max), samples: windowValues.length },
      baseline: { avg: round(base.avg), min: round(base.min), max: round(base.max), samples: baselineValues.length },
      deviation_pct: deviationPct === null ? null : round(deviationPct, 1),
      flagged: deviationPct !== null && Math.abs(deviationPct) >= FLAG_THRESHOLD_PCT,
      flag_threshold_pct: FLAG_THRESHOLD_PCT,
    };
  },
});
