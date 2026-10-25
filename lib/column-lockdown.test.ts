import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Billing and approval columns change only on the server (service role); the browser key can rename a workspace
// and edit a store's name, url and bot log retention. Production result: supabase/tests/column_lockdown.sql.
const sql = readFileSync("supabase/migrations/20261025192445_lock_down_column_updates.sql", "utf8");
const sql2 = readFileSync("supabase/migrations/20261025193307_lock_down_store_insert_and_url.sql", "utf8");

describe("column lock-down", () => {
  it("revokes table-wide UPDATE and grants only the safe columns", () => {
    expect(sql).toMatch(/revoke update on public\.workspaces from authenticated, anon;\s*grant update \(name\) on public\.workspaces to authenticated;/);
    expect(sql).toMatch(/revoke update on public\.stores from authenticated, anon;\s*grant update \(name, url, bot_hit_retention_days\) on public\.stores to authenticated;/);
    for (const col of ["plan", "auto_fix_enabled", "auto_fix_approved_at", "auto_fix_approved_by", "owner_id", "connection_status"]) expect(sql.match(/grant update \(([^)]*)\)/g)!.join(" "), col).not.toContain(col);
  });

  it("stores: insert only the basic columns; update no longer includes url", () => {
    expect(sql2).toMatch(/revoke insert on public\.stores from authenticated, anon;\s*grant insert \(name, url, owner_id, workspace_id\) on public\.stores to authenticated;/);
    expect(sql2).toMatch(/revoke update on public\.stores from authenticated, anon;\s*grant update \(name, bot_hit_retention_days\) on public\.stores to authenticated;/);
  });

  it("revokes truncate, trigger and references on every public table", () => {
    expect(sql).toMatch(/revoke truncate, trigger, references on public\.%I from anon, authenticated/);
  });

  it("the app never writes those columns with the user's client", () => {
    for (const f of ["app/api/stores/[id]/autofix/route.ts", "lib/scan.ts"]) {
      const src = readFileSync(f, "utf8");
      for (const line of src.split("\n").filter((l) => /auto_fix_enabled|connection_status|connectionAfterScan/.test(l) && /\.update\(/.test(l))) expect(line, f).toMatch(/admin\.from\("stores"\)/);
    }
  });
});

describe("API grants match the policies", () => {
  const sql3 = readFileSync("supabase/migrations/20261025200000_tighten_api_grants.sql", "utf8");
  it("anon has nothing; authenticated writes only where a policy allows; future tables start locked", () => {
    expect(sql3).toMatch(/revoke all on public\.%I from anon/);
    expect(sql3).toMatch(/if t not in \('stores', 'visibility_prompts', 'workspaces'\) then\s*execute format\('revoke insert, update, delete on public\.%I from authenticated', t\)/);
    expect(sql3).toMatch(/revoke insert, delete on public\.workspaces from authenticated/);
    expect(sql3).toMatch(/alter default privileges for role postgres in schema public revoke all on tables from anon/);
  });
  it("the app writes with the user's client only to stores and visibility_prompts", async () => {
    const { execSync } = await import("node:child_process");
    const out = execSync(`grep -rnE 'supabase\\.from\\("[a-z_]+"\\)\\.(insert|update|upsert|delete)' app lib --include=*.ts --include=*.tsx || true`).toString();
    const tables = new Set([...out.matchAll(/supabase\.from\("([a-z_]+)"\)/g)].map((m) => m[1]));
    expect([...tables].sort()).toEqual(["stores", "visibility_prompts"]);
  });
});
