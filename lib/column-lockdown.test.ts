import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Billing and approval columns change only on the server (service role); the browser key can rename a workspace
// and edit a store's name, url and bot log retention. Production result: supabase/tests/column_lockdown.sql.
const sql = readFileSync("supabase/migrations/20261025192445_lock_down_column_updates.sql", "utf8");

describe("column lock-down", () => {
  it("revokes table-wide UPDATE and grants only the safe columns", () => {
    expect(sql).toMatch(/revoke update on public\.workspaces from authenticated, anon;\s*grant update \(name\) on public\.workspaces to authenticated;/);
    expect(sql).toMatch(/revoke update on public\.stores from authenticated, anon;\s*grant update \(name, url, bot_hit_retention_days\) on public\.stores to authenticated;/);
    for (const col of ["plan", "auto_fix_enabled", "auto_fix_approved_at", "auto_fix_approved_by", "owner_id", "connection_status"]) expect(sql.match(/grant update \(([^)]*)\)/g)!.join(" "), col).not.toContain(col);
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
