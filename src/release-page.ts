import type { GitProvider } from "./changelog/types.ts";
import type { RemoteRepository } from "./git.ts";

export interface ReleasePage {
  url: string;
  /** `false` when the page cannot be prefilled with the release notes (GitLab) */
  includesNotes: boolean;
}

export interface ReleaseDetails {
  version: string;
  changelog: string;
  isPrerelease: boolean;
  /** Branch the tag points into */
  target: string;
}

/**
 * Builds the URL of the "new release" page.
 *
 * GitHub opens a draft prefilled with tag, title, notes and the prerelease flag.
 * GitLab has no drafts, and its page can only be prefilled with the tag (`tag_name`).
 * The CLI creates GitLab releases through the API instead (see `gitlab-release.ts`), and
 * opens this page only as the fallback, where the notes must be pasted by hand.
 */
export function getReleasePage(
  repo: RemoteRepository,
  provider: GitProvider,
  release: ReleaseDetails,
): ReleasePage {
  const projectUrl = `https://${repo.host}/${repo.path}`;

  if (provider === "gitlab") {
    const url = new URL(`${projectUrl}/-/releases/new`);
    url.searchParams.set("tag_name", release.version);
    return { url: url.toString(), includesNotes: false };
  }

  const url = new URL(`${projectUrl}/releases/new`);
  url.searchParams.set("tag", release.version);
  url.searchParams.set("target", release.target);
  url.searchParams.set("title", release.version);
  url.searchParams.set("body", release.changelog);
  url.searchParams.set("prerelease", release.isPrerelease ? "1" : "0");
  return { url: url.toString(), includesNotes: true };
}
