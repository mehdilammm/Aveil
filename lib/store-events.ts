// F2 / F3: the store changes the plugin (1.7.0) reports, checked before anything is stored. Names and versions
// only; anything else in the body is ignored.
export const BREAKAGE_KINDS = ["plugin_updated", "theme_updated", "core_updated", "theme_switched", "plugin_activated", "plugin_deactivated"] as const;
export const PRODUCT_KINDS = ["product_published", "product_updated"] as const;
export type EventKind = (typeof BREAKAGE_KINDS)[number] | (typeof PRODUCT_KINDS)[number];
export type StoreEvent = { event_id: string; kind: EventKind; subject: string | null; slug: string | null; old_version: string | null; new_version: string | null; product_id: number | null; occurred_at: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = new Set<string>([...BREAKAGE_KINDS, ...PRODUCT_KINDS]);
export const MAX_EVENTS = 50;
const MAX_AGE_MS = 7 * 86_400_000;

// Tags are dropped (the plugin strips them too), then any stray angle bracket or control character.
const text = (v: unknown, n: number) => {
  const t = typeof v === "string" ? v.replace(/<[^>]*>/g, "").replace(/[<>]/g, "").split("").filter((ch) => ch.charCodeAt(0) >= 32).join("").trim().slice(0, n) : "";
  return t || null;
};

export function validateEvents(body: unknown, now: Date): { events: StoreEvent[]; skipped: number } | { error: string } {
  const list = (body as { events?: unknown } | null)?.events;
  if (!Array.isArray(list)) return { error: "Body must be {\"events\": [...]}" };
  if (list.length > MAX_EVENTS) return { error: `At most ${MAX_EVENTS} events per request` };
  const events: StoreEvent[] = [];
  let skipped = 0;
  for (const raw of list as Record<string, unknown>[]) {
    const at = typeof raw?.at === "string" ? Date.parse(raw.at) : NaN;
    const pid = raw?.product_id === null || raw?.product_id === undefined ? null : Number(raw.product_id);
    const ok = raw && typeof raw.id === "string" && UUID.test(raw.id) && typeof raw.kind === "string" && KINDS.has(raw.kind) && Number.isFinite(at) && at <= now.getTime() + 300_000 && at >= now.getTime() - MAX_AGE_MS && (pid === null || (Number.isInteger(pid) && pid > 0));
    const isProduct = ok && (PRODUCT_KINDS as readonly string[]).includes(raw.kind as string);
    if (!ok || (isProduct && pid === null)) {
      skipped++;
      continue;
    }
    events.push({
      event_id: (raw.id as string).toLowerCase(),
      kind: raw.kind as EventKind,
      subject: text(raw.subject, 200),
      slug: text(raw.slug, 200),
      old_version: text(raw.old_version, 40),
      new_version: text(raw.new_version, 40),
      product_id: isProduct ? pid : null,
      occurred_at: new Date(at).toISOString(),
    });
  }
  return { events, skipped };
}

export const isBreakageKind = (k: string) => (BREAKAGE_KINDS as readonly string[]).includes(k);
