import { describe, expect, test } from "vite-plus/test";
import { inferTicketPattern } from "../src/init/detect.ts";

describe("inferTicketPattern", () => {
  test("joins frequent project keys in alphabetical order", () => {
    expect(inferTicketPattern("SFA-3 a\nLEV-1 b\nLEV-2 c\nSFA-4 d")).toBe("((LEV|SFA)-\\d+)");
  });

  test("uses one group for a single key", () => {
    expect(inferTicketPattern("LEV-1\nLEV-2")).toBe("(LEV-\\d+)");
  });

  test("drops keys seen only once", () => {
    expect(inferTicketPattern("LEV-1 LEV-2 ABC-1")).toBe("(LEV-\\d+)");
  });

  test("ignores encodings and standards", () => {
    expect(inferTicketPattern("UTF-8 UTF-8 ISO-8859 ISO-8859 RFC-2119 RFC-2119")).toBeNull();
  });

  test("finds keys in branch names", () => {
    const log = "Merge branch 'feature/LEV-658_foo'\nMerge branch 'feature/LEV-12-bar'";
    expect(inferTicketPattern(log)).toBe("(LEV-\\d+)");
  });

  test("keeps the five most frequent keys", () => {
    const log = ["AA", "BB", "CC", "DD", "EE"]
      .flatMap((key) => [`${key}-1`, `${key}-2`, `${key}-3`])
      .concat(["FF-1", "FF-2"])
      .join("\n");
    expect(inferTicketPattern(log)).toBe("((AA|BB|CC|DD|EE)-\\d+)");
  });

  test("captures the whole key in group 1", () => {
    const pattern = inferTicketPattern("LEV-1 SFA-2 LEV-3 SFA-4")!;
    expect(new RegExp(pattern).exec("see SFA-42 now")?.[1]).toBe("SFA-42");
  });

  test("returns null without keys", () => {
    expect(inferTicketPattern("")).toBeNull();
  });
});
