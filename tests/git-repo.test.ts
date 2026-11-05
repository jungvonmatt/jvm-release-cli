// Runs the git helpers against a real repository, because the exact git behavior matters here:
// `git check-ignore` does not report tracked files, even when `.gitignore` lists them.
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deleteTemporaryBranch,
  getCurrentBranch,
  getLatestTag,
  isGitIgnored,
  isGitTracked,
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
