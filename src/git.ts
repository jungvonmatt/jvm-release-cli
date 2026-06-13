/**
 * Git helpers used by the release/publish CLI.
 *
 * These helpers are intentionally small and shell out to `git` so they behave the
 * same way as a developer would in a terminal.
 */
import { exec } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execa = promisify(exec);

export const getCurrentBranch = async (): Promise<string> => {
  const { stdout } = await execa("git symbolic-ref --short HEAD");
  return stdout.trim();
};

const getDefaultBranch = async (): Promise<string> => {
  // Strategy 1: Try the direct approach first (works if origin/HEAD is set)
  try {
    const { stdout } = await execa("git rev-parse --abbrev-ref origin/HEAD");
    const branch = stdout.trim();
    if (branch && branch !== "origin/HEAD") {
      return branch;
    }
  } catch {
    // origin/HEAD not set, try fallbacks
  }

  // Strategy 2: Query the remote directly for its HEAD reference
  try {
    const { stdout } = await execa("git remote show origin");
    const match = stdout.match(/HEAD branch: (.+)/);
    if (match) {
      return `origin/${match[1].trim()}`;
    }
  } catch {
    // Remote query failed, try next fallback
  }

  // Strategy 3: Check for common default branch names that exist on origin
  for (const branch of ["main", "master"]) {
    try {
      await execa(`git rev-parse --verify origin/${branch}`);
      return `origin/${branch}`;
    } catch {
      // Branch doesn't exist, try next
    }
  }

  // Fallback: assume 'main' as the modern default
  return "origin/main";
};

/**
 * Ensures the current branch is either the configured release branch or the remote default branch.
 */
export const verifyCurrentBranchIsReleaseBranch = async (releaseBranch: string): Promise<void> => {
  const currentBranch = await getCurrentBranch();
  const defaultBranch = await getDefaultBranch();
  if (
    currentBranch !== releaseBranch &&
    `origin/${currentBranch}` !== defaultBranch &&
    !currentBranch.startsWith("release/") &&
    !currentBranch.startsWith("hotfix/")
  ) {
    throw new Error(
      `Not on \`${releaseBranch}\` branch. Use --branch to set a different release branch.`,
    );
  }
};

/**
 * Gets a single-line commit log (subject + abbreviated hash), starting after `revision`.
 */
export const commitLogFromRevision = async (revision: string): Promise<string> => {
  if (revision === INITIAL_VERSION) {
    const { stdout } = await execa(`git log --format="%s %h"`);
    return stdout.trim();
  }
  const { stdout } = await execa(`git log --format="%s %h" ${revision}..HEAD`);
  return stdout.trim();
};

const isWorkingTreeClean = async (): Promise<boolean> => {
  try {
    const { stdout } = await execa("git status --porcelain");
    return stdout.trim() === "";
  } catch {
    return false;
  }
};

/**
 * Ensures there are no local modifications (tracked/untracked) in the working tree.
 */
export const verifyWorkingTreeIsClean = async (): Promise<void> => {
  if (!(await isWorkingTreeClean())) {
    throw new Error("Unclean working tree. Commit or stash changes first.");
  }
};

const hasRemote = async (): Promise<boolean> => {
  try {
    await execa("git rev-parse @{u}");
  } catch {
    return false;
  }
  return true;
};

const hasUnfetchedChangesFromRemote = async (): Promise<boolean> => {
  const { stdout: possibleNewChanges } = await execa("git fetch --dry-run");
  return !!(possibleNewChanges?.trim() && possibleNewChanges.trim() !== "");
};

const isRemoteHistoryClean = async (): Promise<boolean> => {
  const { stdout: history } = await execa("git rev-list --count --left-only @{u}...HEAD");
  return history.trim() === "0";
};

/**
 * Ensures the local branch is in sync with upstream (no missing fetch and no missing pull).
 */
export const verifyRemoteHistoryIsClean = async (): Promise<void> => {
  if (!(await hasRemote())) {
    return;
  }

  if (await hasUnfetchedChangesFromRemote()) {
    throw new Error("Remote history differs. Please run `git fetch` and pull changes.");
  }

  if (!(await isRemoteHistoryClean())) {
    throw new Error("Remote history differs. Please pull changes.");
  }
};

export const INITIAL_VERSION = "v0.0.0";

export const getLatestTag = async (): Promise<string> => {
  const { stdout } = await execa("git tag --sort=-v:refname | head -n 1");
  return stdout.trim() || INITIAL_VERSION;
};

export const getLatestReleaseTag = async (): Promise<string> => {
  const { stdout } = await execa(
    'git tag --sort=-v:refname | grep -E "^v?[0-9]+.[0-9]+.[0-9]+$" | head -n 1',
  );
  return stdout.trim() || INITIAL_VERSION;
};

export const hasTag = async (tag: string): Promise<boolean> => {
  try {
    await execa(`git rev-parse -q --verify "refs/tags/${tag}"`);
    return true;
  } catch {
    return false;
  }
};

export const deleteTag = async (tag: string): Promise<void> => {
  await execa(`git tag --delete ${tag}`);
};

export const removeLastCommit = async (): Promise<void> => {
  await execa("git reset --hard HEAD~1");
};

/**
 * Aborts any in-progress merge and cleans up the working tree.
 */
export const abortMerge = async (): Promise<void> => {
  try {
    const { stdout } = await execa("git status --porcelain");
    if (stdout.includes("UU") || stdout.includes("AA")) {
      await execa("git merge --abort");
    }
  } catch {
    // If merge --abort fails, that's okay - might not be in a merge state
  }
};

/**
 * Reads the `origin` remote URL and normalizes it to an HTTPS GitHub project URL.
 */
export const getGithubProjectUrl = async (): Promise<string> => {
  const { stdout } = await execa("git remote get-url origin");

  let remoteUrl = stdout.trim();

  // Convert SSH URL to HTTPS if needed
  if (remoteUrl.startsWith("git@")) {
    const match = remoteUrl.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
    if (match) {
      remoteUrl = `https://${match[1]}/${match[2]}`;
    }
  } else {
    remoteUrl = remoteUrl.replace(/\.git$/, "");
  }

  return remoteUrl;
};

export const getPackageVersion = async (root: string): Promise<string> => {
  const packageJsonPath = resolve(root, "package.json");
  const packageJsonContent = await readFile(packageJsonPath, "utf8");
  const data = JSON.parse(packageJsonContent) as { version: string };
  return data.version;
};
