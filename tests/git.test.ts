import { describe, expect, test, vi, beforeEach } from "vite-plus/test";
import { resolve } from "node:path";

// Mock child_process.exec
const execMock = vi.fn();
vi.mock("node:child_process", () => ({
  exec: (...args: any[]) => execMock(...args),
}));

// Mock fs/promises
const readFileMock = vi.fn();
vi.mock("node:fs/promises", () => ({
  readFile: (...args: any[]) => readFileMock(...args),
}));

// Helper to make execMock resolve with stdout
function mockExec(stdout: string, stderr = "") {
  execMock.mockImplementation((_cmd: string, cb: Function) => {
    cb(null, { stdout, stderr });
  });
}

function mockExecSequence(results: Array<{ stdout?: string; stderr?: string; error?: Error }>) {
  let callIndex = 0;
  execMock.mockImplementation((_cmd: string, cb: Function) => {
    const result = results[callIndex++];
    if (result?.error) {
      cb(result.error, { stdout: "", stderr: "" });
    } else {
      cb(null, { stdout: result?.stdout ?? "", stderr: result?.stderr ?? "" });
    }
  });
}

function mockExecError(error: Error) {
  execMock.mockImplementation((_cmd: string, cb: Function) => {
    cb(error, { stdout: "", stderr: "" });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getCurrentBranch", () => {
  test("returns trimmed branch name", async () => {
    mockExec("main\n");
    const { getCurrentBranch } = await import("../src/git.ts");
    const branch = await getCurrentBranch();
    expect(branch).toBe("main");
  });

  test("handles feature branch", async () => {
    mockExec("feature/my-feature\n");
    const { getCurrentBranch } = await import("../src/git.ts");
    const branch = await getCurrentBranch();
    expect(branch).toBe("feature/my-feature");
  });
});

describe("verifyCurrentBranchIsReleaseBranch", () => {
  test("passes when on the configured release branch", async () => {
    mockExecSequence([
      { stdout: "main\n" }, // getCurrentBranch
      { stdout: "origin/main\n" }, // getDefaultBranch - strategy 1
    ]);
    const { verifyCurrentBranchIsReleaseBranch } = await import("../src/git.ts");
    await expect(verifyCurrentBranchIsReleaseBranch("main")).resolves.toBeUndefined();
  });

  test("passes when on a release/ branch", async () => {
    mockExecSequence([
      { stdout: "release/v1.0.0\n" }, // getCurrentBranch
      { stdout: "origin/main\n" }, // getDefaultBranch - strategy 1
    ]);
    const { verifyCurrentBranchIsReleaseBranch } = await import("../src/git.ts");
    await expect(verifyCurrentBranchIsReleaseBranch("main")).resolves.toBeUndefined();
  });

  test("passes when on a hotfix/ branch", async () => {
    mockExecSequence([
      { stdout: "hotfix/urgent-fix\n" }, // getCurrentBranch
      { stdout: "origin/main\n" }, // getDefaultBranch - strategy 1
    ]);
    const { verifyCurrentBranchIsReleaseBranch } = await import("../src/git.ts");
    await expect(verifyCurrentBranchIsReleaseBranch("main")).resolves.toBeUndefined();
  });

  test("throws when on wrong branch", async () => {
    mockExecSequence([
      { stdout: "feature/something\n" }, // getCurrentBranch
      { error: new Error("not set") }, // getDefaultBranch - strategy 1 fails
      { error: new Error("failed") }, // getDefaultBranch - strategy 2 fails
      { error: new Error("no branch") }, // getDefaultBranch - strategy 3 main
      { error: new Error("no branch") }, // getDefaultBranch - strategy 3 master
    ]);
    const { verifyCurrentBranchIsReleaseBranch } = await import("../src/git.ts");
    await expect(verifyCurrentBranchIsReleaseBranch("main")).rejects.toThrow(
      "Not on `main` branch",
    );
  });
});

describe("commitLogFromRevision", () => {
  test("returns commit log output", async () => {
    mockExec("fix: something abc123\nfeat: other def456\n");
    const { commitLogFromRevision } = await import("../src/git.ts");
    const log = await commitLogFromRevision("v1.0.0");
    expect(log).toBe("fix: something abc123\nfeat: other def456");
  });

  test("returns empty string when no commits", async () => {
    mockExec("\n");
    const { commitLogFromRevision } = await import("../src/git.ts");
    const log = await commitLogFromRevision("v1.0.0");
    expect(log).toBe("");
  });
});

describe("verifyWorkingTreeIsClean", () => {
  test("passes when working tree is clean", async () => {
    mockExec("");
    const { verifyWorkingTreeIsClean } = await import("../src/git.ts");
    await expect(verifyWorkingTreeIsClean()).resolves.toBeUndefined();
  });

  test("throws when working tree is dirty", async () => {
    mockExec(" M src/index.ts\n");
    const { verifyWorkingTreeIsClean } = await import("../src/git.ts");
    await expect(verifyWorkingTreeIsClean()).rejects.toThrow("Unclean working tree");
  });

  test("throws when git status fails", async () => {
    mockExecError(new Error("not a git repo"));
    const { verifyWorkingTreeIsClean } = await import("../src/git.ts");
    await expect(verifyWorkingTreeIsClean()).rejects.toThrow("Unclean working tree");
  });
});

describe("verifyRemoteHistoryIsClean", () => {
  test("passes when no remote exists", async () => {
    mockExecError(new Error("no upstream"));
    const { verifyRemoteHistoryIsClean } = await import("../src/git.ts");
    await expect(verifyRemoteHistoryIsClean()).resolves.toBeUndefined();
  });

  test("passes when remote is in sync", async () => {
    mockExecSequence([
      { stdout: "" }, // hasRemote (rev-parse @{u})
      { stdout: "" }, // hasUnfetchedChangesFromRemote (fetch --dry-run)
      { stdout: "0\n" }, // isRemoteHistoryClean (rev-list)
    ]);
    const { verifyRemoteHistoryIsClean } = await import("../src/git.ts");
    await expect(verifyRemoteHistoryIsClean()).resolves.toBeUndefined();
  });

  test("throws when there are unfetched changes", async () => {
    mockExecSequence([
      { stdout: "" }, // hasRemote
      { stdout: "some changes\n" }, // hasUnfetchedChangesFromRemote
    ]);
    const { verifyRemoteHistoryIsClean } = await import("../src/git.ts");
    await expect(verifyRemoteHistoryIsClean()).rejects.toThrow("Please run `git fetch`");
  });

  test("throws when remote has unpulled commits", async () => {
    mockExecSequence([
      { stdout: "" }, // hasRemote
      { stdout: "" }, // hasUnfetchedChangesFromRemote
      { stdout: "3\n" }, // isRemoteHistoryClean
    ]);
    const { verifyRemoteHistoryIsClean } = await import("../src/git.ts");
    await expect(verifyRemoteHistoryIsClean()).rejects.toThrow("Please pull changes");
  });
});

describe("getLatestTag", () => {
  test("returns latest tag", async () => {
    mockExec("v1.2.3\n");
    const { getLatestTag } = await import("../src/git.ts");
    expect(await getLatestTag()).toBe("v1.2.3");
  });

  test("ranks a release above its prereleases", async () => {
    mockExec("v1.0.0\nv1.1.0\nv1.1.0-pre.0\nv1.1.0-pre.1\n");
    const { getLatestTag } = await import("../src/git.ts");
    expect(await getLatestTag()).toBe("v1.1.0");
  });

  test("compares prerelease numbers as numbers", async () => {
    mockExec("v1.1.0-pre.10\nv1.1.0-pre.2\nv1.1.0-pre.9\n");
    const { getLatestTag } = await import("../src/git.ts");
    expect(await getLatestTag()).toBe("v1.1.0-pre.10");
  });

  test("ignores tags that are not versions", async () => {
    mockExec("latest\nv1.0.0\nzz-deploy\n");
    const { getLatestTag } = await import("../src/git.ts");
    expect(await getLatestTag()).toBe("v1.0.0");
  });

  test("returns the initial version when no tag is a version", async () => {
    mockExec("latest\n");
    const { getLatestTag } = await import("../src/git.ts");
    expect(await getLatestTag()).toBe("v0.0.0");
  });
});

describe("getLatestReleaseTag", () => {
  test("returns latest release tag (no prerelease)", async () => {
    mockExec("v1.2.3\n");
    const { getLatestReleaseTag } = await import("../src/git.ts");
    expect(await getLatestReleaseTag()).toBe("v1.2.3");
  });

  test("skips prereleases", async () => {
    mockExec("v1.0.0\nv1.1.0-pre.0\n");
    const { getLatestReleaseTag } = await import("../src/git.ts");
    expect(await getLatestReleaseTag()).toBe("v1.0.0");
  });
});

describe("hasTag", () => {
  test("returns true when tag exists", async () => {
    mockExec("abc123\n");
    const { hasTag } = await import("../src/git.ts");
    expect(await hasTag("v1.0.0")).toBe(true);
  });

  test("returns false when tag does not exist", async () => {
    mockExecError(new Error("not found"));
    const { hasTag } = await import("../src/git.ts");
    expect(await hasTag("v99.0.0")).toBe(false);
  });
});

describe("deleteTag", () => {
  test("calls git tag --delete", async () => {
    mockExec("");
    const { deleteTag } = await import("../src/git.ts");
    await deleteTag("v1.0.0");
    expect(execMock).toHaveBeenCalledWith(
      expect.stringContaining("git tag --delete v1.0.0"),
      expect.any(Function),
    );
  });
});

describe("abortMerge", () => {
  test("aborts merge when conflict markers present", async () => {
    mockExecSequence([
      { stdout: "UU src/file.ts\n" }, // git status --porcelain
      { stdout: "" }, // git merge --abort
    ]);
    const { abortMerge } = await import("../src/git.ts");
    await expect(abortMerge()).resolves.toBeUndefined();
  });

  test("does nothing when no merge conflicts", async () => {
    mockExec(" M src/file.ts\n");
    const { abortMerge } = await import("../src/git.ts");
    await expect(abortMerge()).resolves.toBeUndefined();
  });

  test("handles error gracefully", async () => {
    mockExecError(new Error("failed"));
    const { abortMerge } = await import("../src/git.ts");
    await expect(abortMerge()).resolves.toBeUndefined();
  });
});

describe("getPackageVersion", () => {
  test("reads version from package.json", async () => {
    readFileMock.mockResolvedValue(JSON.stringify({ version: "1.2.3" }));
    const { getPackageVersion } = await import("../src/git.ts");
    const version = await getPackageVersion("/project");
    expect(version).toBe("1.2.3");
    expect(readFileMock).toHaveBeenCalledWith(resolve("/project", "package.json"), "utf8");
  });
});

describe("parseRemoteUrl", () => {
  test.each([
    ["git@github.com:owner/repo.git", "github.com", "owner/repo"],
    ["git@gitlab.com:group/sub/project.git", "gitlab.com", "group/sub/project"],
    ["ssh://git@gitlab.acme.com:2222/group/project.git", "gitlab.acme.com", "group/project"],
    ["https://github.com/owner/repo.git", "github.com", "owner/repo"],
    ["https://user@gitlab.acme.com:8443/group/project/", "gitlab.acme.com:8443", "group/project"],
    ["https://github.com/owner/repo\n", "github.com", "owner/repo"],
  ])("parses %s", async (url, host, path) => {
    const { parseRemoteUrl } = await import("../src/git.ts");
    expect(parseRemoteUrl(url)).toEqual({ host, path });
  });

  test("returns null for an unparseable URL", async () => {
    const { parseRemoteUrl } = await import("../src/git.ts");
    expect(parseRemoteUrl("not a url")).toBeNull();
  });
});

describe("getRemoteRepository", () => {
  test("returns host and path of origin", async () => {
    mockExec("git@gitlab.com:group/project.git\n");
    const { getRemoteRepository } = await import("../src/git.ts");
    await expect(getRemoteRepository()).resolves.toEqual({
      host: "gitlab.com",
      path: "group/project",
    });
  });

  test("returns null without origin", async () => {
    mockExecError(new Error("No such remote 'origin'"));
    const { getRemoteRepository } = await import("../src/git.ts");
    await expect(getRemoteRepository()).resolves.toBeNull();
  });
});

describe("getRecentCommitMessages", () => {
  test("reads subject and body of the last commits", async () => {
    mockExec("LEV-1 fix\n\nbody\n");
    const { getRecentCommitMessages } = await import("../src/git.ts");
    expect(await getRecentCommitMessages(500)).toBe("LEV-1 fix\n\nbody");
    expect(execMock.mock.calls[0]![0]).toBe('git log -n 500 --format="%s%n%b"');
  });

  test("returns an empty string in a repository without commits", async () => {
    mockExecError(new Error("fatal: your current branch 'main' does not have any commits yet"));
    const { getRecentCommitMessages } = await import("../src/git.ts");
    expect(await getRecentCommitMessages()).toBe("");
  });
});

describe("isGitIgnored", () => {
  test("is true when git check-ignore matches", async () => {
    mockExec("");
    const { isGitIgnored } = await import("../src/git.ts");
    expect(await isGitIgnored(".env")).toBe(true);
    expect(execMock.mock.calls[0]![0]).toBe('git check-ignore -q ".env"');
  });

  test("is false when git check-ignore exits non-zero", async () => {
    mockExecError(new Error("exit 1"));
    const { isGitIgnored } = await import("../src/git.ts");
    expect(await isGitIgnored(".env")).toBe(false);
  });
});
