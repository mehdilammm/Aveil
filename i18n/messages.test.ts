import { describe, expect, it } from "vitest";
import ar from "../messages/ar.json";
import en from "../messages/en.json";
import { dirOf, isLocale, LOCALES } from "./config";

const keys = (o: object, prefix = ""): string[] =>
  Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();
const get = (o: object, path: string) => path.split(".").reduce<unknown>((x, k) => (x as Record<string, unknown>)[k], o) as string;

describe("message catalogs", () => {
  it("en and ar have the same keys", () => {
    expect(keys(ar).sort()).toEqual(keys(en).sort());
  });

  it("every message keeps the same placeholders, and none is empty", () => {
    for (const k of keys(en)) {
      expect(get(ar, k).trim().length, k).toBeGreaterThan(0);
      expect(placeholders(get(ar, k)), k).toEqual(placeholders(get(en, k)));
    }
  });

  it("no raw < or > in messages (next-intl would read them as rich-text tags)", () => {
    for (const k of keys(en)) for (const cat of [en, ar]) expect(get(cat, k), k).not.toMatch(/[<>]/);
  });

  it("Arabic is right-to-left; only known locales are accepted", () => {
    expect(LOCALES).toEqual(["en", "ar"]);
    expect(dirOf("ar")).toBe("rtl");
    expect(dirOf("en")).toBe("ltr");
    expect(isLocale("fr")).toBe(false);
  });
});

describe("site text", () => {
  it("names no competitor (pages and both catalogs)", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const files: string[] = [];
    const walk = (d: string) => readdirSync(d).forEach((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : n.endsWith(".tsx") && files.push(join(d, n))));
    walk("app");
    walk("components");
    for (const f of [...files, "messages/en.json", "messages/ar.json"]) expect(readFileSync(f, "utf8"), f).not.toMatch(/agentic\s*track|agentcart|mention\s*network/i);
  });

  it("the landing says the approved hero and edge line, in both languages", () => {
    expect(en.landing.hero).toBe("See why AI shopping agents skip your WooCommerce products. Fix without breaking the store. Prove it with real AI-referred orders.");
    expect(en.landing.edge).toBe("Others give you a score. We show why AI agents don't buy, fix it, and prove it with real orders.");
    expect(ar.landing.hero.length).toBeGreaterThan(40);
  });
});
