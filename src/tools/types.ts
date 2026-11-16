import { z } from "zod";
import type { TelemetryRepository } from "../domain/types.js";

export type Risk = "read" | "write" | "critical";
export type JsonSchema = { type: "object"; [key: string]: unknown };

export interface ToolContext {
  repo: TelemetryRepository;
  now: () => Date;
}

/** What the agent sees: a name, a description, a JSON schema, and a safe runner. */
export interface Tool {
  name: string;
  description: string;
  risk: Risk;
  jsonSchema: JsonSchema;
  run(rawInput: unknown, ctx: ToolContext): Promise<unknown>;
}

export type ErrorCategory = "validation" | "not_found" | "permission" | "internal";

/** Throw this from a tool handler for expected, explainable failures. */
export class ToolError extends Error {
  constructor(
    readonly category: ErrorCategory,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ToolError";
  }
}

function toJsonSchema(schema: z.ZodType): JsonSchema {
  const json = z.toJSONSchema(schema) as unknown as Record<string, unknown>;
  delete json["$schema"];
  if (json["type"] !== "object") {
    throw new Error("Tool input schemas must be z.object(...)");
  }
  return json as JsonSchema;
}

/** Define a tool once: the zod schema validates input AND produces the JSON schema for Claude. */
export function defineTool<S extends z.ZodType>(def: {
  name: string;
  description: string;
  risk: Risk;
  inputSchema: S;
  handler: (input: z.infer<S>, ctx: ToolContext) => Promise<unknown>;
}): Tool {
  return {
    name: def.name,
    description: def.description,
    risk: def.risk,
    jsonSchema: toJsonSchema(def.inputSchema),
    run: async (rawInput, ctx) => def.handler(def.inputSchema.parse(rawInput), ctx),
  };
}

export interface ToolOutcome {
  content: string; // JSON text that goes into the tool_result block
  isError: boolean;
  ms: number;
}

/** Run a tool and ALWAYS return an outcome. Never throws, so the agent loop can't be crashed by a tool. */
export async function executeTool(tool: Tool, rawInput: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  const t0 = performance.now();
  const done = (isError: boolean, payload: unknown): ToolOutcome => ({
    isError,
    content: JSON.stringify(payload),
    ms: performance.now() - t0,
  });
  try {
    return done(false, await tool.run(rawInput, ctx));
  } catch (err) {
    if (err instanceof z.ZodError) {
      return done(true, { error: { category: "validation", retryable: true, message: z.prettifyError(err) } });
    }
    if (err instanceof ToolError) {
      return done(true, { error: { category: err.category, retryable: err.retryable, message: err.message } });
    }
    // Unknown failure: log details server-side, give the model a safe generic message.
    console.error(`[tool:${tool.name}] unexpected error:`, err);
    return done(true, { error: { category: "internal", retryable: false, message: "Unexpected error while running the tool." } });
  }
}
