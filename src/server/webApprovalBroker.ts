import type { ApprovalAnswer, ApprovalBroker, ApprovalRequest } from "../approvals/broker.js";

interface Pending {
  resolve: (answer: ApprovalAnswer) => void;
  timer: NodeJS.Timeout;
}

/** Approvals answered over HTTP. Unanswered requests are denied after a timeout. */
export class WebApprovalBroker implements ApprovalBroker {
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly timeoutMs = 120_000) {}

  request(req: ApprovalRequest): Promise<ApprovalAnswer> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(req.id);
        resolve({ approved: false, note: "Approval timed out. Nothing was done." });
      }, this.timeoutMs);
      this.pending.set(req.id, { resolve, timer });
    });
  }

  /** Returns false if there is no such pending request. */
  respond(id: string, approved: boolean): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(id);
    entry.resolve(approved ? { approved: true } : { approved: false, note: "The user declined this action." });
    return true;
  }

  /** Deny everything that is waiting (client disconnected, session expired). */
  cancelAll(note = "The request was cancelled. Nothing was done."): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve({ approved: false, note });
      this.pending.delete(id);
    }
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}
