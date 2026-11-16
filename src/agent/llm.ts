import type { JsonSchema } from "../tools/types.js";

export interface TextBlock {
  type: "text";
  text: string;
}
export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}
export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}
export type AssistantBlock = TextBlock | ToolUseBlock;

export type Message =
  | { role: "user"; content: string | ToolResultBlock[] }
  | { role: "assistant"; content: AssistantBlock[] };

export interface LlmTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export interface LlmRequest {
  system: string;
  tools: LlmTool[];
  messages: Message[];
  maxTokens: number;
  signal?: AbortSignal;
}

export interface LlmUsage {
  /** Uncached input tokens only. Total input = inputTokens + cacheReadTokens + cacheWriteTokens. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface LlmResponse {
  content: AssistantBlock[];
  stopReason: string | null;
  usage: LlmUsage;
}

/** The only thing the agent loop knows about the model. */
export interface LlmClient {
  complete(req: LlmRequest): Promise<LlmResponse>;
}
