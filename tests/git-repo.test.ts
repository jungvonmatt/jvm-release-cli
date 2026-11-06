// Runs the git helpers against a real repository, because the exact git behavior matters here:
// `git check-ignore` does not report tracked files, even when `.gitignore` lists them.
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deleteTemporaryBranch,
  getCurrentBranch,
  getLatestTag,
  isGitIgnored,
  isGitTracked,
  pushRelease,
  recordReleaseStart,
  undoRelease,
  verifyFullHistory,
  verifyGitIdentity,
  verifyOriginCanPush,
} from "../src/git.ts";

const originalCwd = process.cwd();
let dir: string;

// Signing settings from the global git config would make `git tag` ask for a message
const GIT_CONFIG = [
  "user.name=test",
  "user.email=test@test",
  "commit.gpgSign=false",
  "tag.gpgSign=false",
];

const git = (...args: string[]) =>
  execFileSync("git", [...GIT_CONFIG.flatMap((entry) => ["-c", entry]), ...args], {
    cwd: dir,
    stdio: "ignore",
  });

const gitOutput = (...args: string[]) =>
  execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "release-cli-"));
  git("init", "-q");
  process.chdir(dir);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(dir, { recursive: true, force: true });
});

describe("a committed .env", () => {
  beforeEach(async () => {
    await writeFile(join(dir, ".env"), "FOO=1\n");
    git("add", ".env");
    git("commit", "-q", "-m", "add .env");
    await writeFile(join(dir, ".gitignore"), ".env\n");
  });

  test("is tracked", async () => {
    expect(await isGitTracked(".env")).toBe(true);
  });

  test("is not reported as ignored, even when .gitignore lists it", async () => {
    expect(await isGitIgnored(".env")).toBe(false);
  });
});

describe("an untracked .env", () => {
  test("is not tracked", async () => {
    await writeFile(join(dir, ".env"), "FOO=1\n");
    expect(await isGitTracked(".env")).toBe(false);
  });

  test("is ignored when .gitignore lists it", async () => {
    await writeFile(join(dir, ".gitignore"), ".env\n");
    expect(await isGitIgnored(".env")).toBe(true);
  });
});

describe("deleteTemporaryBranch", () => {
  beforeEach(async () => {
    git("symbolic-ref", "HEAD", "refs/heads/main");
    await writeFile(join(dir, "package.json"), '{ "version": "1.0.0" }\n');
    git("add", "package.json");
    git("commit", "-q", "-m", "init");
    git("switch", "-q", "-c", "release/tmp-v1.1.0");
  });

  test("returns to the given branch when a failed bump left HEAD on the temporary branch", async () => {
    await writeFile(join(dir, "package.json"), '{ "version": "1.1.0" }\n');

    await deleteTemporaryBranch("release/tmp-v1.1.0", "main");

    expect(await getCurrentBranch()).toBe("main");
    expect(gitOutput("branch", "--list", "release/tmp-v1.1.0")).toBe("");
    expect(gitOutput("status", "--porcelain")).toBe("");
  });

  test("stays on the current branch when HEAD already left the temporary branch", async () => {
    git("switch", "-q", "-c", "develop", "main");

    await deleteTemporaryBranch("release/tmp-v1.1.0", "main");

    expect(await getCurrentBranch()).toBe("develop");
    expect(gitOutput("branch", "--list", "release/tmp-v1.1.0")).toBe("");
  });
});

describe("getLatestTag", () => {
  // git's version sort puts `v1.1.0-pre.0` above `v1.1.0`
  test("ranks a release above its prerelease", async () => {
    git("commit", "-q", "--allow-empty", "-m", "init");
    git("tag", "v1.1.0-pre.0");
    git("tag", "v1.1.0");

    expect(await getLatestTag()).toBe("v1.1.0");
  });
});

describe("undoRelease", () => {
  const head = (ref = "HEAD") => gitOutput("rev-parse", ref);
  const packageVersion = async () =>
    (JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as { version: string }).version;

  beforeEach(async () => {
    git("symbolic-ref", "HEAD", "refs/heads/main");
    await writeFile(join(dir, "package.json"), '{ "version": "0.1.0" }\n');
    git("add", "package.json");
    git("commit", "-q", "-m", "init");
    await writeFile(join(dir, "a.txt"), "a\n");
    git("add", "a.txt");
    git("commit", "-q", "-m", "PROJ-1 add a");
  });

  test("keeps the last commit when the failed release made no commit", async () => {
    const before = head();
    const start = await recordReleaseStart("main", "v0.1.0");

    await undoRelease(start, "v0.1.0");

    expect(head()).toBe(before);
    expect(gitOutput("log", "--format=%s", "-1")).toBe("PROJ-1 add a");
  });

  test("discards a bump that failed before its commit", async () => {
    const before = head();
    const start = await recordReleaseStart("main", "v0.2.0");
    await writeFile(join(dir, "package.json"), '{ "version": "0.2.0" }\n');

    await undoRelease(start, "v0.2.0");

    expect(head()).toBe(before);
    expect(gitOutput("status", "--porcelain")).toBe("");
    expect(await packageVersion()).toBe("0.1.0");
  });

  test("removes the bump commit and the tag of the release", async () => {
    const before = head();
    const start = await recordReleaseStart("main", "v0.2.0");
    await writeFile(join(dir, "package.json"), '{ "version": "0.2.0" }\n');
    git("commit", "-q", "-am", "0.2.0");
    git("tag", "v0.2.0");

    await undoRelease(start, "v0.2.0");

    expect(head()).toBe(before);
    expect(gitOutput("tag", "--list")).toBe("");
    expect(gitOutput("log", "--format=%s")).not.toContain("0.2.0");
    expect(await packageVersion()).toBe("0.1.0");
  });

  test("keeps a tag that existed before the release", async () => {
    git("tag", "v0.2.0");
    const start = await recordReleaseStart("main", "v0.2.0");

    await undoRelease(start, "v0.2.0");

    expect(gitOutput("tag", "--list")).toBe("v0.2.0");
  });

  test("resets the release branch when the release started on another branch", async () => {
    git("branch", "integration");
    const before = head("integration");
    const start = await recordReleaseStart("integration", "v0.2.0");
    // a promotion merges the bump into the release branch, then switches back
    git("switch", "-q", "integration");
    git("commit", "-q", "--allow-empty", "-m", "Merge release v0.2.0");
    git("switch", "-q", "main");

    await undoRelease(start, "v0.2.0");

    expect(head("integration")).toBe(before);
    expect(await getCurrentBranch()).toBe("main");
  });

  test("ignores a release branch that does not exist", async () => {
    const start = await recordReleaseStart("does-not-exist", "v0.2.0");

    expect(Object.keys(start.heads)).toEqual(["main"]);
  });
});

