import { RulePolicy } from "./policy.js";
import type { Rule } from "./policy.js";

/** Rules see the VALIDATED input, so they can trust its shape. */
const criticalTicket: Rule = (tool, input) => {
  if (tool.name !== "create_ticket") return undefined;
  const priority = (input as { priority?: string }).priority;
  return priority === "critical"
    ? { action: "require_approval", reason: "Critical-priority ticket: a person must confirm before it is raised." }
    : undefined;
};

export function createDefaultPolicy(): RulePolicy {
  return new RulePolicy([criticalTicket]);
}
