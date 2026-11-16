import { ToolRegistry } from "./registry.js";
import { listBuildings } from "./listBuildings.js";
import { listMeters } from "./listMeters.js";
import { getLatestReading } from "./getLatestReading.js";
import { queryTimeseries } from "./queryTimeseries.js";
import { compareToBaseline } from "./compareToBaseline.js";
import { listAlarms } from "./listAlarms.js";
import { createTicket } from "./createTicket.js";

/** To add a tool: write its file, then add one .register(...) line here. */
export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry()
    .register(listBuildings)
    .register(listMeters)
    .register(getLatestReading)
    .register(queryTimeseries)
    .register(compareToBaseline)
    .register(listAlarms)
    .register(createTicket);
}
