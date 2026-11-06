import { getRemoteRepository } from "../git.ts";
import type { RemoteRepository } from "../git.ts";
import { createApiClient } from "../provider/api.ts";
import { detectProvider, getProvider } from "../provider/index.ts";
import type { ChangelogConfig, CommitLog, GitProvider, GraphNode, PullRequest } from "./types.ts";

/** Maximum number of parallel API requests (or `gh`/`glab` processes). */
const CONCURRENCY = 6;

/** Source branches of back-merge PRs, e.g. `production` merged back into `main`. */
export const DEFAULT_BACK_MERGE_BRANCHES = ["main", "master", "production", "release"];

export interface PullRequestClient {
  provider: GitProvider;
  get: (number: number) => Promise<PullRequest>;
}

/**
 * Finds the pull/merge request number in a mainline commit message, in the format of `provider`.
 */
export const findPullRequestNumber = (commit: CommitLog, provider: GitProvider): number | null =>
  getProvider(provider).findPullRequestNumber(commit);

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
  const remote = repo ?? (await getRemoteRepository());
  if (!remote) return null;

  const id = config.gitProvider ?? detectProvider(remote.host);
  if (!id) return null;

  const provider = getProvider(id);
  const api = await createApiClient(provider, remote, config[provider.tokenKey]);
  if (!api) {
    console.warn(
      `⚠️  No ${provider.name} token and no ${provider.cli} CLI found. Skipping ${provider.pullRequestName} links.`,
    );
    return null;
  }

  return {
    provider: id,
    get: async (n) => provider.toPullRequest(await api.get(provider.pullRequestPath(remote, n))),
  };
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
 *
 * A back-merge PR (source branch in `backMergeBranches`) is not attached: it only carries
 * changes that were released before, so it adds no links, authors or "Other Commits" entry.
 */
export async function attachPullRequests(
  nodes: GraphNode[],
  client: PullRequestClient,
  backMergeBranches: string[] = DEFAULT_BACK_MERGE_BRANCHES,
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
    const prefix = getProvider(client.provider).referencePrefix;
    const refs = failed
      .map((f) => f.number)
      .sort((a, b) => a - b)
      .map((n) => `${prefix}${n}`)
      .join(", ");
    console.warn(
      `⚠️  Could not load ${failed.length} pull/merge request(s) (${refs}): ${failed[0]!.message}`,
    );
  }

  return nodes.map((node) => {
    const number = numberByHash.get(node.commit.hash);
    const pullRequest = number === undefined ? undefined : loaded.get(number);
    if (!pullRequest || backMergeBranches.includes(pullRequest.sourceBranch)) return node;

    return {
      ...node,
      pullRequest,
      fullText: [node.fullText, pullRequest.title, pullRequest.sourceBranch]
        .filter(Boolean)
        .join("\n"),
    };
  });
}
