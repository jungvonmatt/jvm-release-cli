import { cliJson, isCommandAvailable, postJson } from "./cli-api.ts";
import { ENV_VARS } from "./config.ts";
import type { RemoteRepository } from "./git.ts";

export interface GitlabRelease {
  /** Tag of the release, already pushed */
  version: string;
  changelog: string;
}

/**
 * Returns the base URL of the GitLab REST API for `repo`. In a GitLab CI job on the same
 * instance it is `CI_API_V4_URL`, which also covers instances under a sub-path or on plain HTTP.
 */
export const getGitlabApiUrl = (
  repo: RemoteRepository,
  env: NodeJS.ProcessEnv = process.env,
): string => {
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
};

/**
 * Creates a GitLab release with the changelog as its notes and returns the URL of its edit page.
 *
 * GitLab's "new release" page cannot be prefilled with notes, so the CLI creates the release
 * through the API instead. GitLab has no drafts, so the release is public right away.
 * Uses `token` with the REST API if set, so a CI job needs no `glab`, and the `glab` CLI otherwise. Rejects if neither is available or if
 * GitLab refuses the request.
 */
export async function createGitlabRelease(
  repo: RemoteRepository,
  token: string | undefined,
  release: GitlabRelease,
): Promise<string> {
  const apiPath = `projects/${encodeURIComponent(repo.path)}/releases`;
  const fields = {
    tag_name: release.version,
    name: release.version,
    description: release.changelog,
  };

  if (token) {
    await postJson(
      "GitLab",
      `${getGitlabApiUrl(repo)}/${apiPath}`,
      { "PRIVATE-TOKEN": token },
      fields,
    );
  } else if (await isCommandAvailable("glab")) {
    // `-f` sends each value as a string, so Markdown in the notes is not parsed
    const args = Object.entries(fields).flatMap(([key, value]) => ["-f", `${key}=${value}`]);
    await cliJson("glab", apiPath, repo.host, ["--method", "POST", ...args]);
  } else {
    throw new Error(
      `No GitLab token and no glab CLI found. Set ${ENV_VARS.gitlabToken} or install glab.`,
    );
  }

  return `https://${repo.host}/${repo.path}/-/releases/${encodeURIComponent(release.version)}/edit`;
}
