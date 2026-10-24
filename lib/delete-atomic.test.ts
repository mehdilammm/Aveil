import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The hard delete lives in one database function (one transaction); these checks keep it that way.
const sql = readFileSync("supabase/migrations/20261024110000_atomic_delete.sql", "utf8");
const app = readFileSync("lib/data-export.ts", "utf8");

describe("atomic hard delete", () => {
  it("checks the owner, deletes, then verifies every workspace_id / store_id table and the Vault secrets", () => {
    const fn = sql.slice(sql.indexOf("function public.delete_workspace"), sql.indexOf("function public.delete_account_data"));
    expect(fn).toMatch(/role = 'owner'[\s\S]*raise exception/);
    expect(fn).toMatch(/delete from public\.workspaces where id = p_workspace_id/);
    // The tables are read from the schema at run time, so a new table is covered without editing the function.
    expect(fn).toMatch(/information_schema\.columns[\s\S]*column_name in \('workspace_id', 'store_id'\)/);
    expect(fn).toMatch(/from vault\.secrets where id = any\(v_secrets\)[\s\S]*raise exception/);
    expect(fn).toMatch(/store_credentials[\s\S]*store_write_credentials[\s\S]*traffic_connectors/);
  });

  it("only the service role can run it", () => {
    expect(sql).toMatch(/revoke all on function public\.delete_workspace\(uuid, uuid\) from public, anon, authenticated/);
    expect(sql).toMatch(/revoke all on function public\.delete_account_data\(uuid, text\) from public, anon, authenticated/);
  });

  it("the app deletes nothing row by row: one RPC for a workspace, one for the account data", () => {
    expect(app).toMatch(/rpc\("delete_workspace"/);
    expect(app).toMatch(/rpc\("delete_account_data"/);
    expect(app).not.toMatch(/\.delete\(\)/);
  });
});
