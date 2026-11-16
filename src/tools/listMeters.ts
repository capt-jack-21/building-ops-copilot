import { z } from "zod";
import { defineTool } from "./types.js";

const MAX_METERS = 100;

export const listMeters = defineTool({
  name: "list_meters",
  description:
    "List meters (measurement points) with their IDs, names, quantity and unit. " +
    "Use it to discover the meter_id needed by get_latest_reading, query_timeseries and compare_to_baseline. " +
    "Filter by building and/or equipment type. It does not return readings.",
  risk: "read",
  inputSchema: z.object({
    building_id: z.string().optional().describe("Limit to one building, e.g. bld-01"),
    asset_type: z
      .enum(["chiller", "ahu", "generator", "energy_meter", "fuel_tank", "pump"])
      .optional()
      .describe("Limit to one kind of equipment"),
  }),
  async handler({ building_id, asset_type }, ctx) {
    const meters = await ctx.repo.listMeters({ buildingId: building_id, assetType: asset_type });
    return {
      count: meters.length,
      meters: meters.slice(0, MAX_METERS).map((m) => ({
        meter_id: m.id,
        name: m.name,
        building_id: m.buildingId,
        asset_id: m.assetId,
        quantity: m.quantity,
        unit: m.unit,
        protocol: m.protocol,
      })),
    };
  },
});
