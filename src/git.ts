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
import type { GitProvider } from "./changelog/types.ts";

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

/**
 * Gets subject and body of the last `limit` commits. Returns an empty string in a repository
 * without commits.
 */
export const getRecentCommitMessages = async (limit = 500): Promise<string> => {
  try {
    const { stdout } = await execa(`git log -n ${limit} --format="%s%n%b"`);
    return stdout.trim();
  } catch {
    return "";
  }
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
 * Checks whether git ignores `path`. Also `false` outside a git repository.
 */
export const isGitIgnored = async (path: string): Promise<boolean> => {
  try {
    await execa(`git check-ignore -q "${path}"`);
    return true;
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

export interface RemoteRepository {
  /** Web host, e.g. `github.com` or `gitlab.example.com:8443`. */
  host: string;
  /** Project path, e.g. `owner/repo` or `group/subgroup/project`. */
  path: string;
}

/**
 * Splits a git remote URL into web host and project path.
 *
 * Supports scp-like SSH (`git@host:owner/repo.git`), `ssh://` and `http(s)://` URLs.
 * The port of an SSH URL is dropped because it is not the web port.
 */
export const parseRemoteUrl = (url: string): RemoteRepository | null => {
  const trimmed = url.trim();
  const toPath = (path: string) => path.replace(/^\/+/, "").replace(/(\.git)?\/*$/, "");

  if (!trimmed.includes("://")) {
    const match = trimmed.match(/^(?:[^@/]+@)?([^:/]+):(.+)$/);
    return match ? { host: match[1]!, path: toPath(match[2]!) } : null;
  }

  try {
    const parsed = new URL(trimmed);
    const isWeb = parsed.protocol === "https:" || parsed.protocol === "http:";
    const path = toPath(parsed.pathname);
    return path ? { host: isWeb ? parsed.host : parsed.hostname, path } : null;
  } catch {
    return null;
  }
};

/**
 * Reads the `origin` remote. Returns `null` if there is no `origin` or its URL cannot be parsed.
 */
export const getRemoteRepository = async (): Promise<RemoteRepository | null> => {
  try {
    const { stdout } = await execa("git remote get-url origin");
    return parseRemoteUrl(stdout);
  } catch {
    return null;
  }
};

/** Detects the provider from the remote host. Self-hosted instances may need `gitProvider` in the config. */
export const detectProvider = (host: string): GitProvider | null => {
  if (host.includes("github")) return "github";
  if (host.includes("gitlab")) return "gitlab";
  return null;
};

export const getPackageVersion = async (root: string): Promise<string> => {
  const packageJsonPath = resolve(root, "package.json");
  const packageJsonContent = await readFile(packageJsonPath, "utf8");
  const data = JSON.parse(packageJsonContent) as { version: string };
  return data.version;
};
