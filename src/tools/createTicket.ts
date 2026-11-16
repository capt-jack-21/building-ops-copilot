import { z } from "zod";
import { defineTool } from "./types.js";

export const createTicket = defineTool({
  name: "create_ticket",
  description:
    "Create a maintenance ticket. This CHANGES STATE: only call it when the user has explicitly asked " +
    "to raise a ticket, and include what you found (alarm codes, meter values) in the description. " +
    "Priority 'critical' may require human approval before the ticket is created.",
  risk: "write",
  inputSchema: z.object({
    title: z.string().min(3).max(120).describe("Short summary, e.g. 'Chiller 2 compressor trip'"),
    description: z.string().min(1).max(2000).describe("Details and evidence"),
    priority: z.enum(["low", "medium", "high", "critical"]),
    asset_id: z.string().optional().describe("Related equipment ID, e.g. a-01-chiller-2"),
  }),
  async handler({ title, description, priority, asset_id }, ctx) {
    const ticket = await ctx.repo.createTicket({ title, description, priority, assetId: asset_id });
    return {
      ticket_id: ticket.id,
      status: "open",
      title: ticket.title,
      priority: ticket.priority,
      asset_id: ticket.assetId ?? null,
      created_at_utc: ticket.createdAt,
    };
  },
});
