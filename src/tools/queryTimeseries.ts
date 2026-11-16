import { z } from "zod";
import { defineTool, ToolError } from "./types.js";
import { parseIso, round } from "./util.js";

const BUCKET_MS = { "15m": 900_000, "1h": 3_600_000, "1d": 86_400_000 } as const;
const MAX_BUCKETS = 200;

function reduceValues(values: number[], how: "avg" | "min" | "max"): number {
  if (how === "min") return Math.min(...values);
  if (how === "max") return Math.max(...values);
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export const queryTimeseries = defineTool({
  name: "query_timeseries",
  description:
    "Get the history of one meter over a time range, aggregated into buckets (15m, 1h or 1d) " +
    "with avg, min or max. Use it to see trends, find when something changed, or inspect an event window. " +
    "Timestamps are ISO-8601 UTC. Returns at most 200 buckets: pick a larger bucket for longer ranges. " +
    "Data covers roughly the last 7 days. For just the current value use get_latest_reading.",
  risk: "read",
  inputSchema: z.object({
    meter_id: z.string().min(1).describe("Meter ID, e.g. m-01-ch2-kw"),
    from: z.string().describe("Start of the range, ISO-8601 UTC, e.g. 2026-11-16T00:00:00Z"),
    to: z.string().describe("End of the range, ISO-8601 UTC"),
    bucket: z.enum(["15m", "1h", "1d"]).default("1h").describe("Bucket size"),
    aggregate: z.enum(["avg", "min", "max"]).default("avg").describe("How to combine samples in a bucket"),
  }),
  async handler(input, ctx) {
    const from = parseIso("from", input.from);
    const to = parseIso("to", input.to);
    if (to <= from) throw new ToolError("validation", '"to" must be later than "from".', true);

    const meter = await ctx.repo.getMeter(input.meter_id);
    if (!meter) {
      throw new ToolError("not_found", `No meter with id "${input.meter_id}". Use list_meters to find valid IDs.`);
    }

    const bucketMs = BUCKET_MS[input.bucket];
    const buckets = Math.ceil((to - from) / bucketMs);
    if (buckets > MAX_BUCKETS) {
      throw new ToolError(
        "validation",
        `That range would produce ${buckets} buckets (max ${MAX_BUCKETS}). Use a larger bucket or a shorter range.`,
        true,
      );
    }

    const rows = await ctx.repo.queryRange(meter.id, new Date(from).toISOString(), new Date(to).toISOString());
    const groups = new Map<number, number[]>();
    for (const r of rows) {
      const key = Math.floor(Date.parse(r.ts) / bucketMs) * bucketMs;
      const group = groups.get(key);
      if (group) group.push(r.value);
      else groups.set(key, [r.value]);
    }

    const points = [...groups.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([key, values]) => ({
        bucket_start_utc: new Date(key).toISOString(),
        value: round(reduceValues(values, input.aggregate)),
        samples: values.length,
      }));

    return {
      meter_id: meter.id,
      name: meter.name,
      unit: meter.unit,
      bucket: input.bucket,
      aggregate: input.aggregate,
      points,
      ...(points.length === 0 ? { note: "No readings in this range. Data covers roughly the last 7 days." } : {}),
    };
  },
});
