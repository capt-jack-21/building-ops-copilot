import Anthropic from "@anthropic-ai/sdk";
import type { AssistantBlock, LlmClient, LlmRequest, LlmResponse } from "./llm.js";

/** Adapts the Anthropic SDK to our small LlmClient interface. */
export class AnthropicLlmClient implements LlmClient {
  private readonly client: Anthropic;

  constructor(private readonly model: string, client?: Anthropic) {
    // The SDK retries 429 / 5xx / connection errors with backoff; we raise it from 2 to 3.
    this.client = client ?? new Anthropic({ maxRetries: 3 });
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: req.maxTokens,
      system: req.system,
      tools: req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool["input_schema"],
      })),
      // Our Message type is a strict subset of the SDK's shape.
      messages: req.messages as unknown as Anthropic.MessageParam[],
    });

    const content: AssistantBlock[] = [];
    for (const b of res.content) {
      if (b.type === "text") content.push({ type: "text", text: b.text });
      else if (b.type === "tool_use") content.push({ type: "tool_use", id: b.id, name: b.name, input: b.input });
    }
    return {
      content,
      stopReason: res.stop_reason,
      usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
    };
  }
}
