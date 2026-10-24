import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Static checks over every migration: the tenant rules cannot be forgotten on a new table. The same rules are
// checked against the real database by supabase/tests/tenant_isolation.sql (last run: EXECUTION_PLAN.md, G2).
const dir = join(__dirname, "../supabase/migrations");
const sql = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
const tables = [...sql.matchAll(/create table (?:if not exists )?public\.([a-z_]+)/g)].map((m) => m[1]);
const policies = [...sql.matchAll(/create policy "[^"]+" on public\.([a-z_]+)[^;]*;/g)].map((m) => ({ table: m[1], text: m[0] }));
// Tables only the server reads (service role): no policy, and the table privilege removed or never usable.
const SERVICE_ONLY = ["store_credentials", "store_write_credentials", "traffic_connectors", "workspace_invites", "job_steps", "bot_ip_ranges", "public_reports", "public_scan_limits", "public_gemini_usage", "public_mistral_usage", "grounding_usage", "grounding_usage_daily", "plan_waitlist", "shopify_waitlist"];

describe("tenant isolation (migrations)", () => {
  it("every table turns row level security on", () => {
    for (const t of tables) expect(sql, t).toMatch(new RegExp(`alter table public\\.${t} enable row level security`));
  });

  it("every policy for signed-in users is scoped to the user's workspace or to the user", () => {
    for (const p of policies.filter((x) => / to authenticated/.test(x.text) && !/using \(false\)/.test(x.text))) {
      expect(p.text, p.table).toMatch(/private\.(store_role|ws_role)|auth\.uid\(\)/);
    }
  });

  it("service-only tables have no policy for signed-in users", () => {
    for (const t of SERVICE_ONLY) expect(policies.filter((p) => p.table === t && / to authenticated/.test(p.text) && !/using \(false\)/.test(p.text)), t).toEqual([]);
  });

  it("the key and token tables lose their table privilege too", () => {
    for (const t of ["store_write_credentials", "workspace_invites", "job_steps", "bot_ip_ranges"]) expect(sql, t).toMatch(new RegExp(`revoke all on table public\\.${t} from anon, authenticated`));
    expect(sql).toMatch(/revoke all on function public\.get_store_write_credentials\(uuid, uuid\) from public, anon, authenticated/);
  });
});
