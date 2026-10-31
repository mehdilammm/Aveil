import type { IncomingMessage, ServerResponse } from "node:http";
import { runBrowserPayload } from "../../lib/browser-runner-core";
import { BrowserUnavailableError } from "../../lib/browser-sim";
import { parseRunnerPayload, SIGNATURE_HEADER, TIMESTAMP_HEADER, verifyRunnerRequest } from "../../lib/browser-signing";

const MAX_BODY = 16_384;

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        resolve(null);
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(null));
  });
}

// POST /api/run from the AgentScope app, signed with BROWSER_RUNNER_SECRET. Anything else: 404, as if absent.
// This function holds no other secret: no database key, no AI keys, no store token.
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const send = (status: number, body?: unknown) => {
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    res.end(body === undefined ? "" : JSON.stringify(body));
  };
  if (req.method !== "POST") return send(404);
  const body = await readBody(req);
  const header = (name: string) => {
    const v = req.headers[name];
    return typeof v === "string" ? v : null;
  };
  if (body === null || !verifyRunnerRequest(process.env.BROWSER_RUNNER_SECRET, header(TIMESTAMP_HEADER), header(SIGNATURE_HEADER), body)) return send(404);
  const payload = parseRunnerPayload(body);
  if (!payload) return send(400, { error: "bad payload" });
  try {
    return send(200, { result: await runBrowserPayload(payload) });
  } catch (err) {
    if (err instanceof BrowserUnavailableError) return send(503, { error: err.message.slice(0, 300) });
    console.error("browser test failed", err instanceof Error ? err.message : "unknown");
    return send(500, { error: err instanceof Error ? err.message.slice(0, 300) : "browser test failed" });
  }
}
