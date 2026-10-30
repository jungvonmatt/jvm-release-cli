import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findExistingConfig, inferTicketPattern, isCliLoggedIn } from "../src/init/detect.ts";

// Mock child_process: `execFile` runs gh/glab
const execFileMock = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: any[]) => execFileMock(...args),
}));

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

describe("findExistingConfig", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "release-cli-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("returns null for an empty directory", async () => {
    expect(await findExistingConfig(dir)).toBeNull();
  });

  test.each([
    ".release-clirc",
    ".release-clirc.json",
    ".release-clirc.yaml",
    "release-cli.config.ts",
    "release-cli.config.mjs",
  ])("finds %s", async (name) => {
    await writeFile(join(dir, name), "");
    expect(await findExistingConfig(dir)).toBe(name);
  });

  test("finds the release-cli key in package.json", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ "release-cli": {} }));
    expect(await findExistingConfig(dir)).toBe("package.json");
  });

  test("ignores a package.json without the key", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "x" }));
    expect(await findExistingConfig(dir)).toBeNull();
  });

  test("ignores a malformed package.json", async () => {
    await writeFile(join(dir, "package.json"), "{ not json");
    expect(await findExistingConfig(dir)).toBeNull();
  });
});

describe("isCliLoggedIn", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("checks the login for the host", async () => {
    execFileMock.mockImplementation((...args: any[]) => {
      const cb = args.at(-1) as Function;
      cb(null, { stdout: "", stderr: "Logged in to github.com" });
    });
    expect(await isCliLoggedIn("gh", "github.com")).toBe(true);
    expect(execFileMock.mock.calls[0]!.slice(0, 2)).toEqual([
      "gh",
      ["auth", "status", "--hostname", "github.com"],
    ]);
  });

  test("is false when the command is missing or not logged in", async () => {
    execFileMock.mockImplementation((...args: any[]) => {
      const cb = args.at(-1) as Function;
      cb(Object.assign(new Error("spawn glab ENOENT"), { code: "ENOENT" }));
    });
    expect(await isCliLoggedIn("glab", "gitlab.com")).toBe(false);
  });
});
