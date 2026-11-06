import { cliJson, GITHUB_API_VERSION, isCommandAvailable, postJson } from "./cli-api.ts";
import { ENV_VARS } from "./config.ts";
import type { RemoteRepository } from "./git.ts";

export interface GithubRelease {
  /** Tag of the release, already pushed */
  version: string;
  changelog: string;
  isPrerelease: boolean;
}

/**
 * Returns the base URL of the GitHub REST API for `repo`. In a GitHub Actions job on the same
 * instance it is `GITHUB_API_URL`. Otherwise it is api.github.com, or `/api/v3` on GitHub
 * Enterprise Server.
 */
export const getGithubApiUrl = (
  repo: RemoteRepository,
  env: NodeJS.ProcessEnv = process.env,
): string => {
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
};

/**
 * Creates a published GitHub release with the changelog as its notes and returns its URL.
 *
 * The CLI calls it in CI, where nobody opens and publishes a draft. The tag is already pushed,
 * so the release needs no `target_commitish`. Tries these credentials in this order:
 *
 * 1. `token` (`githubToken` or `CHANGELOG_GITHUB_API_TOKEN`)
 * 2. `GITHUB_TOKEN`, which a GitHub Actions job passes from `secrets.GITHUB_TOKEN`. The job
 *    needs `permissions: contents: write`.
 * 3. The `gh` CLI login
 *
 * Rejects if none is available or if GitHub refuses the request.
 */
export async function createGithubRelease(
  repo: RemoteRepository,
  token: string | undefined,
  release: GithubRelease,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const apiPath = `repos/${repo.path}/releases`;
  const fields = {
    tag_name: release.version,
    name: release.version,
    body: release.changelog,
    prerelease: release.isPrerelease,
  };
  const apiToken = token || env.GITHUB_TOKEN;

  let created: unknown;
  if (apiToken) {
    created = await postJson(
      "GitHub",
      `${getGithubApiUrl(repo, env)}/${apiPath}`,
      {
        Authorization: `Bearer ${apiToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
      fields,
    );
  } else if (await isCommandAvailable("gh")) {
    // `-f` sends a string, so Markdown in the notes is not parsed. `-F` sends the boolean.
    created = await cliJson("gh", apiPath, repo.host, [
      "--method",
      "POST",
      "-f",
      `tag_name=${fields.tag_name}`,
      "-f",
      `name=${fields.name}`,
      "-f",
      `body=${fields.body}`,
      "-F",
      `prerelease=${fields.prerelease}`,
    ]);
  } else {
    throw new Error(
      `No GitHub token and no gh CLI found. Set ${ENV_VARS.githubToken} or GITHUB_TOKEN, or install gh.`,
    );
  }

  const htmlUrl = (created as { html_url?: unknown } | null)?.html_url;
  return typeof htmlUrl === "string"
    ? htmlUrl
    : `https://${repo.host}/${repo.path}/releases/tag/${encodeURIComponent(release.version)}`;
}
