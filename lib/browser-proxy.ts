import "server-only";
import http from "node:http";
import net from "node:net";
import { safeLookup, urlProblem } from "./safe-fetch";

// The headless browser's only way out (F7 Mode B). Chromium starts with --proxy-server pointing here, so every
// connection it opens (the store's pages, scripts, third parties) is opened by this proxy with the same check as
// safe-fetch: public addresses only, checked when the connection opens, so a page cannot reach 169.254.169.254,
// localhost or a private network, even through DNS rebinding. HTTPS only (CONNECT to port 443); plain HTTP is
// refused. Bytes and connections are capped for one test.
export type GuardedProxy = { port: number; stats: { connections: number; refused: number; bytes: number }; close: () => Promise<void> };
type Connect = (o: net.NetConnectOpts) => net.Socket;

export function splitHostPort(target: string): { host: string; port: number } | null {
  const m = /^\[([^\]]+)\]:(\d+)$/.exec(target) ?? /^([^:]+):(\d+)$/.exec(target);
  return m ? { host: m[1], port: Number(m[2]) } : null;
}

// Why a CONNECT target is refused, or null.
export function connectProblem(target: string): string | null {
  const hp = splitHostPort(target);
  if (!hp || hp.port !== 443) return "only https on port 443";
  try {
    return urlProblem(new URL(`https://${hp.host.includes(":") ? `[${hp.host}]` : hp.host}`));
  } catch {
    return "invalid host";
  }
}

export async function startGuardedProxy(opts: { maxBytes?: number; maxConnections?: number; connect?: Connect } = {}): Promise<GuardedProxy> {
  const maxBytes = opts.maxBytes ?? 40 * 1024 * 1024;
  const maxConnections = opts.maxConnections ?? 300;
  const connect: Connect = opts.connect ?? ((o) => net.connect(o));
  const stats = { connections: 0, refused: 0, bytes: 0 };
  const sockets = new Set<net.Socket>();
  const track = (s: net.Socket) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  };

  const server = http.createServer((_req, res) => {
    stats.refused++;
    res.writeHead(403, { Connection: "close" }).end("https only");
  });
  server.on("connect", (req: http.IncomingMessage, client: net.Socket, head: Buffer) => {
    track(client);
    client.on("error", () => client.destroy());
    const problem = connectProblem(req.url ?? "") ?? (stats.connections >= maxConnections ? "connection limit" : stats.bytes >= maxBytes ? "byte limit" : null);
    if (problem) {
      stats.refused++;
      client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    stats.connections++;
    const { host, port } = splitHostPort(req.url!)!;
    let open = false;
    const upstream = connect({ host, port, lookup: safeLookup as never, timeout: 15_000 });
    track(upstream);
    upstream.once("connect", () => {
      open = true;
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head?.length) upstream.write(head);
      upstream.on("data", (chunk: Buffer) => {
        stats.bytes += chunk.length;
        if (stats.bytes > maxBytes) {
          upstream.destroy();
          client.destroy();
        }
      });
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on("timeout", () => upstream.destroy());
    upstream.on("error", () => {
      if (!open) {
        stats.refused++;
        client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      } else client.destroy();
    });
    client.on("close", () => upstream.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    stats,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}
