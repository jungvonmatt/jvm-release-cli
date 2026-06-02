import { describe, expect, test } from "vite-plus/test";
import Version, { SEMVER_INCREMENTS } from "../src/version.ts";

describe("Version - constructor", () => {
  test("creates version from string", () => {
    expect(new Version("1.2.3").toString()).toBe("v1.2.3");
  });

  test("creates version from string with leading v", () => {
    // semver.parse strips "v" prefix
    expect(new Version("1.0.0").toString()).toBe("v1.0.0");
  });

  test("creates version with prerelease components", () => {
    expect(new Version("1.2.3-beta.1").toString()).toBe("v1.2.3-beta.1");
  });

  test("creates version with build metadata", () => {
    expect(new Version("1.2.3+build.123").toString()).toBe("v1.2.3");
  });

  test("throws on invalid version string", () => {
    expect(() => new Version("not-a-version")).toThrow("should be a valid SemVer version");
    expect(() => new Version("")).toThrow("should be a valid SemVer version");
    expect(() => new Version("1.2")).toThrow("should be a valid SemVer version");
    expect(() => new Version("abc.def.ghi")).toThrow("should be a valid SemVer version");
  });

  test("creates version with increment", () => {
    expect(new Version("1.2.3", "patch").toString()).toBe("v1.2.4");
    expect(new Version("1.2.3", "minor").toString()).toBe("v1.3.0");
    expect(new Version("1.2.3", "major").toString()).toBe("v2.0.0");
  });

  test("creates version with prerelease increments", () => {
    expect(new Version("1.2.3", "prepatch").toString()).toBe("v1.2.4-pre.0");
    expect(new Version("1.2.3", "preminor").toString()).toBe("v1.3.0-pre.0");
    expect(new Version("1.2.3", "premajor").toString()).toBe("v2.0.0-pre.0");
    expect(new Version("1.2.3-pre.0", "prerelease").toString()).toBe("v1.2.3-pre.1");
  });

  test("custom prereleasePrefix", () => {
    expect(new Version("1.2.3", "preminor", { prereleasePrefix: "alpha" }).toString()).toBe(
      "v1.3.0-alpha.0",
    );
    expect(new Version("1.2.3", "prepatch", { prereleasePrefix: "rc" }).toString()).toBe(
      "v1.2.4-rc.0",
    );
  });

  test("throws on invalid increment", () => {
    expect(() => new Version("1.2.3", "invalid" as any)).toThrow("should be one of");
  });
});

describe("Version - setFrom", () => {
  test("sets from increment type", () => {
    const v = new Version("1.2.3");
    v.setFrom("patch");
    expect(v.toString()).toBe("v1.2.4");
  });

  test("sets from minor increment", () => {
    const v = new Version("1.2.3");
    v.setFrom("minor");
    expect(v.toString()).toBe("v1.3.0");
  });

  test("sets from major increment", () => {
    const v = new Version("1.2.3");
    v.setFrom("major");
    expect(v.toString()).toBe("v2.0.0");
  });

  test("sets from prerelease increment", () => {
    const v = new Version("1.2.3-pre.0");
    v.setFrom("prerelease");
    expect(v.toString()).toBe("v1.2.3-pre.1");
  });

  test("sets from explicit higher version", () => {
    const v = new Version("1.2.3");
    v.setFrom("3.0.0");
    expect(v.toString()).toBe("v3.0.0");
  });

  test("throws on lower version", () => {
    const v = new Version("2.0.0");
    expect(() => v.setFrom("1.0.0")).toThrow("should be higher than current version");
  });

  test("throws on equal version", () => {
    const v = new Version("2.0.0");
    expect(() => v.setFrom("2.0.0")).toThrow("should be higher than current version");
  });

  test("throws on invalid version string", () => {
    const v = new Version("1.2.3");
    expect(() => v.setFrom("not-valid")).toThrow("should either be one of");
  });

  test("is chainable", () => {
    const v = new Version("1.0.0");
    const result = v.setFrom("patch");
    expect(result).toBe(v);
    expect(v.toString()).toBe("v1.0.1");
  });

  test("sets from prerelease increment with custom prefix", () => {
    const v = new Version("1.2.3", undefined, { prereleasePrefix: "beta" });
    v.setFrom("preminor");
    expect(v.toString()).toBe("v1.3.0-beta.0");
  });
});

