import Anthropic from "@anthropic-ai/sdk";
import type { AssistantBlock, LlmClient, LlmRequest, LlmResponse, Message } from "./llm.js";

const EPHEMERAL = { type: "ephemeral" } as const;

/** Copy our messages into SDK shape, with a cache breakpoint on the last block. */
function toSdkMessages(messages: Message[]): Anthropic.MessageParam[] {
  const out = messages.map((m) => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content : m.content.map((b) => ({ ...b })),
  })) as unknown as Anthropic.MessageParam[];

  const last = out[out.length - 1];
  if (last) {
    if (typeof last.content === "string") {
      last.content = [{ type: "text", text: last.content, cache_control: EPHEMERAL }];
    } else {
      const block = last.content[last.content.length - 1] as unknown as { cache_control?: unknown } | undefined;
      if (block) block.cache_control = EPHEMERAL;
    }
  }
  return out;
}

/**
 * Adapts the Anthropic SDK to our small LlmClient interface.
 * Prompt caching: breakpoints on the last tool, the system prompt and the last message.
 * Streaming: when the request has onTextDelta, text is forwarded as it is generated;
 * the complete message (with usage) is still returned at the end.
 */
export class AnthropicLlmClient implements LlmClient {
  private readonly client: Anthropic;

  constructor(
    private readonly model: string,
    client?: Anthropic,
  ) {
    // The SDK retries 429 / 5xx / connection errors with backoff; we raise it from 2 to 3.
    this.client = client ?? new Anthropic({ maxRetries: 3 });
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: req.maxTokens,
      system: [{ type: "text", text: req.system, cache_control: EPHEMERAL }],
      tools: req.tools.map((t, i) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool["input_schema"],
        ...(i === req.tools.length - 1 ? { cache_control: EPHEMERAL } : {}),
      })),
      messages: toSdkMessages(req.messages),
    };
    const options = req.signal ? { signal: req.signal } : undefined;

    let res: Anthropic.Message;
    if (req.onTextDelta) {
      const onDelta = req.onTextDelta;
      const stream = this.client.messages.stream(params, options);
      stream.on("text", (delta) => onDelta(delta));
      res = await stream.finalMessage();
    } else {
      res = await this.client.messages.create(params, options);
    }

    const content: AssistantBlock[] = [];
    for (const b of res.content) {
      if (b.type === "text") content.push({ type: "text", text: b.text });
      else if (b.type === "tool_use") content.push({ type: "tool_use", id: b.id, name: b.name, input: b.input });
    }
    return {
      content,
      stopReason: res.stop_reason,
      usage: {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }
}
