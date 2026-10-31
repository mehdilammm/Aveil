import "server-only";
import { guardedSend } from "./agent-send";
import { costOf, launchChromium, VERCEL_PRICES, type BrowserCost, type BrowserResult } from "./browser-launch";
import { BROWSER_LIMITS, browserPurchase, type Launched } from "./browser-sim";
import type { RunnerPayload } from "./browser-signing";

const ASSUMED_MEMORY_MB = 2048; // Vercel's default function memory, when the runtime does not say

// One browser test, run inside the browser runner: no database, no store token; the app checked ownership and
// signed the X-AgentScope-Check value. The cost is measured, kept with the result and written to the logs.
export async function runBrowserPayload(p: RunnerPayload, launch: () => Promise<Launched> = launchChromium): Promise<BrowserResult> {
  const t0 = Date.now();
  const c0 = process.cpuUsage();
  // A missing browser is found before the run starts, so the job can wait.
  let first: Launched | null = await launch();
  const r = await browserPurchase({
    storeUrl: p.storeUrl,
    checkToken: null,
    checkValue: p.checkValue,
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
  console.log(JSON.stringify({ event: "browser_test_cost", job_id: p.jobId, ...cost }));
  return { ...r, cost };
}
