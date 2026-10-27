// Hosting guide (F5): who serves and protects the store, guessed from response headers, nameservers and active
// plugins [Heuristic: a header can be added by anything]. When AI bots get 403 / 429 / a challenge, the Fix Center
// shows that provider's steps (catalog hosting.providers.<id>) and its official documentation. Only settings the
// provider documents are named; for the others the steps stay general.
export type ProviderId = "cloudflare" | "hostinger" | "litespeed" | "siteground" | "kinsta" | "wpengine" | "sucuri" | "wordfence" | "akamai" | "imperva" | "datadome";
export type Detected = { id: ProviderId; name: string; signal: string };

export const PROVIDERS: Record<ProviderId, { name: string; docs: string }> = {
  cloudflare: { name: "Cloudflare", docs: "https://developers.cloudflare.com/bots/additional-configurations/block-ai-bots/" },
  hostinger: { name: "Hostinger", docs: "https://www.hostinger.com/support/429-errors-on-automated-integrations-and-link-previews/" },
  litespeed: { name: "LiteSpeed", docs: "https://docs.litespeedtech.com/" },
  siteground: { name: "SiteGround", docs: "https://www.siteground.com/kb/" },
  kinsta: { name: "Kinsta", docs: "https://kinsta.com/docs/" },
  wpengine: { name: "WP Engine", docs: "https://wpengine.com/support/" },
  sucuri: { name: "Sucuri", docs: "https://docs.sucuri.net/" },
  wordfence: { name: "Wordfence", docs: "https://www.wordfence.com/help/" },
  akamai: { name: "Akamai", docs: "https://techdocs.akamai.com/" },
  imperva: { name: "Imperva", docs: "https://docs.imperva.com/" },
  datadome: { name: "DataDome", docs: "https://docs.datadome.co/" },
};

const h = (headers: Record<string, string>, name: string) => headers[name.toLowerCase()] ?? "";

export function detectHosting(input: { headers: Record<string, string> | null; nameservers: string[]; plugins: { name: string; plugin: string }[] }): Detected[] {
  const H = Object.fromEntries(Object.entries(input.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
  const ns = input.nameservers.map((n) => n.toLowerCase());
  const out: Detected[] = [];
  const add = (id: ProviderId, signal: string) => {
    if (!out.some((d) => d.id === id)) out.push({ id, name: PROVIDERS[id].name, signal });
  };
  const server = h(H, "server").toLowerCase();
  if (h(H, "cf-ray")) add("cloudflare", "header cf-ray");
  else if (server.includes("cloudflare")) add("cloudflare", `header server: ${h(H, "server")}`);
  else if (ns.some((n) => n.endsWith(".ns.cloudflare.com"))) add("cloudflare", `nameserver ${ns.find((n) => n.endsWith(".ns.cloudflare.com"))}`);
  if (h(H, "platform").toLowerCase() === "hostinger") add("hostinger", "header platform: hostinger");
  else if (h(H, "panel").toLowerCase() === "hpanel") add("hostinger", "header panel: hpanel");
  else if (ns.some((n) => n.includes("dns-parking.com"))) add("hostinger", `nameserver ${ns.find((n) => n.includes("dns-parking.com"))}`);
  if (server.includes("litespeed")) add("litespeed", `header server: ${h(H, "server")}`);
  else if (h(H, "x-litespeed-cache")) add("litespeed", "header x-litespeed-cache");
  if (ns.some((n) => n.includes("siteground"))) add("siteground", `nameserver ${ns.find((n) => n.includes("siteground"))}`);
  if (h(H, "x-kinsta-cache")) add("kinsta", "header x-kinsta-cache");
  if (/wp engine/i.test(h(H, "x-powered-by"))) add("wpengine", `header x-powered-by: ${h(H, "x-powered-by")}`);
  else if (h(H, "wpe-backend")) add("wpengine", "header wpe-backend");
  if (h(H, "x-sucuri-id")) add("sucuri", "header x-sucuri-id");
  else if (server.includes("sucuri")) add("sucuri", `header server: ${h(H, "server")}`);
  if (server.includes("akamaighost") || h(H, "akamai-grn")) add("akamai", server.includes("akamaighost") ? `header server: ${h(H, "server")}` : "header akamai-grn");
  if (h(H, "x-iinfo")) add("imperva", "header x-iinfo");
  if (h(H, "x-datadome")) add("datadome", "header x-datadome");
  const wf = input.plugins.find((p) => /wordfence/i.test(p.name) || p.plugin.startsWith("wordfence/"));
  if (wf) add("wordfence", `active plugin ${wf.name}`);
  return out;
}

// The scan stores the detection as one information finding; the provider ids are kept in the evidence as [id].
export function hostingFinding(storeUrl: string, detected: Detected[]) {
  if (!detected.length) return null;
  return {
    finding_key: "hosting:detected",
    type: "hosting_detected",
    product_id: null,
    title: `Hosting and protection detected: ${detected.map((d) => d.name).join(", ")} (information only)`.slice(0, 200),
    severity: "low" as const,
    basis: "heuristic" as const,
    evidence: detected.map((d) => `${d.name} [${d.id}]: ${d.signal}`).join("; ").slice(0, 1000),
    guidance: "Information only. When AI bots are blocked or rate-limited, the Fix Center shows where to look for this provider.",
    fix_url: storeUrl,
  };
}

export function providersIn(evidence: string): ProviderId[] {
  return [...evidence.matchAll(/\[([a-z]+)\]/g)].map((m) => m[1]).filter((id): id is ProviderId => id in PROVIDERS);
}

// Findings that mean an AI bot did not get the page (where the guide is useful).
export const BLOCKED_TYPES = new Set(["access_blocked", "access_degraded", "access_rate_limited", "checkout_blocked_bots", "checkout_rate_limited_bots", "access_check_unavailable"]);

// Pure: the nameserver zones to try for a host ("www.shop.example.com" → itself, then its parents down to 2 labels).
export function nsCandidates(host: string): string[] {
  const parts = host.toLowerCase().split(".");
  const out: string[] = [];
  for (let i = 0; i <= parts.length - 2; i++) out.push(parts.slice(i).join("."));
  return out;
}
