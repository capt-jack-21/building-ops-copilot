import { readSse } from "./sseClient.js";

const base = process.env["BASE_URL"] ?? "http://127.0.0.1:3000";
const args = process.argv.slice(2);
const autoApprove = args.includes("--approve");
const autoDecline = args.includes("--decline");
const message = args.filter((a) => !a.startsWith("--")).join(" ") || "Any active alarms?";

try {
  const t0 = performance.now();
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    console.error(`HTTP ${res.status}:`, await res.text());
    process.exit(1);
  }
  let sessionId = "";
  for await (const e of readSse(res)) {
    switch (e.event) {
      case "session":
        sessionId = e.data.session_id;
        console.log(`session ${sessionId}`);
        break;
      case "model_call":
        console.log(`  [model #${e.data.iteration}] ${e.data.stopReason} ${e.data.ms.toFixed(0)} ms in/out=${e.data.inputTokens}/${e.data.outputTokens} cache read/write=${e.data.cacheReadTokens}/${e.data.cacheWriteTokens}`);
        break;
      case "tool_start":
        console.log(`  [tool] ${e.data.name}(${JSON.stringify(e.data.input)})`);
        break;
      case "tool_result":
        console.log(`  [tool] ${e.data.isError ? "ERROR " : ""}${e.data.name} ${e.data.ms.toFixed(1)} ms`);
        break;
      case "approval_required": {
        console.log(`  [approval needed] ${e.data.name}: ${e.data.reason}`);
        if (autoApprove || autoDecline) {
          const r = await fetch(`${base}/api/approvals/${e.data.id}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ session_id: sessionId, approved: autoApprove }),
          });
          console.log(`  [approval] ${autoApprove ? "approved" : "declined"} -> HTTP ${r.status}`);
        } else {
          console.log("  (re-run with --approve or --decline; this request will time out and be denied)");
        }
        break;
      }
      case "text":
        console.log(`\n${e.data.text}\n`);
        break;
      case "done":
        console.log(`done: ${e.data.iterations} model call(s), ${e.data.toolCalls} tool call(s), ${e.data.totalMs.toFixed(0)} ms, ended: ${e.data.termination}`);
        break;
      case "error":
        console.error("server error:", e.data.message);
        break;
      default:
        break;
    }
  }
  console.log(`client total: ${(performance.now() - t0).toFixed(0)} ms`);
} catch (err) {
  console.error("Smoke client failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
