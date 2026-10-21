import { describe, expect, it } from "vitest";
import { findingState, resolvedKeys, scanDeltas } from "./history";

describe("history", () => {
  const previous = new Set(["a", "b"]);
  const ever = new Set(["a", "b", "c"]);

  it("labels findings against earlier scans", () => {
    expect(findingState("a", previous, ever)).toBe("ongoing");
    expect(findingState("c", previous, ever)).toBe("recurred");
    expect(findingState("d", previous, ever)).toBe("new");
    expect(findingState("a", new Set(), new Set())).toBe("new");
  });

  it("lists resolved keys", () => {
    expect(resolvedKeys(new Set(["a", "d"]), previous)).toEqual(["b"]);
  });

  it("tracks resolved and recurred findings across scans", () => {
    const deltas = scanDeltas([
      { id: "s1", keys: ["price:1", "image:2"] },
      { id: "s2", keys: ["price:1"] }, // image:2 fixed
      { id: "s3", keys: ["price:1", "image:2", "weight:3"] }, // image:2 back
    ]);
    expect(deltas).toEqual([
      { scanId: "s1", new: 2, ongoing: 0, recurred: 0, resolved: 0 },
      { scanId: "s2", new: 0, ongoing: 1, recurred: 0, resolved: 1 },
      { scanId: "s3", new: 1, ongoing: 1, recurred: 1, resolved: 0 },
    ]);
  });
});
