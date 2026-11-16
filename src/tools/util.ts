import { ToolError } from "./types.js";

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

export function parseIso(label: string, value: string): number {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new ToolError(
      "validation",
      `"${label}" must be an ISO-8601 timestamp such as 2026-11-16T08:00:00Z, got "${value}".`,
      true,
    );
  }
  return ms;
}

export function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
