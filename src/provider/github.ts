import { ENV_VARS } from "../config.ts";
import { createApiClient } from "./api.ts";
import type { Provider } from "./types.ts";

/** GitHub REST API version, see https://docs.github.com/rest/about-the-rest-api/api-versions */
export const GITHUB_API_VERSION = "2022-11-28";

interface GithubPullRequest {
  number: number;
  title: string;
  html_url: string;
  user: { login: string } | null;
  head: { ref: string };
}

export const github: Provider = {
  id: "github",
  name: "GitHub",
  cli: "gh",
  tokenKey: "githubToken",
  pullRequestName: "pull request",
  referencePrefix: "#",

  /**
   * In a GitHub Actions job on the same instance it is `GITHUB_API_URL`. Otherwise it is
   * api.github.com, or `/api/v3` on GitHub Enterprise Server.
   */
  apiBaseUrl(repo, env = process.env) {
    const { GITHUB_API_URL: actionsApiUrl, GITHUB_SERVER_URL: actionsServerUrl } = env;
    if (actionsApiUrl && actionsServerUrl) {
      try {
        if (new URL(actionsServerUrl).host === repo.host) {
          return actionsApiUrl.replace(/\/+$/, "");
        }
      } catch {
        // Not a URL. Use the remote host.
      }
    }
    return repo.host === "github.com" ? "https://api.github.com" : `https://${repo.host}/api/v3`;
  },

  authHeaders: (token) => ({
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
  }),

  /** `Merge pull request #12 from …` (merge commit) or `… (#12)` (squash merge) */
  findPullRequestNumber(commit) {
    const match =
      commit.subject.match(/^Merge pull request #(\d+) from /) ??
      commit.subject.match(/\(#(\d+)\)$/);
    return match ? Number(match[1]) : null;
  },

  pullRequestPath: (repo, number) => `repos/${repo.path}/pulls/${number}`,

  toPullRequest(data) {
    const pr = data as GithubPullRequest;
    return {
      number: pr.number,
      reference: `#${pr.number}`,
      title: pr.title,
      sourceBranch: pr.head.ref,
      author: pr.user?.login ?? null,
      url: pr.html_url,
    };
  },

  /** A draft prefilled with tag, title, notes and the prerelease flag */
  releasePage(repo, release) {
    const url = new URL(`https://${repo.host}/${repo.path}/releases/new`);
    url.searchParams.set("tag", release.version);
    url.searchParams.set("target", release.target);
    url.searchParams.set("title", release.version);
    url.searchParams.set("body", release.changelog);
    url.searchParams.set("prerelease", release.isPrerelease ? "1" : "0");
    return { url: url.toString(), includesNotes: true };
  },

  /**
   * Creates a published release and returns its URL. The CLI calls it in CI, where nobody opens
   * and publishes a draft. The tag is already pushed, so the release needs no `target_commitish`.
   * Tries these credentials in this order:
   *
   * 1. `token` (`githubToken` or `CHANGELOG_GITHUB_API_TOKEN`)
   * 2. `GITHUB_TOKEN`, which a GitHub Actions job passes from `secrets.GITHUB_TOKEN`. The job
   *    needs `permissions: contents: write`.
   * 3. The `gh` CLI login
   */
  async createRelease(repo, token, release, env = process.env) {
    const api = await createApiClient(github, repo, token || env.GITHUB_TOKEN, env);
    if (!api) {
      throw new Error(
        `No GitHub token and no gh CLI found. Set ${ENV_VARS.githubToken} or GITHUB_TOKEN, or install gh.`,
      );
    }

    const created = await api.post(`repos/${repo.path}/releases`, {
      tag_name: release.version,
      name: release.version,
      body: release.changelog,
      prerelease: release.isPrerelease,
    });

    const htmlUrl = (created as { html_url?: unknown } | null)?.html_url;
    return typeof htmlUrl === "string"
      ? htmlUrl
      : `https://${repo.host}/${repo.path}/releases/tag/${encodeURIComponent(release.version)}`;
  },
};
