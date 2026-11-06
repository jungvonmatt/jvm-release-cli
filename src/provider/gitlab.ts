import { ENV_VARS } from "../config.ts";
import { createApiClient } from "./api.ts";
import type { Provider } from "./types.ts";

interface GitlabMergeRequest {
  iid: number;
  title: string;
  web_url: string;
  author: { username: string } | null;
  source_branch: string;
}

const projectPath = (path: string) => `projects/${encodeURIComponent(path)}`;

export const gitlab: Provider = {
  id: "gitlab",
  name: "GitLab",
  cli: "glab",
  tokenKey: "gitlabToken",
  pullRequestName: "merge request",
  referencePrefix: "!",

  /**
   * In a GitLab CI job on the same instance it is `CI_API_V4_URL`, which also covers instances
   * under a sub-path or on plain HTTP.
   */
  apiBaseUrl(repo, env = process.env) {
    const { CI_API_V4_URL: ciApiUrl, CI_SERVER_URL: ciServerUrl } = env;
    if (ciApiUrl && ciServerUrl) {
      try {
        if (new URL(ciServerUrl).host === repo.host) {
          return ciApiUrl.replace(/\/+$/, "");
        }
      } catch {
        // Not a URL. Use the remote host.
      }
    }
    return `https://${repo.host}/api/v4`;
  },

  authHeaders: (token) => ({ "PRIVATE-TOKEN": token }),

  /** `See merge request group/project!12` in the body (merge commit) or `… (!12)` */
  findPullRequestNumber(commit) {
    const match =
      commit.body.match(/^See merge request \S*!(\d+)\s*$/m) ?? commit.subject.match(/\(!(\d+)\)$/);
    return match ? Number(match[1]) : null;
  },

  pullRequestPath: (repo, number) => `${projectPath(repo.path)}/merge_requests/${number}`,

  toPullRequest(data) {
    const mr = data as GitlabMergeRequest;
    return {
      number: mr.iid,
      reference: `!${mr.iid}`,
      title: mr.title,
      sourceBranch: mr.source_branch,
      author: mr.author?.username ?? null,
      url: mr.web_url,
    };
  },

  /**
   * GitLab has no drafts, and its page can only be prefilled with the tag (`tag_name`). So the CLI
   * creates the release through the API, and opens this page only as the fallback, where the
   * notes must be pasted by hand.
   */
  releasePage(repo, release) {
    const url = new URL(`https://${repo.host}/${repo.path}/-/releases/new`);
    url.searchParams.set("tag_name", release.version);
    return { url: url.toString(), includesNotes: false };
  },

  /**
   * Creates the release and returns the URL of its edit page. GitLab has no drafts, so the
   * release is public right away. Uses `token` if set, and the `glab` login otherwise.
   */
  async createRelease(repo, token, release, env = process.env) {
    const api = await createApiClient(gitlab, repo, token, env);
    if (!api) {
      throw new Error(
        `No GitLab token and no glab CLI found. Set ${ENV_VARS.gitlabToken} or install glab.`,
      );
    }

    await api.post(`${projectPath(repo.path)}/releases`, {
      tag_name: release.version,
      name: release.version,
      description: release.changelog,
    });

    return `https://${repo.host}/${repo.path}/-/releases/${encodeURIComponent(release.version)}/edit`;
  },
};
