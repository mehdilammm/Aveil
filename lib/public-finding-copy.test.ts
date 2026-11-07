import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import ar from "@/messages/ar.json";
import { COPY_IDS, findingCopy } from "./public-finding-copy";

const F = (finding_key: string, type: string, title = "", guidance = "") => ({ finding_key, type, title, guidance });

describe("/check findings from the catalog", () => {
  it("ids and values come from the stored key, type and title", () => {
    expect(findingCopy(F("llms_txt:missing", "llms_txt", "No llms.txt (information only)"))).toEqual({ id: "llms_txt_missing", values: {} });
    expect(findingCopy(F("robots:GPTBot", "robots_blocks_bot", "robots.txt blocks GPTBot"))).toEqual({ id: "robots_blocks_bot", values: { bot: "GPTBot" } });
    expect(findingCopy(F("access:OAI-SearchBot", "access_blocked"))).toEqual({ id: "access_blocked", values: { bot: "OAI-SearchBot" } });
    expect(findingCopy(F("protection:blocked", "bot_protection_blocked", "Bot protection blocked our automated check (Cloudflare)"))).toEqual({ id: "bot_protection_blocked", values: { vendor: "Cloudflare" } });
    expect(findingCopy(F("wcstore:no_images:12", "wcstore_no_images", '"Argan oil": no images'))).toEqual({ id: "wcstore_no_images", values: { product: "Argan oil" } });
    expect(findingCopy(F("price:mismatch:product1", "price_mismatch", "Price in structured data differs from the store's product price"))!.id).toBe("price_mismatch_store");
    expect(findingCopy(F("schema:unavailable:product2", "schema", "", "Allow AgentScopeBot or verified bots"))!.id).toBe("schema_unavailable_protected");
    expect(findingCopy(F("something:new", "new_rule"))).toBeNull();
  });

  it("every id has a title and a fix in English and Arabic, with the same placeholders", () => {
    const ids = new Set(Object.keys(en.checkFindings));
    expect([...new Set(COPY_IDS)].sort()).toEqual([...ids].sort());
    expect(Object.keys(ar.checkFindings).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      for (const part of ["title", "fix"] as const) {
        const e = (en.checkFindings as Record<string, Record<string, string>>)[id][part];
        const a = (ar.checkFindings as Record<string, Record<string, string>>)[id][part];
        expect(e, `${id}.${part}`).toBeTruthy();
        expect(a, `${id}.${part}`).toBeTruthy();
        expect((a.match(/\{\w+\}/g) ?? []).sort(), `${id}.${part}`).toEqual((e.match(/\{\w+\}/g) ?? []).sort());
      }
    }
  });
});
