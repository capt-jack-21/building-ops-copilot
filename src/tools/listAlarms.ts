import { z } from "zod";
import { defineTool } from "./types.js";
import { HOUR_MS } from "./util.js";

const MAX_ALARMS = 50;

export const listAlarms = defineTool({
  name: "list_alarms",
  description:
    "List alarms, newest first. Filter by building, severity, whether they are still active, " +
    "or how many hours back they were raised. Use it for questions about faults, trips and what is wrong now. " +
    "Each alarm has an asset_id; use list_meters to find that equipment's meters for deeper analysis.",
  risk: "read",
  inputSchema: z.object({
    building_id: z.string().optional().describe("Limit to one building, e.g. bld-01"),
    severity: z.enum(["info", "warning", "critical"]).optional(),
    active_only: z.boolean().default(false).describe("If true, only alarms that have not cleared"),
    since_hours: z.number().min(1).max(168).optional().describe("Only alarms raised in the last N hours"),
  }),
  async handler({ building_id, severity, active_only, since_hours }, ctx) {
    const since = since_hours ? new Date(ctx.now().getTime() - since_hours * HOUR_MS).toISOString() : undefined;
    const alarms = await ctx.repo.listAlarms({ buildingId: building_id, severity, activeOnly: active_only, since });
    return {
      count: alarms.length,
      alarms: alarms.slice(0, MAX_ALARMS).map((a) => ({
        alarm_id: a.id,
        building_id: a.buildingId,
        asset_id: a.assetId,
        severity: a.severity,
        code: a.code,
        message: a.message,
        raised_at_utc: a.raisedAt,
        cleared_at_utc: a.clearedAt,
        active: a.clearedAt === null,
        acknowledged: a.acknowledged,
      })),
    };
  },
});
