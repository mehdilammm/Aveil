import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { connectProblem, splitHostPort, startGuardedProxy } = await import("./browser-proxy");

// One raw CONNECT (or GET) through the proxy; resolves with the proxy's first answer line and the tunnel socket.
function raw(port: number, request: string): Promise<{ line: string; socket: net.Socket }> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => socket.write(request));
    socket.once("data", (d) => resolve({ line: d.toString().split("\r\n")[0], socket }));
    socket.once("error", reject);
  });
}

describe("guarded proxy for the headless browser (F7 Mode B)", () => {
  const cleanup: (() => unknown)[] = [];
  afterEach(async () => {
    for (const c of cleanup.splice(0)) await c();
  });

  it("refuses private, local and non-https targets before any connection", () => {
    expect(splitHostPort("[::1]:443")).toEqual({ host: "::1", port: 443 });
    expect(connectProblem("matha.site:443")).toBeNull();
    expect(connectProblem("matha.site:80")).toBe("only https on port 443");
    expect(connectProblem("127.0.0.1:443")).toMatch(/not a public address/);
    expect(connectProblem("169.254.169.254:443")).toMatch(/not a public address/);
    expect(connectProblem("10.0.0.5:443")).toMatch(/not a public address/);
    expect(connectProblem("[::1]:443")).toMatch(/not a public address/);
    expect(connectProblem("localhost:443")).toMatch(/not a public host/);
    expect(connectProblem("metadata.internal:443")).toMatch(/not a public host/);
  });

  it("tunnels a public https target through the DNS-checked connect, and refuses the rest", async () => {
    // Stands in for the store: an echo server; the injected connect records what the proxy asked for.
    const echo = net.createServer((s) => s.pipe(s));
    await new Promise<void>((r) => echo.listen(0, "127.0.0.1", r));
    cleanup.push(() => new Promise((r) => echo.close(r)));
    const asked: net.NetConnectOpts[] = [];
    const proxy = await startGuardedProxy({ connect: (o) => (asked.push(o), net.connect((echo.address() as net.AddressInfo).port, "127.0.0.1")) });
    cleanup.push(() => proxy.close());

    const ok = await raw(proxy.port, "CONNECT matha.site:443 HTTP/1.1\r\nHost: matha.site:443\r\n\r\n");
    expect(ok.line).toBe("HTTP/1.1 200 Connection Established");
    const echoed = new Promise<string>((r) => ok.socket.once("data", (d) => r(d.toString())));
    ok.socket.write("ping");
    expect(await echoed).toBe("ping");
    ok.socket.destroy();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ host: "matha.site", port: 443 });
    expect(typeof (asked[0] as { lookup?: unknown }).lookup).toBe("function"); // safeLookup: DNS answers checked at connect

    for (const target of ["127.0.0.1:443", "169.254.169.254:443", "matha.site:80"]) {
      const r = await raw(proxy.port, `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
      expect(r.line).toBe("HTTP/1.1 403 Forbidden");
      r.socket.destroy();
    }
    const http = await raw(proxy.port, "GET http://matha.site/ HTTP/1.1\r\nHost: matha.site\r\n\r\n");
    expect(http.line).toBe("HTTP/1.1 403 Forbidden");
    http.socket.destroy();
    expect(asked).toHaveLength(1);
    expect(proxy.stats).toMatchObject({ connections: 1, refused: 4 });
  });

  it("a failed connection answers 502 and caps connections", async () => {
    const proxy = await startGuardedProxy({ maxConnections: 1, connect: () => net.connect(1, "127.0.0.1") });
    cleanup.push(() => proxy.close());
    const first = await raw(proxy.port, "CONNECT matha.site:443 HTTP/1.1\r\n\r\n");
    expect(first.line).toBe("HTTP/1.1 502 Bad Gateway");
    const second = await raw(proxy.port, "CONNECT matha.site:443 HTTP/1.1\r\n\r\n");
    expect(second.line).toBe("HTTP/1.1 403 Forbidden");
  });
});
