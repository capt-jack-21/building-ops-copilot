import type { Response } from "express";

export interface SseStream {
  send(event: string, data: unknown): void;
  close(): void;
}

/** Start a Server-Sent Events response. Heartbeat comments keep proxies from closing idle streams. */
export function openSse(res: Response): SseStream {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const alive = (): boolean => !res.writableEnded && !res.destroyed;
  const heartbeat = setInterval(() => {
    if (alive()) res.write(": ping\n\n");
  }, 15_000);

  return {
    send(event, data) {
      if (alive()) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    close() {
      clearInterval(heartbeat);
      if (alive()) res.end();
    },
  };
}
