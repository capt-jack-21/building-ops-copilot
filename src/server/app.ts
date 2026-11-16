import express from "express";
import type { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { runAgent } from "../agent/loop.js";
import type { AgentEvent } from "../agent/loop.js";
import type { LlmClient } from "../agent/llm.js";
import type { Policy } from "../policy/policy.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolContext } from "../tools/types.js";
import type { SessionStore } from "./sessions.js";
import { openSse } from "./sse.js";

export interface AppDeps {
  llm: LlmClient;
  registry: ToolRegistry;
  policy: Policy;
  ctx: ToolContext;
  sessions: SessionStore;
  model: string;
  demo: boolean;
  system: string;
  maxTokens: number;
  maxIterations: number;
  publicDir: string;
  rateLimitPerMinute?: number;
  logRequests?: boolean;
}

const ChatBody = z.object({
  session_id: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(2000),
});

const ApprovalBody = z.object({
  session_id: z.string().uuid(),
  approved: z.boolean(),
});

const apiError = (code: string, message: string) => ({ error: { code, message } });

/** Never leak upstream error details to the browser; they are logged server-side instead. */
function publicMessage(err: unknown): string {
  if (err instanceof Anthropic.APIError) {
    if (err.status === 401 || err.status === 403) return "The server could not authenticate with the model API.";
    if (err.status === 429) return "The model API is rate limiting requests. Please retry shortly.";
    if (err.status !== undefined && err.status >= 500) return "The model API is temporarily unavailable. Please retry.";
    return `The model API rejected the request (${err.status ?? "error"}).`;
  }
  return "Unexpected server error.";
}

/** Keep SSE payloads bounded. */
function forClient(e: AgentEvent): AgentEvent {
  return e.type === "tool_result" ? { ...e, content: e.content.slice(0, 20_000) } : e;
}

export function createApp(deps: AppDeps): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: "16kb" }));

  if (deps.logRequests ?? true) {
    app.use("/api", (req, res, next) => {
      const t0 = performance.now();
      res.on("finish", () => console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${(performance.now() - t0).toFixed(0)} ms`));
      next();
    });
  }

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", model: deps.model, demo: deps.demo, tools: deps.registry.size, uptime_s: Math.round(process.uptime()) });
  });

  app.get("/api/tools", (_req, res) => {
    res.json(deps.registry.list().map((t) => ({ name: t.name, description: t.description, risk: t.risk })));
  });

  const chatLimiter = rateLimit({
    windowMs: 60_000,
    limit: deps.rateLimitPerMinute ?? 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: apiError("rate_limited", "Too many requests. Please slow down."),
  });

  app.post("/api/chat", chatLimiter, async (req: Request, res: Response) => {
    const body = ChatBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json(apiError("bad_request", z.prettifyError(body.error)));
      return;
    }

    let session;
    try {
      session = deps.sessions.getOrCreate(body.data.session_id);
    } catch {
      res.status(503).json(apiError("busy", "The server has too many active sessions. Try again later."));
      return;
    }
    if (session.busy) {
      res.status(409).json(apiError("session_busy", "This session is still answering a previous message."));
      return;
    }
    session.busy = true;

    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) {
        controller.abort(); // the browser went away: stop spending tokens
        session.approvals.cancelAll();
      }
    });

    const sse = openSse(res);
    sse.send("session", { session_id: session.id });
    const before = session.history.length;

    try {
      const result = await runAgent(session.history, body.data.message, {
        llm: deps.llm,
        tools: deps.registry.list(),
        ctx: deps.ctx,
        system: deps.system,
        policy: deps.policy,
        approvals: session.approvals,
        signal: controller.signal,
        maxTokens: deps.maxTokens,
        maxIterations: deps.maxIterations,
        onEvent: (e) => sse.send(e.type, forClient(e)),
      });
      sse.send("done", result);
    } catch (err) {
      session.history.length = before; // discard the unfinished turn so history stays valid
      if (!controller.signal.aborted) {
        console.error("[chat] turn failed:", err);
        sse.send("error", { message: publicMessage(err) });
      }
    } finally {
      session.busy = false;
      sse.close();
    }
  });

  app.post("/api/approvals/:id", (req: Request, res: Response) => {
    const body = ApprovalBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json(apiError("bad_request", z.prettifyError(body.error)));
      return;
    }
    const session = deps.sessions.get(body.data.session_id);
    const id = String(req.params["id"]);
    if (!session || !session.approvals.respond(id, body.data.approved)) {
      res.status(404).json(apiError("not_found", "No pending approval with that id."));
      return;
    }
    res.json({ ok: true });
  });

  app.use("/api", (_req, res) => {
    res.status(404).json(apiError("not_found", "Unknown API route."));
  });

  app.use(express.static(deps.publicDir));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = typeof (err as { status?: unknown }).status === "number" ? (err as { status: number }).status : 500;
    if (status >= 500) console.error("[server] unhandled error:", err);
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(status).json(
      status < 500 ? apiError("bad_request", "Invalid request.") : apiError("server_error", "Internal server error."),
    );
  });

  return app;
}
