import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const response = await client.messages.create({
  model: "claude-sonnet-5-5",
  max_tokens: 300,
  system: "You are a concise assistant for building operations engineers.",
  messages: [{ role: "user", content: "In two sentences, what is BACnet?" }],
});

console.log("stop_reason:", response.stop_reason);
console.log("usage:", response.usage);

for (const block of response.content) {
  if (block.type === "text") console.log(block.text);
}