describe("pushRelease", () => {
  let origin: string;
  const onOrigin = (...args: string[]) => gitOutput(`--git-dir=${origin}`, ...args);

  beforeEach(async () => {
    origin = await mkdtemp(join(tmpdir(), "release-cli-origin-"));
    git("init", "-q", "--bare", origin);
    git("symbolic-ref", "HEAD", "refs/heads/main");
    git("commit", "-q", "--allow-empty", "-m", "init");
    git("remote", "add", "origin", origin);
    git("push", "-q", "origin", "main");
    git("commit", "-q", "--allow-empty", "-m", "0.2.0");
    git("tag", "v0.2.0");
  });

  afterEach(async () => {
    await rm(origin, { recursive: true, force: true });
  });

  test("pushes the version commit and the tag", async () => {
    await pushRelease("v0.2.0");

    expect(onOrigin("log", "--format=%s", "-1", "main")).toBe("0.2.0");
    expect(onOrigin("tag", "--list")).toBe("v0.2.0");
  });

  test("pushes no version commit when origin rejects the tag", async () => {
    // origin already has a different v0.2.0
    git(`--git-dir=${origin}`, "tag", "v0.2.0", "main");

    await expect(pushRelease("v0.2.0")).rejects.toThrow();

    expect(onOrigin("log", "--format=%s", "-1", "main")).toBe("init");
  });

  test("pushes no tag when origin rejects the branch", async () => {
    // someone else pushed to main in the meantime
    git("switch", "-q", "-c", "other", "HEAD~1");
    git("commit", "-q", "--allow-empty", "-m", "other");
    git("push", "-q", "origin", "other:main");
    git("switch", "-q", "main");

    await expect(pushRelease("v0.2.0")).rejects.toThrow();

    expect(onOrigin("log", "--format=%s", "-1", "main")).toBe("other");
    expect(onOrigin("tag", "--list")).toBe("");
  });
});

// GitLab CI checks out a detached commit in a shallow clone, with no git user and an origin URL
// that carries the job token
describe("a CI checkout", () => {
  beforeEach(() => {
    git("symbolic-ref", "HEAD", "refs/heads/main");
    git("commit", "-q", "--allow-empty", "-m", "init");
    git("commit", "-q", "--allow-empty", "-m", "PROJ-1 add basket");
  });

  test("names the checkout command on a detached HEAD", async () => {
    git("checkout", "-q", "--detach");

    await expect(getCurrentBranch()).rejects.toThrow("HEAD is detached");
    await expect(getCurrentBranch()).rejects.toThrow("git checkout -B");
  });

  test("passes with the full history", async () => {
    await expect(verifyFullHistory()).resolves.toBeUndefined();
  });

  test("stops in a shallow clone", async () => {
    const clone = await mkdtemp(join(tmpdir(), "release-cli-shallow-"));
    try {
      execFileSync("git", ["clone", "-q", "--depth=1", `file://${dir}`, clone]);
      process.chdir(clone);

      await expect(verifyFullHistory()).rejects.toThrow("GIT_DEPTH: 0");
    } finally {
      process.chdir(dir);
      await rm(clone, { recursive: true, force: true });
    }
  });

  test("passes with a git user", async () => {
    git("config", "user.name", "Release Bot");
    git("config", "user.email", "release-bot@example.com");

    await expect(verifyGitIdentity()).resolves.toBeUndefined();
  });

  test("stops without a git user", async () => {
    // Ignore the developer's global git user, and do not guess one from the host name
    vi.stubEnv("GIT_CONFIG_GLOBAL", join(dir, "no-global-config"));
    vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
    git("config", "user.useConfigOnly", "true");
    try {
      await expect(verifyGitIdentity()).rejects.toThrow("No git user");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test("stops when origin uses the CI job token", async () => {
    git("remote", "add", "origin", "https://gitlab-ci-token:abc@gitlab.com/acme/shop.git");

    await expect(verifyOriginCanPush()).rejects.toThrow("CI job token");
  });

  test("passes when origin uses a token that can push", async () => {
    git("remote", "add", "origin", "https://release-bot:glpat-x@gitlab.com/acme/shop.git");

    await expect(verifyOriginCanPush()).resolves.toBeUndefined();
  });
});
