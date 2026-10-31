// Plain words for the plugin's raw traffic values (category, page type, HTTP status); the raw value stays available
// for Technical details. Unknown values are shown as they are.
export function httpGroup(status: number): "ok" | "redirect" | "notFound" | "blocked" | "limited" | "error" | "other" {
  if (status >= 200 && status < 300) return "ok";
  if (status >= 300 && status < 400) return "redirect";
  if (status === 404 || status === 410) return "notFound";
  if (status === 401 || status === 403) return "blocked";
  if (status === 429) return "limited";
  if (status >= 500) return "error";
  return "other";
}

type T = { has: (key: string) => boolean; (key: string): string };
export const labelOf = (t: T, group: "cat" | "route", raw: string) => (t.has(`${group}.${raw}`) ? t(`${group}.${raw}`) : raw);
