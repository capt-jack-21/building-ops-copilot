// A tiny Server-Sent Events reader, shared by the checks and the smoke client.
export interface SseEvent {
  event: string;
  data: any;
}

export async function* readSse(res: Response): AsyncGenerator<SseEvent> {
  if (!res.body) throw new Error("Response has no body");
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith(":")) continue; // heartbeat comment
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trim());
      }
      if (data.length > 0) yield { event, data: JSON.parse(data.join("\n")) };
    }
  }
}
