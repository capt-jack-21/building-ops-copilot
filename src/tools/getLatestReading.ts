import { z } from "zod";
import { defineTool, ToolError } from "./types.js";

export const getLatestReading = defineTool({
  name: "get_latest_reading",
  description:
    "Get the most recent reading of one meter, including its value, unit and timestamp (UTC). " +
    "Use it when the user asks for the current value of a specific meter. " +
    "Meter IDs look like m-01-main-kw. It returns only the latest sample, not history.",
  risk: "read",
  inputSchema: z.object({
    meter_id: z.string().min(1).describe("Meter ID, for example m-01-main-kw"),
  }),
  async handler({ meter_id }, ctx) {
    const meter = await ctx.repo.getMeter(meter_id);
    if (!meter) {
      throw new ToolError("not_found", `No meter with id "${meter_id}".`);
    }
    const reading = await ctx.repo.getLatest(meter_id);
    if (!reading) {
      throw new ToolError("not_found", `Meter "${meter_id}" has no readings yet.`, true);
    }
    return {
      meter_id: meter.id,
      name: meter.name,
      quantity: meter.quantity,
      value: reading.value,
      unit: meter.unit,
      timestamp_utc: reading.ts,
    };
  },
});
