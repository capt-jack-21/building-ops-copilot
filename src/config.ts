import "dotenv/config";
import { z } from "zod";

const Env = z.object({
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_MODEL: z.string().min(1).default("claude-sonnet-5-5"),
  DEMO_MODE: z.enum(["0", "1", "true", "false"]).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  BIND_HOST: z.string().min(1).default("127.0.0.1"),
});

// Treat blank values in .env as "not set".
const present = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ""));
const parsed = Env.safeParse(present);
if (!parsed.success) {
  console.error("Invalid environment:\n" + z.prettifyError(parsed.error));
  process.exit(1);
}
const env = parsed.data;

export const config = {
  model: env.ANTHROPIC_MODEL,
  apiKey: env.ANTHROPIC_API_KEY,
  /** Demo mode: explicit DEMO_MODE=1, or no API key and no explicit setting. */
  demoMode: env.DEMO_MODE === "1" || env.DEMO_MODE === "true" || (env.DEMO_MODE === undefined && !env.ANTHROPIC_API_KEY),
  port: env.PORT,
  host: env.BIND_HOST,
  maxIterations: 10,
  maxTokens: 1024,
};
