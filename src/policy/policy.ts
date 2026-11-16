import type { Tool } from "../tools/types.js";

export type PolicyDecision =
  | { action: "allow" }
  | { action: "require_approval"; reason: string }
  | { action: "deny"; reason: string };

export interface Policy {
  evaluate(tool: Tool, input: unknown): PolicyDecision;
}

/** A rule returns a decision, or undefined to defer to the next rule. */
export type Rule = (tool: Tool, input: unknown) => PolicyDecision | undefined;

/** First matching rule wins. Anything unmatched is decided by the tool's declared risk. */
export class RulePolicy implements Policy {
  constructor(private readonly rules: Rule[]) {}

  evaluate(tool: Tool, input: unknown): PolicyDecision {
    for (const rule of this.rules) {
      const decision = rule(tool, input);
      if (decision) return decision;
    }
    return tool.risk === "read"
      ? { action: "allow" }
      : { action: "require_approval", reason: "This action changes state. A person must confirm it." };
  }
}
