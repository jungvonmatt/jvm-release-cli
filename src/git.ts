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
import semver from "semver";

const execa = promisify(exec);

/**
 * Returns the name of the checked-out branch. Throws on a detached HEAD, which is what GitLab CI
 * and most other CI services check out: the release needs a branch to commit to and push.
 */
export const getCurrentBranch = async (): Promise<string> => {
  try {
    const { stdout } = await execa("git symbolic-ref --short -q HEAD");
    return stdout.trim();
  } catch (error: unknown) {
    // `symbolic-ref -q` fails silently on a detached HEAD, and with a message outside a repository
    if ((error as { stderr?: string }).stderr?.trim()) {
      throw error;
    }
    throw new Error(
      "HEAD is detached, but the release needs a branch. Check out the release branch first, " +
        "for example: git checkout -B main origin/main",
    );
  }
};

/**
 * Ensures the clone has the full history. In a shallow clone, such as a GitLab CI checkout with
 * the default `GIT_DEPTH`, tags are missing, so the CLI would compute the wrong version.
 */
export const verifyFullHistory = async (): Promise<void> => {
  let shallow: string;
  try {
    ({ stdout: shallow } = await execa("git rev-parse --is-shallow-repository"));
  } catch {
    // Not a git repository. The later git commands report that.
    return;
  }
  if (shallow.trim() === "true") {
    throw new Error(
      "Shallow clone: tags and history are missing, so the version would be wrong. " +
        "Run `git fetch --unshallow --tags`, or set `GIT_DEPTH: 0` in the GitLab CI job.",
    );
  }
};

/**
 * Ensures git knows who commits. The version bump and the merge of a production release create
 * commits, and a CI runner has no git user by default.
 */
export const verifyGitIdentity = async (): Promise<void> => {
  try {
    await execa("git var GIT_COMMITTER_IDENT");
  } catch {
    throw new Error(
      "No git user. Set one before the release, for example: " +
        'git config user.name "Release Bot" && git config user.email "release-bot@example.com"',
    );
  }
};

/**
 * Ensures `origin` does not use the GitLab CI job token. That token can fetch, but it cannot
 * push, so the release would fail after it created the version commit and tag.
 */
export const verifyOriginCanPush = async (): Promise<void> => {
  let url: string;
  try {
    ({ stdout: url } = await execa("git remote get-url origin"));
  } catch {
    // No origin. The push reports that.
    return;
  }
  if (/\/\/gitlab-ci-token(:|@)/.test(url)) {
    throw new Error(
      "origin uses the CI job token, which cannot push. Set origin to a URL with a token that " +
        "can push, for example: git remote set-url origin " +
        '"https://release-bot:${RELEASE_BOT_TOKEN}@${CI_SERVER_HOST}/${CI_PROJECT_PATH}.git"',
    );
  }
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
 * Checks whether git tracks `path`. A tracked file stays tracked even when `.gitignore` lists it.
 */
export const isGitTracked = async (path: string): Promise<boolean> => {
  try {
    await execa(`git ls-files --error-unmatch -- "${path}"`);
    return true;
  } catch {
    return false;
  }
};

/**
 * Checks whether git ignores `path`. Also `false` outside a git repository, and for tracked files.
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

/**
 * Returns the tags that are SemVer versions, highest first. Sorts with semver, because git's
 * version sort puts `v1.1.0-pre.0` above `v1.1.0`. Other tags are ignored.
 */
const getVersionTags = async (): Promise<string[]> => {
  const { stdout } = await execa("git tag --list");
  return stdout
    .split("\n")
    .map((tag) => tag.trim())
    .filter((tag) => semver.valid(tag))
    .sort(semver.rcompare);
};

export const getLatestTag = async (): Promise<string> =>
  (await getVersionTags())[0] ?? INITIAL_VERSION;

export const getLatestReleaseTag = async (): Promise<string> =>
  (await getVersionTags()).find((tag) => !semver.prerelease(tag)) ?? INITIAL_VERSION;

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

/**
 * Deletes a temporary branch. If HEAD is still on it, because the release failed before it
 * switched back, it first switches to `returnBranch` and discards the changes of the failed bump.
 */
export const deleteTemporaryBranch = async (
  branch: string,
  returnBranch: string,
): Promise<void> => {
  if ((await getCurrentBranch()) === branch) {
    await execa(`git switch --discard-changes "${returnBranch}"`);
  }
  await execa(`git branch -D "${branch}"`);
};

/**
 * Pushes the current branch and the version tag in one atomic push: `origin` takes both or
 * neither. So a failed push never leaves the version commit on `origin` without its tag, and
 * `undoRelease` can undo the whole release.
 */
export const pushRelease = async (tag: string): Promise<void> => {
  await execa(`git push --atomic --no-verify origin HEAD "refs/tags/${tag}"`);
};

/** The state before a release, so that `undoRelease` can restore exactly that state. */
export interface ReleaseStart {
  /** Branch the release started on */
  branch: string;
  /** Commit of each branch the release can change: the start branch and the release branch */
  heads: Record<string, string>;
  /** Whether the version tag existed before the release */
  tagExisted: boolean;
}

export const recordReleaseStart = async (
  releaseBranch: string,
  tag: string,
): Promise<ReleaseStart> => {
  const branch = await getCurrentBranch();
  const heads: Record<string, string> = {};
  for (const name of new Set([branch, releaseBranch])) {
    try {
      const { stdout } = await execa(`git rev-parse --verify -q "refs/heads/${name}"`);
      heads[name] = stdout.trim();
    } catch {
      // The release branch does not exist, so the release cannot change it
    }
  }
  return { branch, heads, tagExisted: await hasTag(tag) };
};

/**
 * Undoes a failed release: aborts a merge, resets each branch to its commit before the release,
 * and deletes the version tag. It undoes only what the release did. A branch that did not move
 * keeps its commits, and a tag that existed before stays.
 */
export const undoRelease = async (start: ReleaseStart, tag: string): Promise<void> => {
  await abortMerge();

  const current = await getCurrentBranch();
  for (const [name, head] of Object.entries(start.heads)) {
    if (name === current) {
      // The working tree was clean before the release, so this drops only the release's changes
      await execa(`git reset --hard ${head}`);
    } else {
      await execa(`git update-ref "refs/heads/${name}" ${head}`);
    }
  }

  if (!start.tagExisted && (await hasTag(tag))) {
    await deleteTag(tag);
  }
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

export const getPackageVersion = async (root: string): Promise<string> => {
  const packageJsonPath = resolve(root, "package.json");
  const packageJsonContent = await readFile(packageJsonPath, "utf8");
  const data = JSON.parse(packageJsonContent) as { version: string };
  return data.version;
};
