import { describe, expect, test } from "vite-plus/test";
import { getNextVersions, parseReleaseTarget } from "../src/ui.ts";

describe("parseReleaseTarget", () => {
  test("accepts prerelease and production", () => {
    expect(parseReleaseTarget("prerelease")).toBe("prerelease");
    expect(parseReleaseTarget("production")).toBe("production");
  });

  test("accepts test as the old name of prerelease", () => {
    expect(parseReleaseTarget("test")).toBe("prerelease");
  });

  test("returns undefined without a target", () => {
    expect(parseReleaseTarget(undefined)).toBeUndefined();
    expect(parseReleaseTarget("")).toBeUndefined();
  });

  test("rejects an unknown target instead of releasing to production", () => {
    expect(() => parseReleaseTarget("prod")).toThrow(
      'Unknown release target "prod". Use "prerelease" or "production".',
    );
  });

  test("points to the flag order when init comes after a flag", () => {
    expect(() => parseReleaseTarget("init")).toThrow("jvm-release init --cwd");
  });
});

describe("getNextVersions", () => {
  const next = (latestTag: string, latestReleaseTag: string) => {
    const { prerelease, release, promotedTag } = getNextVersions(latestTag, latestReleaseTag);
    return { prerelease: prerelease.toString(), release: release.toString(), promotedTag };
  };

  test("starts at 0.1.0 and releases the branch tip when there are no tags", () => {
    expect(next("v0.0.0", "v0.0.0")).toEqual({
      prerelease: "v0.1.0-pre.0",
      release: "v0.1.0",
      promotedTag: null,
    });
  });

  test("promotes a pending prerelease", () => {
    expect(next("v1.1.0-pre.2", "v1.0.0")).toEqual({
      prerelease: "v1.1.0-pre.3",
      release: "v1.1.0",
      promotedTag: "v1.1.0-pre.2",
    });
  });

  test("releases the branch tip when no prerelease is newer than the last release", () => {
    expect(next("v1.1.0", "v1.1.0")).toEqual({
      prerelease: "v1.2.0-pre.0",
      release: "v1.2.0",
      promotedTag: null,
    });
  });
});
