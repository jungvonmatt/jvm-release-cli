import { cliJson, isCommandAvailable } from "./cli-api.ts";
import { ENV_VARS } from "./config.ts";
import type { RemoteRepository } from "./git.ts";

export interface GitlabRelease {
  /** Tag of the release, already pushed */
  version: string;
  changelog: string;
}

/**
 * Creates a GitLab release with the changelog as its notes and returns the URL of its edit page.
 *
 * GitLab's "new release" page cannot be prefilled with notes, so the CLI creates the release
 * through the API instead. GitLab has no drafts, so the release is public right away.
 * Uses `token` if set, and the `glab` CLI otherwise. Rejects if neither is available or if
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
    const response = await fetch(`https://${repo.host}/api/v4/${apiPath}`, {
      method: "POST",
      headers: { "PRIVATE-TOKEN": token, "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    if (!response.ok) {
      // GitLab gives the reason in `message`, for example "Release already exists"
      const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
      const reason = typeof body?.message === "string" ? `: ${body.message}` : "";
      throw new Error(`GitLab API returned ${response.status}${reason}`);
    }
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
