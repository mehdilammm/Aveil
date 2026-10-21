import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv";

describe("csv", () => {
  it("neutralizes formula injection", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\tcmd")).toBe("'\tcmd");
    expect(csvCell("\rcmd")).toBe(`"'\rcmd"`);
  });

  it("quotes commas, quotes and new lines and keeps plain text", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell("Price missing")).toBe("Price missing");
    expect(csvCell(null)).toBe("");
    expect(csvCell(42)).toBe("42");
  });

  it("builds rows", () => {
    expect(toCsv(["a", "b"], [[1, "=x"]])).toBe("a,b\r\n1,'=x\r\n");
  });
});
