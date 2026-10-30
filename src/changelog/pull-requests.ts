import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { detectProvider, getRemoteRepository } from "../git.ts";
import type { RemoteRepository } from "../git.ts";
import type { ChangelogConfig, CommitLog, GitProvider, GraphNode, PullRequest } from "./types.ts";

const execFileAsync = promisify(execFile);

/** Maximum number of parallel API requests (or `gh`/`glab` processes). */
const CONCURRENCY = 6;

const GITHUB_API_VERSION = "2022-11-28";

export interface PullRequestClient {
  provider: GitProvider;
  get: (number: number) => Promise<PullRequest>;
}

interface GithubPullRequest {
  number: number;
  title: string;
  html_url: string;
  user: { login: string } | null;
  head: { ref: string };
}

interface GitlabMergeRequest {
  iid: number;
  title: string;
  web_url: string;
  author: { username: string } | null;
  source_branch: string;
}

const fromGithub = (data: GithubPullRequest): PullRequest => ({
  number: data.number,
  reference: `#${data.number}`,
  title: data.title,
  sourceBranch: data.head.ref,
  author: data.user?.login ?? null,
  url: data.html_url,
});

const fromGitlab = (data: GitlabMergeRequest): PullRequest => ({
  number: data.iid,
  reference: `!${data.iid}`,
  title: data.title,
  sourceBranch: data.source_branch,
  author: data.author?.username ?? null,
  url: data.web_url,
});

/**
 * Finds the pull/merge request number in a mainline commit message.
 *
 * - GitHub: `Merge pull request #12 from …` (merge commit) or `… (#12)` (squash merge)
 * - GitLab: `See merge request group/project!12` in the body (merge commit) or `… (!12)`
 */
export function findPullRequestNumber(commit: CommitLog, provider: GitProvider): number | null {
  const match =
    provider === "github"
      ? (commit.subject.match(/^Merge pull request #(\d+) from /) ??
        commit.subject.match(/\(#(\d+)\)$/))
      : (commit.body.match(/^See merge request \S*!(\d+)\s*$/m) ??
        commit.subject.match(/\(!(\d+)\)$/));

  return match ? Number(match[1]) : null;
}

const isCommandAvailable = async (command: string): Promise<boolean> => {
  try {
    await execFileAsync(command, ["--version"]);
    return true;
  } catch {
    return false;
  }
};

const fetchJson = async (url: string, headers: Record<string, string>): Promise<unknown> => {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`API returned ${response.status} for ${url}`);
  }
  return response.json();
};

/** Runs `gh api` or `glab api`, which reuse the login of the installed CLI. */
const cliJson = async (command: string, path: string, host: string): Promise<unknown> => {
  try {
    const { stdout } = await execFileAsync(command, ["api", path, "--hostname", host], {
      maxBuffer: 10 * 1024 * 1024,
      // A shell-wide CLICOLOR_FORCE makes gh color its JSON even when piped
      env: { ...process.env, NO_COLOR: "1", CLICOLOR_FORCE: "0" },
    });
    return JSON.parse(stdout);
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(stderr || (error as Error).message);
  }
};

/**
 * Creates a client for the pull requests (GitHub) or merge requests (GitLab) of the `origin` repository.
 *
 * Uses the API token from the config if set, and the `gh` or `glab` CLI otherwise.
 * Returns `null` if the provider is unknown or no token and no CLI is available.
 */
export async function createPullRequestClient(
  config: ChangelogConfig,
  repo: RemoteRepository | null = null,
): Promise<PullRequestClient | null> {
  repo ??= await getRemoteRepository();
  if (!repo) return null;

  const provider = config.gitProvider ?? detectProvider(repo.host);
  if (!provider) return null;

  const { host, path } = repo;

  if (provider === "github") {
    const apiPath = (n: number) => `repos/${path}/pulls/${n}`;
    const apiBase = host === "github.com" ? "https://api.github.com" : `https://${host}/api/v3`;
    const token = config.githubToken;

    if (token) {
      const headers = {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      };
      return {
        provider,
        get: async (n) =>
          fromGithub((await fetchJson(`${apiBase}/${apiPath(n)}`, headers)) as GithubPullRequest),
      };
    }

    if (await isCommandAvailable("gh")) {
      return {
        provider,
        get: async (n) => fromGithub((await cliJson("gh", apiPath(n), host)) as GithubPullRequest),
      };
    }

    console.warn("⚠️  No GitHub token and no gh CLI found. Skipping pull request links.");
    return null;
  }

  const apiPath = (n: number) => `projects/${encodeURIComponent(path)}/merge_requests/${n}`;
  const token = config.gitlabToken;

  if (token) {
    const headers = { "PRIVATE-TOKEN": token };
    return {
      provider,
      get: async (n) =>
        fromGitlab(
          (await fetchJson(`https://${host}/api/v4/${apiPath(n)}`, headers)) as GitlabMergeRequest,
        ),
    };
  }

  if (await isCommandAvailable("glab")) {
    return {
      provider,
      get: async (n) => fromGitlab((await cliJson("glab", apiPath(n), host)) as GitlabMergeRequest),
    };
  }

  console.warn("⚠️  No GitLab token and no glab CLI found. Skipping merge request links.");
  return null;
}

async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Loads the pull/merge request behind each mainline commit and attaches it to the node.
 *
 * The PR title and source branch are added to `fullText`, so ticket keys that appear only
 * there are found too. The PR description is left out because it often mentions related tickets.
 * Failed lookups are skipped and reported in one warning.
 */
export async function attachPullRequests(
  nodes: GraphNode[],
  client: PullRequestClient,
): Promise<GraphNode[]> {
  const numberByHash = new Map<string, number>();
  for (const node of nodes) {
    const number = findPullRequestNumber(node.commit, client.provider);
    if (number !== null) numberByHash.set(node.commit.hash, number);
  }

  const numbers = [...new Set(numberByHash.values())];
  const loaded = new Map<number, PullRequest>();
  const failed: Array<{ number: number; message: string }> = [];

  await mapWithLimit(numbers, CONCURRENCY, async (number) => {
    try {
      loaded.set(number, await client.get(number));
    } catch (error) {
      failed.push({ number, message: error instanceof Error ? error.message : String(error) });
    }
  });

  if (failed.length > 0) {
    const prefix = client.provider === "github" ? "#" : "!";
    const refs = failed.map((f) => `${prefix}${f.number}`).join(", ");
    console.warn(
      `⚠️  Could not load ${failed.length} pull/merge request(s) (${refs}): ${failed[0]!.message}`,
    );
  }

  return nodes.map((node) => {
    const number = numberByHash.get(node.commit.hash);
    const pullRequest = number === undefined ? undefined : loaded.get(number);
    if (!pullRequest) return node;

    return {
      ...node,
      pullRequest,
      fullText: [node.fullText, pullRequest.title, pullRequest.sourceBranch]
        .filter(Boolean)
        .join("\n"),
    };
  });
}
