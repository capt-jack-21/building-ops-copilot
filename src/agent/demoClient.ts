import { randomUUID } from "node:crypto";
import type { AssistantBlock, LlmClient, LlmRequest, LlmResponse, ToolResultBlock } from "./llm.js";

const tokens = (value: unknown): number => Math.ceil(JSON.stringify(value).length / 4);
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const use = (name: string, input: unknown): AssistantBlock => ({
  type: "tool_use",
  id: `demo_${randomUUID().slice(0, 8)}`,
  name,
  input,
});

const HELP =
  "I am running in demo mode (no model is connected). Try: 'Any active alarms?', 'Why did chiller 2 trip?', " +
  "'Is the generator fuel low?', 'List the buildings', or 'Create a critical ticket for the chiller trip'.";

/** Keyword routing: a stand-in for the model deciding which tools to call. */
function plan(text: string): AssistantBlock[] | undefined {
  const t = text.toLowerCase();
  if (t.includes("ticket")) {
    const priority = t.includes("critical") ? "critical" : t.includes("low") ? "low" : "high";
    return [
      use("create_ticket", {
        title: "Chiller 2 compressor trip",
        description: "Raised from demo mode: Chiller 2 tripped overnight; see alarm CH2_TRIP.",
        priority,
        asset_id: "a-01-chiller-2",
      }),
    ];
  }
  if (/trend|chart|plot|power|24 h/.test(t)) return [use("query_timeseries", { meter_id: "m-01-ch2-kw", from: new Date(Date.now() - 24 * 3600_000).toISOString(), to: new Date().toISOString(), bucket: "1h" })];
  if (t.includes("alarm")) return [use("list_alarms", { active_only: true })];
  if (t.includes("chiller") || t.includes("trip")) {
    return [use("list_alarms", { building_id: "bld-01", severity: "critical" }), use("get_latest_reading", { meter_id: "m-01-ch2-kw" })];
  }
  if (t.includes("fuel") || t.includes("generator")) {
    return [use("get_latest_reading", { meter_id: "m-02-fuel-pct" }), use("list_alarms", { building_id: "bld-02", active_only: true })];
  }
  if (t.includes("building")) return [use("list_buildings", {})];
  return undefined;
}

function describe(block: ToolResultBlock): string[] {
  let data: unknown;
  try {
    data = JSON.parse(block.content);
  } catch {
    return [block.content];
  }
  if (block.is_error) {
    const e = (data as { error?: { category?: string; message?: string } }).error;
    return [`Tool error (${e?.category ?? "unknown"}): ${e?.message ?? "no message"}`];
  }
  if (Array.isArray(data)) {
    return data.map((b: { building_id?: string; name?: string; city?: string }) => `Building ${b.building_id}: ${b.name} (${b.city})`);
  }
  const d = data as Record<string, unknown>;
  if (Array.isArray(d["alarms"])) {
    const alarms = d["alarms"] as Array<{ code: string; severity: string; message: string; active: boolean }>;
    if (alarms.length === 0) return ["No alarms match."];
    return alarms.map((a) => `- ${a.code} (${a.severity}, ${a.active ? "active" : "cleared"}): ${a.message}`);
  }
  if (typeof d["ticket_id"] === "string") return [`Ticket ${d["ticket_id"]} created with ${d["priority"]} priority.`];
  if (typeof d["value"] === "number") return [`${d["name"]}: ${d["value"]} ${d["unit"]} at ${d["timestamp_utc"]}`];
  return [JSON.stringify(d).slice(0, 200)];
}

/** Emit text in small chunks with short pauses, like a model streaming tokens. */
async function streamText(text: string, onDelta: (piece: string) => void, signal?: AbortSignal): Promise<void> {
  for (let i = 0; i < text.length; i += 6) {
    signal?.throwIfAborted();
    onDelta(text.slice(i, i + 6));
    await pause(12);
  }
}

/** A scripted stand-in for the model, so the app runs with no API key. */
export class DemoLlmClient implements LlmClient {
  async complete(req: LlmRequest): Promise<LlmResponse> {
    req.signal?.throwIfAborted();
    await pause(120);

    const last = req.messages[req.messages.length - 1];
    const inputTokens = tokens(req.messages);
    const streamed = async (r: LlmResponse): Promise<LlmResponse> => {
      const text = r.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      if (text && req.onTextDelta) await streamText(text, req.onTextDelta, req.signal);
      return r;
    };
    const say = (text: string): LlmResponse => ({
      content: [{ type: "text", text }],
      stopReason: "end_turn",
      usage: { inputTokens, outputTokens: tokens(text) },
    });

    if (last?.role === "user" && typeof last.content === "string") {
      const blocks = plan(last.content);
      if (!blocks) return streamed(say(HELP));
      return { content: blocks, stopReason: "tool_use", usage: { inputTokens, outputTokens: tokens(blocks) } };
    }
    if (last?.role === "user" && Array.isArray(last.content)) {
      const lines = last.content.flatMap(describe);
      return streamed(say(["Demo mode (scripted, no model): here is what the tools returned.", ...lines].join("\n")));
    }
    throw new Error("The demo client cannot continue from this conversation state.");
  }
}

