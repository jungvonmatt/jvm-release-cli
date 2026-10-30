import { describe, expect, test } from "vite-plus/test";
import { parseReleaseTarget } from "../src/ui.ts";

describe("parseReleaseTarget", () => {
  test("accepts test and production", () => {
    expect(parseReleaseTarget("test")).toBe("test");
    expect(parseReleaseTarget("production")).toBe("production");
  });

  test("returns undefined without a target", () => {
    expect(parseReleaseTarget(undefined)).toBeUndefined();
    expect(parseReleaseTarget("")).toBeUndefined();
  });

  test("rejects an unknown target instead of releasing to production", () => {
    expect(() => parseReleaseTarget("prod")).toThrow('Unknown release target "prod"');
  });

  test("points to the flag order when init comes after a flag", () => {
    expect(() => parseReleaseTarget("init")).toThrow("jvm-release init --cwd");
  });
});
