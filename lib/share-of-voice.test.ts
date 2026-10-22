import { describe, expect, it } from "vitest";
import { shareOfVoice, storePosition } from "./share-of-voice";

describe("share of voice", () => {
  const rows = [
    { run_id: "r", mentioned: true, competitors: ["Etsy", "Amazon"], answered: true },
    { run_id: "r", mentioned: false, competitors: ["Etsy", "etsy.com", "Jumia"], answered: true },
    { run_id: "r", mentioned: false, competitors: ["Etsy"], answered: true },
    { run_id: "r", mentioned: null, competitors: [], answered: false },
  ];

  it("counts each name once per question, errors apart", () => {
    const s = shareOfVoice("Matha", "r", "2026-10-22", rows);
    expect(s.answered).toBe(3);
    expect(s.unavailable).toBe(1);
    expect(s.entries.map((e) => [e.name, e.questions])).toEqual([["Etsy", 3], ["Matha", 1], ["Amazon", 1], ["Jumia", 1]]);
    expect(storePosition(s)).toBe(2);
  });

  it("not named → no position", () => {
    const s = shareOfVoice("Matha", "r", "d", rows.map((r) => ({ ...r, mentioned: false })));
    expect(storePosition(s)).toBeNull();
    expect(s.entries.find((e) => e.isStore)?.questions).toBe(0);
  });
});
