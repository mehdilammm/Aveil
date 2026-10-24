// Agent Readiness areas. Derived from the finding type, so older findings get an area too.
export type Area = "feed" | "access" | "structured_data" | "store_pages" | "checkout";

export const AREAS: { key: Area; label: string; description: string }[] = [
  { key: "feed", label: "Feed", description: "Product data an AI shopping agent needs: price, title, description, image, brand, identifiers." },
  { key: "access", label: "Access", description: "Whether AI bots get the same pages as a browser." },
  { key: "structured_data", label: "Structured data", description: "robots.txt, JSON-LD Product data and llms.txt." },
  { key: "store_pages", label: "Store pages", description: "Shop, cart, checkout, terms, privacy and returns pages." },
  { key: "checkout", label: "Checkout", description: "Guest checkout, shipping, payment, captcha and stock: what can stop a purchase." },
];

export function areaOf(f: { type: string; finding_key: string }): Area {
  if (f.type.startsWith("checkout_") || f.type.startsWith("agentic_")) return "checkout";
  if (f.type.startsWith("access_")) return "access";
  if (f.type.startsWith("robots_") || f.type.startsWith("schema_") || f.type.startsWith("llms_")) return "structured_data";
  if (f.finding_key.startsWith("page:")) return "store_pages";
  return "feed";
}
