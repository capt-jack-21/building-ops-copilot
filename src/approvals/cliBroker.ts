import type { ApprovalAnswer, ApprovalBroker, ApprovalRequest } from "./broker.js";

/** Asks in the terminal. Prompts are queued so parallel requests never interleave. */
export class CliApprovalBroker implements ApprovalBroker {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly ask: (prompt: string) => Promise<string>,
    private readonly print: (line: string) => void = console.log,
  ) {}

  request(req: ApprovalRequest): Promise<ApprovalAnswer> {
    const run = async (): Promise<ApprovalAnswer> => {
      this.print("");
      this.print(`  APPROVAL NEEDED: ${req.toolName}`);
      this.print(`  Why: ${req.reason}`);
      this.print(`  Input: ${JSON.stringify(req.input, null, 2).replace(/\n/g, "\n  ")}`);
      const answer = (await this.ask("  Approve? [y/N] ")).trim().toLowerCase();
      return answer === "y" || answer === "yes"
        ? { approved: true }
        : { approved: false, note: "The user declined this action." };
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }
}
