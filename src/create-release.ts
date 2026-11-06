/* eslint-disable no-console */
import pc from "picocolors";
import { isCI } from "./ci.ts";
import { createGithubRelease } from "./github-release.ts";
import { createGitlabRelease } from "./gitlab-release.ts";
import { getReleasePage, type ReleaseDetails } from "./release-page.ts";
import type { ChangelogConfig, GitProvider } from "./changelog/types.ts";
import type { RemoteRepository } from "./git.ts";

export interface CreatedRelease {
  /** Page to open (or to print in CI) */
  url: string;
  /** Whether that page shows the release notes. If not, the CLI prints them. */
  notesInReleasePage: boolean;
}

/**
 * Creates the release where the API is needed, and returns the page to show.
 *
 * - GitLab: its page cannot be prefilled with notes, so the release is created through the API
 *   and the page is its edit page.
 * - GitHub on a terminal: the page is a draft prefilled with the notes, for review. Nothing is
 *   created.
 * - GitHub in CI: nobody reviews a draft, so the published release is created through the API.
 *
 * If the API call fails, it warns and returns the "new release" page, so the notes can be pasted
 * by hand. With `preview`, it creates nothing.
 */
export async function createRelease(
  repo: RemoteRepository,
  provider: GitProvider,
  config: Pick<ChangelogConfig, "githubToken" | "gitlabToken"> | undefined,
  release: ReleaseDetails,
  preview: boolean,
): Promise<CreatedRelease> {
  const page = getReleasePage(repo, provider, release);
  const fallback = { url: page.url, notesInReleasePage: page.includesNotes };
  if (preview) return fallback;

  if (provider === "gitlab") {
    try {
      const url = await createGitlabRelease(repo, config?.gitlabToken, release);
      return { url, notesInReleasePage: true };
    } catch (error: unknown) {
      console.warn(pc.yellow(`✗ Could not create the GitLab release: ${(error as Error).message}`));
      return fallback;
    }
  }

  if (!isCI()) return fallback;

  try {
    const url = await createGithubRelease(repo, config?.githubToken, release);
    return { url, notesInReleasePage: true };
  } catch (error: unknown) {
    console.warn(pc.yellow(`✗ Could not create the GitHub release: ${(error as Error).message}`));
    // Nobody opens the prefilled page in CI, so the log must show the notes
    return { url: page.url, notesInReleasePage: false };
  }
}
