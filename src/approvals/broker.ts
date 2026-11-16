export interface ApprovalRequest {
  id: string;
  toolName: string;
  input: unknown;
  reason: string;
}

export interface ApprovalAnswer {
  approved: boolean;
  note?: string;
}

/** How a human says yes or no. Terminal today, a web button later. */
export interface ApprovalBroker {
  request(req: ApprovalRequest): Promise<ApprovalAnswer>;
}
