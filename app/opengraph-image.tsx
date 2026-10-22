import { ImageResponse } from "next/og";
import { SITE } from "@/lib/site";

export const alt = `${SITE.name}: AI shopping agent readiness for WooCommerce`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#0d3b2e", color: "#e8f3ee", padding: 72, fontFamily: "sans-serif" }}>
        <div style={{ fontSize: 36, fontWeight: 700, color: "#ffffff" }}>{SITE.name}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.1, color: "#ffffff" }}>{SITE.tagline}</div>
          <div style={{ fontSize: 30, color: "#a7d7c2" }}>Readiness checks, AI visibility and verified fixes for WooCommerce stores</div>
        </div>
        <div style={{ display: "flex", width: 160, height: 10, background: "#059669", borderRadius: 5 }} />
      </div>
    ),
    size,
  );
}
