import { describe, expect, it } from "vitest";
import { detectHosting, hostingFinding, nsCandidates, providersIn } from "./hosting";

// matha.site, 2026-10-27: the home page answer's headers (GPTBot got HTTP 429 with the same headers).
const MATHA = { date: "Tue, 27 Oct 2026 20:43:03 GMT", panel: "hpanel", server: "LiteSpeed", platform: "hostinger", "x-powered-by": "PHP/8.3.36" };

describe("hosting guide (F5)", () => {
  it("matha.site: Hostinger and LiteSpeed, from the headers", () => {
    const d = detectHosting({ headers: MATHA, nameservers: [], plugins: [{ name: "WooCommerce", plugin: "woocommerce/woocommerce.php" }] });
    expect(d).toEqual([
      { id: "hostinger", name: "Hostinger", signal: "header platform: hostinger" },
      { id: "litespeed", name: "LiteSpeed", signal: "header server: LiteSpeed" },
    ]);
    const f = hostingFinding("https://matha.site", d)!;
    expect(f).toMatchObject({ finding_key: "hosting:detected", basis: "heuristic", title: "Hosting and protection detected: Hostinger, LiteSpeed (information only)" });
    expect(providersIn(f.evidence)).toEqual(["hostinger", "litespeed"]);
  });

  it("Cloudflare by header or nameserver, Wordfence by its plugin, nothing from a plain server", () => {
    expect(detectHosting({ headers: { "CF-RAY": "8a1b-CDG" }, nameservers: [], plugins: [] }).map((d) => d.id)).toEqual(["cloudflare"]);
    expect(detectHosting({ headers: {}, nameservers: ["ada.ns.cloudflare.com"], plugins: [{ name: "Wordfence Security", plugin: "wordfence/wordfence.php" }] }).map((d) => [d.id, d.signal])).toEqual([
      ["cloudflare", "nameserver ada.ns.cloudflare.com"],
      ["wordfence", "active plugin Wordfence Security"],
    ]);
    expect(detectHosting({ headers: { server: "nginx" }, nameservers: ["ns1.example-dns.net"], plugins: [] })).toEqual([]);
    expect(hostingFinding("https://x.test", [])).toBeNull();
  });

  it("nameservers are looked up on the host, then its parent domains", () => {
    expect(nsCandidates("www.shop.example.co")).toEqual(["www.shop.example.co", "shop.example.co", "example.co"]);
    expect(nsCandidates("matha.site")).toEqual(["matha.site"]);
  });
});
