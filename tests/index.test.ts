import { expect, test } from "vite-plus/test";
import Version from "../src/version.ts";

test("Version - creates version from string", () => {
  const v = new Version("1.2.3");
  expect(v.toString()).toBe("v1.2.3");
});

test("Version - increments minor", () => {
  const v = new Version("1.2.3", "minor");
  expect(v.toString()).toBe("v1.3.0");
});

test("Version - increments prerelease", () => {
  const v = new Version("1.2.3-pre.0", "prerelease");
  expect(v.toString()).toBe("v1.2.3-pre.1");
});

test("Version - increments preminor", () => {
  const v = new Version("1.2.3", "preminor");
  expect(v.toString()).toBe("v1.3.0-pre.0");
});

test("Version - throws on invalid version", () => {
  expect(() => new Version("not-a-version")).toThrow("should be a valid SemVer version");
});

test("Version - isPrerelease", () => {
  const pre = new Version("1.2.3-pre.0");
  expect(pre.isPrerelease()).toBe(true);

  const release = new Version("1.2.3");
  expect(release.isPrerelease()).toBe(false);
});

test("Version - satisfies range", () => {
  const v = new Version("1.2.3");
  expect(v.satisfies(">=1.0.0")).toBe(true);
  expect(v.satisfies(">=2.0.0")).toBe(false);
});

test("Version - setFrom with increment", () => {
  const v = new Version("1.2.3");
  v.setFrom("patch");
  expect(v.toString()).toBe("v1.2.4");
});

test("Version - setFrom throws on lower version", () => {
  const v = new Version("2.0.0");
  expect(() => v.setFrom("1.0.0")).toThrow("should be higher than current version");
});
