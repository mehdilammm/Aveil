import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import { BarChart, LineChart } from "./charts";

const render = (el: React.ReactElement, locale = "en") => renderToStaticMarkup(h(NextIntlClientProvider, { locale, messages: en, timeZone: "UTC", children: el }));
const EMPTY = h("p", null, "EMPTY-STATE");

describe("charts draw only real data", () => {
  it("bars: all zeros show the empty state, never a flat chart", () => {
    const html = render(h(BarChart, { periods: ["2026-10-01", "2026-10-02"], series: [{ name: "Visits", tone: 1, values: [0, 0] }], label: "x", empty: EMPTY }));
    expect(html).toContain("EMPTY-STATE");
    expect(html).not.toContain("chart-bars");
  });

  it("bars: one bar per period, height from the value, and the numbers table lists only real values", () => {
    const html = render(h(BarChart, { periods: ["2026-10-01", "2026-10-02", "2026-10-03"], series: [{ name: "Visits", tone: 1, values: [4, 0, 2] }], label: "x", empty: EMPTY }));
    expect(html.match(/class="bar s1"/g)).toHaveLength(3);
    expect(html).toContain("height:100%");
    expect(html).toContain("height:50%");
    expect(html.match(/<tr>/g)).toHaveLength(3); // header + 2 non-zero days
  });

  it("line: fewer than two points is the empty state", () => {
    const html = render(h(LineChart, { points: [{ at: "2026-10-01T00:00:00Z", value: 3 }], label: "x", valueLabel: () => "", seriesName: "Issues", empty: EMPTY }));
    expect(html).toContain("EMPTY-STATE");
  });

  it("dates follow the reader's language with Latin digits", () => {
    const html = render(h(LineChart, { points: [{ at: "2026-10-01T00:00:00Z", value: 3 }, { at: "2026-10-20T00:00:00Z", value: 1 }], label: "x", valueLabel: () => "", seriesName: "Issues", empty: EMPTY }), "ar");
    expect(html).toContain("أكتوبر");
    expect(html).toMatch(/\b20\b/);
  });
});