describe("Version - isPrerelease", () => {
  test("returns true for prerelease versions", () => {
    expect(new Version("1.2.3-pre.0").isPrerelease()).toBe(true);
    expect(new Version("1.2.3-alpha.1").isPrerelease()).toBe(true);
    expect(new Version("1.0.0-0").isPrerelease()).toBe(true);
  });

  test("returns false for release versions", () => {
    expect(new Version("1.2.3").isPrerelease()).toBe(false);
    expect(new Version("0.0.1").isPrerelease()).toBe(false);
  });
});

describe("Version - satisfies", () => {
  test("satisfies matching range", () => {
    const v = new Version("1.2.3");
    expect(v.satisfies(">=1.0.0")).toBe(true);
    expect(v.satisfies("^1.0.0")).toBe(true);
    expect(v.satisfies("~1.2.0")).toBe(true);
    expect(v.satisfies("1.x")).toBe(true);
  });

  test("does not satisfy non-matching range", () => {
    const v = new Version("1.2.3");
    expect(v.satisfies(">=2.0.0")).toBe(false);
    expect(v.satisfies("^2.0.0")).toBe(false);
    expect(v.satisfies("<1.0.0")).toBe(false);
  });

  test("includes prereleases in range check", () => {
    const v = new Version("1.2.3-pre.0");
    expect(v.satisfies(">=1.2.3-pre.0")).toBe(true);
    expect(v.satisfies(">=1.2.3")).toBe(false);
  });

  test("throws on invalid range", () => {
    const v = new Version("1.2.3");
    expect(() => v.satisfies("not a range &&& |||")).toThrow("not a valid SemVer range");
  });
});

describe("Version - format", () => {
  test("formats with diff coloring for patch", () => {
    const v = new Version("1.2.3", "patch");
    const formatted = v.format();
    // Should contain the version numbers (stripped of ANSI for content check)
    expect(formatted).toBeTruthy();
    expect(formatted.length).toBeGreaterThan(0);
  });

  test("formats with diff coloring for minor", () => {
    const v = new Version("1.2.3", "minor");
    const formatted = v.format();
    expect(formatted).toBeTruthy();
  });

  test("formats with diff coloring for major", () => {
    const v = new Version("1.2.3", "major");
    const formatted = v.format();
    expect(formatted).toBeTruthy();
  });

  test("formats prerelease versions", () => {
    const v = new Version("1.2.3", "preminor");
    const formatted = v.format();
    expect(formatted).toBeTruthy();
  });

  test("formats with custom color options", () => {
    const v = new Version("1.2.3", "patch");
    const formatted = v.format({ color: "red", diffColor: "green" });
    expect(formatted).toBeTruthy();
  });

  test("formats with previousVersion string", () => {
    const v = new Version("2.0.0");
    const formatted = v.format({ previousVersion: "1.0.0" });
    expect(formatted).toBeTruthy();
  });

  test("throws with invalid previousVersion", () => {
    const v = new Version("2.0.0");
    expect(() => v.format({ previousVersion: "invalid" })).toThrow(
      "should be a valid SemVer version",
    );
  });

  test("returns plain version when no diff", () => {
    const v = new Version("1.2.3");
    const formatted = v.format();
    expect(formatted).toContain("1.2.3");
  });

  test("formats prepatch diff", () => {
    const v = new Version("1.2.3", "prepatch");
    const formatted = v.format();
    expect(formatted).toBeTruthy();
  });

  test("formats premajor diff", () => {
    const v = new Version("1.2.3", "premajor");
    const formatted = v.format();
    expect(formatted).toBeTruthy();
  });

  test("formats prerelease diff with previousVersion having prerelease", () => {
    const v = new Version("1.2.3-pre.1");
    const formatted = v.format({ previousVersion: "1.2.3-pre.0" });
    expect(formatted).toBeTruthy();
  });
});

describe("SEMVER_INCREMENTS", () => {
  test("contains all expected increment types", () => {
    expect(SEMVER_INCREMENTS).toContain("patch");
    expect(SEMVER_INCREMENTS).toContain("minor");
    expect(SEMVER_INCREMENTS).toContain("major");
    expect(SEMVER_INCREMENTS).toContain("prepatch");
    expect(SEMVER_INCREMENTS).toContain("preminor");
    expect(SEMVER_INCREMENTS).toContain("premajor");
    expect(SEMVER_INCREMENTS).toContain("prerelease");
    expect(SEMVER_INCREMENTS).toHaveLength(7);
  });
});
