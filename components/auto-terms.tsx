import { Fragment } from "react";
import { Term, type GlossaryKey } from "./term";

// Words in a sentence that have a glossary entry, in English and Arabic (first match wins, longest first). Each
// entry gets one "?" per text, on its first occurrence, so a sentence is not cluttered.
const WORDS: [GlossaryKey, string[]][] = [
  ["robots_txt", ["robots.txt"]],
  ["llms_txt", ["llms.txt"]],
  ["json_ld", ["JSON-LD"]],
  ["structured_data", ["structured data", "Structured data", "البيانات المنظمة", "بيانات المنتج المنظمة", "بيانات منظمة"]],
  ["gtin", ["GTIN"]],
  ["product_feed", ["product feed", "Product feed", "Product feeds", "product feeds", "موجز المنتجات", "خلاصات المنتجات"]],
  ["store_api", ["Store API"]],
  ["oai_searchbot", ["OAI-SearchBot"]],
  ["chatgpt_user", ["ChatGPT-User"]],
  ["ai_crawler", ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended"]],
  ["user_agent", ["user agent", "User-Agent", "User agent", "وكيل المستخدم"]],
  ["sitemap", ["sitemap", "Sitemap", "خريطة الموقع", "خريطة المنتجات"]],
  ["bot_protection", ["bot protection", "Bot protection", "حماية الروبوتات"]],
  ["ucp_acp", ["UCP", "ACP"]],
  ["order_attribution", ["order attribution", "Order attribution", "مصدر الطلب"]],
];
const ALL = WORDS.flatMap(([k, ws]) => ws.map((w) => [k, w] as const)).sort((a, b) => b[1].length - a[1].length);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Whole words only for Latin terms (so "ACP" is not matched inside a word); Arabic terms as written.
const PATTERN = new RegExp(ALL.map(([, w]) => (/^[\x20-\x7e]+$/.test(w) ? `(?<![A-Za-z0-9-])${escape(w)}(?![A-Za-z0-9-])` : escape(w))).join("|"), "g");
const KEY = new Map(ALL.map(([k, w]) => [w, k]));

export function termParts(text: string): (string | { k: GlossaryKey; word: string })[] {
  const out: (string | { k: GlossaryKey; word: string })[] = [];
  const seen = new Set<GlossaryKey>();
  let at = 0;
  for (const m of text.matchAll(PATTERN)) {
    const k = KEY.get(m[0])!;
    if (seen.has(k)) continue;
    seen.add(k);
    if (m.index! > at) out.push(text.slice(at, m.index));
    out.push({ k, word: m[0] });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

export function AutoTerms({ text }: { text: string }) {
  return <>{termParts(text).map((p, i) => (typeof p === "string" ? <Fragment key={i}>{p}</Fragment> : <Term key={i} k={p.k}>{p.word}</Term>))}</>;
}
