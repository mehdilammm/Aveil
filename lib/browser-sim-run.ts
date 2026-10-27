import "server-only";
import { readdirSync, readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { guardedSend, NotVerifiedError } from "./agent-sim-run";
import { startGuardedProxy } from "./browser-proxy";
import { BROWSER_LIMITS, browserPurchase, type BrowserFlowResult, type Launched } from "./browser-sim";
import { isOwnershipVerified } from "./ownership-store";

// Vercel Fluid compute list prices (iad1, Washington D.C.; other regions cost more): active CPU per hour and
// provisioned memory per GB-hour. Source: Vercel changelog "Lower pricing with Active CPU pricing for Fluid compute".
export const VERCEL_PRICES = { cpuHourUsd: 0.128, gbHourUsd: 0.0106, region: "iad1" } as const;
const ASSUMED_MEMORY_MB = 2048; // Vercel's default function memory, when the runtime does not say

export type BrowserCost = { wall_ms: number; node_cpu_ms: number; browser_cpu_ms: number | null; memory_mb: number; memory_source: "runtime" | "assumed"; usd_micros: number; prices: typeof VERCEL_PRICES };
export type BrowserResult = BrowserFlowResult & { cost: BrowserCost };
export class BrowserUnavailableError extends Error {}

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
    const rows = readdirSync(proc)
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
    const args = [
      ...chromium.args,
      `--proxy-server=http://127.0.0.1:${proxy.port}`,
      "--proxy-bypass-list=<-loopback>",
      "--disable-quic",
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      "--webrtc-ip-handling-policy=disable_non_proxied_udp",
    ];
    const browser = await puppeteer.launch({ executablePath, headless: "shell", args: await puppeteer.defaultArgs({ args, headless: "shell" }), defaultViewport: { width: 1280, height: 900 }, protocolTimeout: 30_000 });
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

// Browser tests a store started today (UTC), for the daily cap.
export async function browserTestsToday(admin: SupabaseClient, storeId: string): Promise<number> {
  const day = new Date().toISOString().slice(0, 10);
  const { data } = await admin.from("jobs").select("id").eq("store_id", storeId).eq("kind", "agent_sim_browser").gte("created_at", `${day}T00:00:00Z`);
  return data?.length ?? 0;
}

// One browser test of a verified store; the cost is measured, kept with the result and written to the logs.
export async function runBrowserTest(admin: SupabaseClient, store: { id: string; url: string }, jobId: string, launch: () => Promise<Launched> = launchChromium): Promise<BrowserResult> {
  if (!(await isOwnershipVerified(admin, store.id))) throw new NotVerifiedError("Store ownership is not verified, so the agent purchase test does not run.");
  const { data: connector } = await admin.rpc("get_traffic_connector_secret", { p_store_id: store.id }).maybeSingle<{ token: string }>();
  const t0 = Date.now();
  const c0 = process.cpuUsage();
  // A missing browser is found before the run starts, so the job can wait for a function that has it.
  let first: Launched | null = await launch();
  const r = await browserPurchase({
    storeUrl: store.url,
    checkToken: connector?.token ?? null,
    send: guardedSend,
    launch: async () => {
      const l = first ?? (await launch());
      first = null;
      return l;
    },
    budgetMs: BROWSER_LIMITS.budgetMs - (Date.now() - t0), // the 60 s include starting the browser
  });
  if (first) await (first as Launched).close();
  const c = process.cpuUsage(c0);
  const runtimeMb = Number(process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE);
  const memoryMb = Number.isFinite(runtimeMb) && runtimeMb > 0 ? runtimeMb : ASSUMED_MEMORY_MB;
  const m = { wallMs: Date.now() - t0, nodeCpuMs: Math.round((c.user + c.system) / 1000), browserCpuMs: r.browserCpuMs, memoryMb };
  const cost: BrowserCost = { wall_ms: m.wallMs, node_cpu_ms: m.nodeCpuMs, browser_cpu_ms: m.browserCpuMs, memory_mb: memoryMb, memory_source: Number.isFinite(runtimeMb) && runtimeMb > 0 ? "runtime" : "assumed", usd_micros: costOf(m), prices: VERCEL_PRICES };
  console.log(JSON.stringify({ event: "browser_test_cost", store_id: store.id, job_id: jobId, ...cost }));
  return { ...r, cost };
}
