import { randomUUID } from "node:crypto";
import type { Message } from "../agent/llm.js";
import { WebApprovalBroker } from "./webApprovalBroker.js";

export interface Session {
  id: string;
  history: Message[];
  approvals: WebApprovalBroker;
  busy: boolean;
  lastUsed: number;
}

/** In-memory sessions. IDs are server-generated and unguessable; they act as access tokens. */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly opts: { ttlMs: number; max: number; approvalTimeoutMs?: number }) {}

  get(id: string): Session | undefined {
    this.sweep();
    const session = this.sessions.get(id);
    if (session) session.lastUsed = Date.now();
    return session;
  }

  /** Returns the existing session, or creates a new one (never trusts a client-chosen ID). */
  getOrCreate(id?: string): Session {
    const existing = id ? this.get(id) : undefined;
    if (existing) return existing;
    this.makeRoom();
    const session: Session = {
      id: randomUUID(),
      history: [],
      approvals: new WebApprovalBroker(this.opts.approvalTimeoutMs),
      busy: false,
      lastUsed: Date.now(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get size(): number {
    return this.sessions.size;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (!session.busy && now - session.lastUsed > this.opts.ttlMs) {
        session.approvals.cancelAll();
        this.sessions.delete(id);
      }
    }
  }

  private makeRoom(): void {
    while (this.sessions.size >= this.opts.max) {
      let oldest: Session | undefined;
      for (const s of this.sessions.values()) {
        if (!s.busy && (!oldest || s.lastUsed < oldest.lastUsed)) oldest = s;
      }
      if (!oldest) throw new Error("Too many active sessions");
      oldest.approvals.cancelAll();
      this.sessions.delete(oldest.id);
    }
  }
}
