import "dotenv/config";

export const config = {
  model: process.env["ANTHROPIC_MODEL"] ?? "claude-sonnet-5-5",
  maxIterations: 10,
  maxTokens: 1024,
};
