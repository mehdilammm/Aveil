import "server-only";
import { readdirSync, readFileSync } from "node:fs";
import { startGuardedProxy } from "./browser-proxy";
import { BrowserUnavailableError, type BrowserFlowResult, type Launched } from "./browser-sim";

// Chromium for the agent purchase test (F7 Mode B). Imported only by the browser runner (browser-runner/), a
// separate Vercel project whose only secret is the request-signing secret; the app never starts a browser.

// Vercel Fluid compute list prices (iad1, Washington D.C.; other regions cost more): active CPU per hour and
// provisioned memory per GB-hour. Source: Vercel changelog "Lower pricing with Active CPU pricing for Fluid compute".
export const VERCEL_PRICES = { cpuHourUsd: 0.128, gbHourUsd: 0.0106, region: "iad1" } as const;

export type BrowserCost = { wall_ms: number; node_cpu_ms: number; browser_cpu_ms: number | null; memory_mb: number; memory_source: "runtime" | "assumed"; usd_micros: number; prices: typeof VERCEL_PRICES };
export type BrowserResult = BrowserFlowResult & { cost: BrowserCost };

// Estimated cost of one run: CPU (this process and the browser's processes) at the CPU price, plus the memory
// the function holds for the whole run at the GB-hour price.
export function costOf(m: { wallMs: number; nodeCpuMs: number; browserCpuMs: number | null; memoryMb: number }): number {
  const cpuHours = (m.nodeCpuMs + (m.browserCpuMs ?? m.wallMs)) / 3_600_000;
  const gbHours = (m.memoryMb / 1024) * (m.wallMs / 3_600_000);
  return Math.round((cpuHours * VERCEL_PRICES.cpuHourUsd + gbHours * VERCEL_PRICES.gbHourUsd) * 1_000_000);
}

// CPU time of a process and all its descendants, from /proc (Linux; clock ticks of 10 ms). Null elsewhere.
export function treeCpuMs(rootPid: number, proc = "/proc"): number | null {
  try {
    const rows = readdirSync(/*turbopackIgnore: true*/ proc)
      .filter((d) => /^\d+$/.test(d))
      .map((pid) => {
        try {
          const stat = readFileSync(`${proc}/${pid}/stat`, "utf8");
          const f = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
          return { pid: Number(pid), ppid: Number(f[1]), ticks: Number(f[11]) + Number(f[12]) + Number(f[13]) + Number(f[14]) };
        } catch {
          return null;
        }
      })
      .filter((r): r is { pid: number; ppid: number; ticks: number } => Boolean(r));
    const tree = new Set([rootPid]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const r of rows) {
        if (!tree.has(r.pid) && tree.has(r.ppid)) {
          tree.add(r.pid);
          grew = true;
        }
      }
    }
    const ticks = rows.filter((r) => tree.has(r.pid)).reduce((n, r) => n + r.ticks, 0);
    return rows.some((r) => r.pid === rootPid) ? ticks * 10 : null;
  } catch {
    return null;
  }
}

// Chromium from @sparticuz/chromium, started behind the guarded proxy. BrowserUnavailableError when this
// deployment's function does not carry the browser files.
export async function launchChromium(): Promise<Launched> {
  const chromium = (await import("@sparticuz/chromium")).default;
  let executablePath: string;
  try {
    chromium.setGraphicsMode = false;
    executablePath = await chromium.executablePath();
  } catch (err) {
    throw new BrowserUnavailableError(`Chromium is not available here: ${(err as Error).message}`.slice(0, 300));
  }
  const puppeteer = (await import("puppeteer-core")).default;
  const proxy = await startGuardedProxy();
  try {
    // @sparticuz/chromium's defaults include --disable-web-security; same-origin rules stay on here. --no-sandbox
    // stays: Lambda has no user namespaces for Chrome's sandbox, which is why this runs in its own project with no
    // secrets (only the request-signing secret).
    const args = [
      ...chromium.args.filter((a: string) => a !== "--disable-web-security"),
      `--proxy-server=http://127.0.0.1:${proxy.port}`,
      "--proxy-bypass-list=<-loopback>",
      "--disable-quic",
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      "--webrtc-ip-handling-policy=disable_non_proxied_udp",
    ];
    const browser = await puppeteer.launch({ executablePath, headless: "shell", args: await puppeteer.defaultArgs({ args, headless: "shell" }), defaultViewport: { width: 1280, height: 900 }, protocolTimeout: 30_000 });
    // No downloads, and any window a page opens (popup, window.open) is closed at once.
    const cdp = await browser.target().createCDPSession();
    await cdp.send("Browser.setDownloadBehavior", { behavior: "deny" }).catch(() => {});
    browser.on("targetcreated", (t) => {
      if (t.opener()) void t.page().then((p) => p?.close()).catch(() => {});
    });
    const pid = browser.process()?.pid ?? null;
    return {
      browser,
      kill: () => {
        browser.process()?.kill("SIGKILL");
        void proxy.close();
      },
      close: async () => {
        const browserCpuMs = pid ? treeCpuMs(pid) : null;
        await browser.close().catch(() => browser.process()?.kill("SIGKILL"));
        await proxy.close();
        return { browserCpuMs };
      },
    };
  } catch (err) {
    await proxy.close();
    throw err;
  }
}
