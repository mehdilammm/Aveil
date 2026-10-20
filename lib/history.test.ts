import { describe, expect, it } from "vitest";
import { findingState, resolvedKeys } from "./history";

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
});
