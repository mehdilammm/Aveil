// Markets for AI Visibility questions. A question is written for one market, in that market's language, the way
// shoppers there type it (never an English question translated). The API request itself carries no location: the
// market is what the question is written for, shown with every answer.
export type MarketId = "US" | "UK" | "SA" | "AE" | "MA" | "FR";
export type Market = { id: MarketId; country: string; language: "en" | "ar" | "fr"; currency: string; native: string };

export const MARKETS: Market[] = [
  { id: "US", country: "United States", language: "en", currency: "USD", native: "American English with US spelling; prices in dollars" },
  { id: "UK", country: "United Kingdom", language: "en", currency: "GBP", native: "British English with UK spelling (colour, jewellery, delivery); prices in pounds" },
  { id: "SA", country: "Saudi Arabia", language: "ar", currency: "SAR", native: "Arabic as shoppers in Saudi Arabia type it (Gulf wording is fine, Arabic script); prices in riyals (ريال)" },
  { id: "AE", country: "United Arab Emirates", language: "ar", currency: "AED", native: "Arabic as shoppers in the UAE type it (Arabic script); prices in dirhams (درهم)" },
  { id: "MA", country: "Morocco", language: "ar", currency: "MAD", native: "Arabic as shoppers in Morocco type it (Moroccan words where natural, Arabic script); prices in dirhams (درهم)" },
  { id: "FR", country: "France", language: "fr", currency: "EUR", native: "French as shoppers in France type it; prices in euros" },
];
export const MARKET_IDS = MARKETS.map((m) => m.id);
export const marketOf = (id: unknown): Market | null => MARKETS.find((m) => m.id === id) ?? null;

// The store's own country, when it is one of the markets (WooCommerce default country, "MA:MA-07" → MA, GB → UK).
export function defaultMarket(wooCountry: string | null | undefined): MarketId {
  const code = (wooCountry ?? "").split(":")[0].toUpperCase();
  const id = code === "GB" ? "UK" : code;
  return (MARKET_IDS as string[]).includes(id) ? (id as MarketId) : "US";
}

// True when the text is written in the market's script: Arabic letters for Arabic markets, Latin for the others.
export function inMarketScript(text: string, m: Market): boolean {
  const letters = text.replace(/[^\p{L}]/gu, "");
  if (!letters) return false;
  const arabic = (letters.match(/\p{Script=Arabic}/gu) ?? []).length / letters.length;
  return m.language === "ar" ? arabic >= 0.6 : arabic === 0;
}

export const ACCESS_METHOD = { ungrounded: "Official API, ungrounded", grounded: "Official API, with Google Search" } as const;
