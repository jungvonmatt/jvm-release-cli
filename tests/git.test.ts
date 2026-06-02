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
});

describe("getLatestReleaseTag", () => {
  test("returns latest release tag (no prerelease)", async () => {
    mockExec("v1.2.3\n");
    const { getLatestReleaseTag } = await import("../src/git.ts");
    expect(await getLatestReleaseTag()).toBe("v1.2.3");
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

describe("removeLastCommit", () => {
  test("calls git reset --hard HEAD~1", async () => {
    mockExec("");
    const { removeLastCommit } = await import("../src/git.ts");
    await removeLastCommit();
    expect(execMock).toHaveBeenCalledWith(
      expect.stringContaining("git reset --hard HEAD~1"),
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

describe("getGithubProjectUrl", () => {
  test("converts SSH URL to HTTPS", async () => {
    mockExec("git@github.com:org/repo.git\n");
    const { getGithubProjectUrl } = await import("../src/git.ts");
    expect(await getGithubProjectUrl()).toBe("https://github.com/org/repo");
  });

  test("strips .git suffix from HTTPS URL", async () => {
    mockExec("https://github.com/org/repo.git\n");
    const { getGithubProjectUrl } = await import("../src/git.ts");
    expect(await getGithubProjectUrl()).toBe("https://github.com/org/repo");
  });

  test("passes through clean HTTPS URL", async () => {
    mockExec("https://github.com/org/repo\n");
    const { getGithubProjectUrl } = await import("../src/git.ts");
    expect(await getGithubProjectUrl()).toBe("https://github.com/org/repo");
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
