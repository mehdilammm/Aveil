import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Every string the dashboard, /check and login render comes from the catalogs, so Arabic never shows English UI text.
// This reads the page and component sources: JSX text, user-facing attributes and error strings. Data from the store
// or the scan (product names, finding text) is not in the source, so it is not flagged.
const ROOTS = ["app/stores", "app/settings", "app/check", "app/login", "components"];
const ALLOWED = /^(\S+\.(?:json|jsonl|txt|csv):?|AgentScope|WooCommerce|Groq|NVIDIA|Shopify|WordPress|Gemini|Mistral|ChatGPT|Claude|Perplexity|robots\.txt|llms\.txt|CSV|JSON|UTC|GTIN|MPN|EAN|UPC|API|https?:\/\/\S+|shop\.example\.com|you@store\.com|ck_…|cs_…|[A-Z]{2,5})$/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".tsx") && !p.endsWith(".test.tsx") ? [p] : [];
  });
}
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

// Code that looks like text to the patterns: conditions, member access, enum values written in CamelCase.
const CODE = /[?&!]|^[\w$]+(\.[\w$]+)+$|^[A-Z][a-z]+[A-Z]\w*$|^Product$/;

export function englishIn(source: string): string[] {
  const s = strip(source);
  const out: string[] = [];
  // JSX text on one line: >Some words< (not code: no =, ;, (, ), {, }, &&, =>).
  for (const m of s.matchAll(/>([^<>{}=;()\n`]*[A-Za-z]{3,}[^<>{}=;()\n`]*)</g)) {
    const text = m[1].trim();
    if (text && !ALLOWED.test(text) && /[a-z]{2,}/.test(text) && !/^[\s\w.]*\?$/.test(text)) out.push(text);
  }
  // JSX text alone on a line inside an element.
  for (const m of s.matchAll(/\n\s+([A-Z][a-z]+(?: [A-Za-z'’,.]+)+)\s*\n\s*</g)) out.push(m[1].trim());
  // User-facing attributes and messages.
  for (const m of s.matchAll(/\b(?:placeholder|aria-label|title|alt|label)="([^"]*[A-Za-z]{3,}[^"]*)"/g)) if (!ALLOWED.test(m[1])) out.push(m[1]);
  for (const m of s.matchAll(/set(?:Error|Message|Msg|Notice)\(\s*"([^"]+)"/g)) out.push(m[1]);
  // Strings chosen in JSX expressions: {busy ? "Saving…" : "Save"}, x ?? "Something went wrong.", confirm("…").
  for (const m of s.matchAll(/(?:[?:]|\?\?|confirm\()\s*"([A-Z][^"\n]*[a-z]{2,}[^"\n]*)"/g)) if (!ALLOWED.test(m[1])) out.push(m[1]);
  return out.filter((t) => !CODE.test(t));
}

describe("no hardcoded English in the dashboard, /check and login", () => {
  it("every rendered string comes from the catalogs (en + ar)", () => {
    const found = ROOTS.flatMap((r) => files(r)).flatMap((f) => englishIn(readFileSync(f, "utf8")).map((t) => `${f}: ${t}`));
    expect(found).toEqual([]);
  });

  it("the check catches JSX text, attributes and messages, and ignores code and brand names", () => {
    expect(englishIn(`<p>Run a scan</p>`)).toEqual(["Run a scan"]);
    expect(englishIn(`<input placeholder="Store name" />`)).toEqual(["Store name"]);
    expect(englishIn(`setError("Network error. Please try again.")`)).toEqual(["Network error. Please try again."]);
    expect(englishIn(`<b>{busy ? "Saving…" : "Save the store"}</b>`)).toEqual(["Saving…", "Save the store"]);
    expect(englishIn(`<p>{t("x")}</p><b>WooCommerce</b><a title="https://x.y/z">x</a>`)).toEqual([]);
  });
});
