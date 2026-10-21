// AI Visibility: ask an AI engine the store's questions and look for the store in the answers.
// Everything here works on the answer text only. Competitor names and ranks are extracted heuristically.

export const MAX_PROMPTS = 15;
export const RUN_INTERVAL_DAYS = 7;

export type BrandTerms = { names: string[]; host: string };

// Store name and domain, e.g. "Matha test" + "matha.site" → names ["Matha test", "matha"], host "matha.site".
export function brandTerms(storeName: string, storeUrl: string): BrandTerms {
  const host = new URL(storeUrl).hostname.replace(/^www\./, "").toLowerCase();
  const label = host.split(".")[0];
  const names = [...new Set([storeName.trim(), label].filter((n) => n.length >= 3))];
  return { names, host };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function matchTerms(text: string, terms: BrandTerms): string[] {
  const found: string[] = [];
  if (text.toLowerCase().includes(terms.host)) found.push(terms.host);
  for (const name of terms.names) {
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${escape(name)}($|[^\\p{L}\\p{N}])`, "iu").test(text)) found.push(name);
  }
  return found;
}

const URL_RE = /https?:\/\/[^\s<>()"'\]\[*`]+/gi;
const LIST_ITEM_RE = /^\s*(?:\d{1,2}[.)]|[-*•])\s+(.+)$/;

// Name at the start of a list item: "**Name**", "Name:" or "Name - ...".
function itemName(item: string): string | null {
  const bold = /\*\*([^*]{2,80})\*\*/.exec(item);
  const raw = bold ? bold[1] : (/^([^:–—\-(]{2,60})(?:[:–—-]|\s\()/.exec(item.replace(/\*/g, ""))?.[1] ?? "");
  const name = raw.replace(/[:.\s]+$/, "").trim();
  return name && name.split(/\s+/).length <= 8 ? name : null;
}

export type Analysis = {
  mentioned: boolean;
  rank: number | null; // position in the first list that names the store, null when not in a list
  matchedTerms: string[];
  competitors: string[];
  urls: string[];
};

export function analyzeAnswer(answer: string, terms: BrandTerms): Analysis {
  const matchedTerms = matchTerms(answer, terms);
  const items = answer.split(/\r?\n/).map((l) => LIST_ITEM_RE.exec(l)?.[1]).filter((x): x is string => Boolean(x));

  let rank: number | null = null;
  const competitors: string[] = [];
  items.forEach((item, i) => {
    if (matchTerms(item, terms).length) {
      if (rank === null) rank = i + 1;
      return;
    }
    const name = itemName(item);
    if (name && !competitors.some((c) => c.toLowerCase() === name.toLowerCase())) competitors.push(name);
  });

  const urls = [...new Set((answer.match(URL_RE) ?? []).map((u) => u.replace(/[.,;:!?]+$/, "")))];
  for (const u of urls) {
    try {
      const host = new URL(u).hostname.replace(/^www\./, "");
      if (host !== terms.host && !competitors.includes(host)) competitors.push(host);
    } catch {
      // not a URL after all
    }
  }

  return { mentioned: matchedTerms.length > 0, rank, matchedTerms, competitors: competitors.slice(0, 20), urls: urls.slice(0, 30) };
}

// Five starting questions from the store's biggest product categories. The user decides which to keep.
export function suggestPrompts(categories: string[], country: string | null): string[] {
  const where = country ? ` in ${country}` : " online";
  const cats = categories.map((c) => c.trim()).filter((c) => c && !/^uncategori[sz]ed$/i.test(c));
  const out: string[] = [];
  const templates = [
    (c: string) => `Where can I buy ${c.toLowerCase()}${where}?`,
    (c: string) => `What is the best online shop for ${c.toLowerCase()}${where}?`,
    (c: string) => `Recommend a trustworthy store that sells ${c.toLowerCase()}${where}.`,
  ];
  for (let t = 0; out.length < 5 && t < templates.length; t++) {
    for (const c of cats) {
      if (out.length >= 5) break;
      out.push(templates[t](c));
    }
  }
  if (out.length < 5) out.push(`Which online stores${country ? ` in ${country}` : ""} are good for handmade and local products?`);
  return [...new Set(out)].slice(0, 5);
}

export type EngineAnswer = {
  text: string;
  finishReason: string | null;
  inputTokens: number;
  outputTokens: number;
  blocked: string | null;
};

// Reads a Gemini generateContent response.
export function parseGeminiResponse(body: unknown): EngineAnswer {
  const b = (body ?? {}) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
    promptFeedback?: { blockReason?: string };
  };
  const candidate = b.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("").trim();
  const u = b.usageMetadata ?? {};
  return {
    text,
    finishReason: candidate?.finishReason ?? null,
    inputTokens: u.promptTokenCount ?? 0,
    outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
    blocked: b.promptFeedback?.blockReason ?? null,
  };
}

// When the next run is allowed: one run per store every RUN_INTERVAL_DAYS (failed runs do not count).
export function nextRunAt(lastRunAt: string | null): Date | null {
  if (!lastRunAt) return null;
  return new Date(Date.parse(lastRunAt) + RUN_INTERVAL_DAYS * 86_400_000);
}

export function canRun(lastRunAt: string | null, now: Date): boolean {
  const next = nextRunAt(lastRunAt);
  return !next || now >= next;
}
