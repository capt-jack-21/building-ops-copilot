import { z } from "zod";
import { defineTool } from "./types.js";

export const listBuildings = defineTool({
  name: "list_buildings",
  description:
    "List all buildings with their IDs, names, cities and floor areas. " +
    "Call this first when the user mentions a building by name or asks about all buildings.",
  risk: "read",
  inputSchema: z.object({}),
  async handler(_input, ctx) {
    const buildings = await ctx.repo.listBuildings();
    return buildings.map((b) => ({ building_id: b.id, name: b.name, city: b.city, area_sqm: b.areaSqm }));
  },
});
