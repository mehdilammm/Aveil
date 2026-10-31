// One icon set for sections and finding types: 24 px grid, 1.8 px stroke, round caps (drawn for AgentScope).
const PATHS = {
  overview: "M4 13h6V4H4zM14 20h6v-9h-6zM14 8h6V4h-6zM4 20h6v-3H4z",
  fix: "M14.5 6.5a4 4 0 0 0-5.3 5.3L4 17l3 3 5.2-5.2a4 4 0 0 0 5.3-5.3l-2.5 2.5-2.5-.5-.5-2.5z",
  alert: "M12 4 3 20h18zM12 10v4M12 17v.5",
  readiness: "M5 12.5 9.5 17 19 7",
  visibility: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  revenue: "M4 19V9M10 19V5M16 19v-7M22 19H2",
  traffic: "M3 12h4l3-7 4 14 3-7h4",
  bot: "M7 9h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zM12 5v4M9.5 14h.01M14.5 14h.01",
  impact: "M12 3 4 7v10l8 4 8-4V7zM4 7l8 4 8-4M12 11v10",
  market: "M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0zM3 12h18M12 3c3 3.3 3 14.7 0 18M12 3c-3 3.3-3 14.7 0 18",
  feed: "M4 6h16M4 12h16M4 18h10",
  report: "M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-1-3-2.2.3-1.3-1.3L16.8 5 14 4l-1 2h-2l-1-2-2.8 1 .3 2.2L6.2 8.5 4 8.2 3 11l2 1v1l-2 1 1 3 2.2-.3 1.3 1.3L7.2 20l2.8 1 1-2h2l1 2 2.8-1-.3-2.2 1.3-1.3 2.2.3 1-3-2-1z",
  menu: "M4 7h16M4 12h16M4 17h16",
  close: "M6 6l12 12M18 6 6 18",
  check: "M5 12.5 9.5 17 19 7",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8v.5",
  cart: "M3 4h2l2.4 11h10.2L20 8H6.2M9 20h.01M17 20h.01",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5",
  plug: "M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4",
  lock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  store: "M4 9l1.5-5h13L20 9M4 9h16v11H4zM4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M10 20v-5h4v5",
  arrow: "M5 12h14M13 6l6 6-6 6",
  more: "M5 12h.01M12 12h.01M19 12h.01",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size, label }: { name: IconName; size?: "sm"; label?: string }) {
  return (
    <svg className={`icon${size === "sm" ? " icon-sm" : ""}${name === "arrow" ? " icon-dir" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" role={label ? "img" : undefined} aria-hidden={label ? undefined : true} aria-label={label}>
      <path d={PATHS[name]} />
    </svg>
  );
}

// The icon of a finding area (categories.ts) and of each app section.
export const AREA_ICON: Record<string, IconName> = { feed: "feed", access: "bot", structured_data: "search", store_pages: "store", checkout: "cart" };
