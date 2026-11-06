/* eslint-disable no-console */
import pc from "picocolors";
import { isCI } from "./ci.ts";
import type { ChangelogConfig } from "./changelog/types.ts";
import type { RemoteRepository } from "./git.ts";
import type { Provider, ReleaseDetails } from "./provider/index.ts";

export interface CreatedRelease {
  /** Page to open (or to print in CI) */
  url: string;
  /** Whether that page shows the release notes. If not, the CLI prints them. */
  notesInReleasePage: boolean;
}

/**
 * Creates the release where the API is needed, and returns the page to show.
 *
 * - On a terminal, a "new release" page prefilled with the notes is enough (GitHub): someone
 *   reviews and publishes the draft. Nothing is created.
 * - If the page cannot show the notes (GitLab), or in CI, where nobody reviews a draft, the
 *   release is created through the API.
 *
 * If the API call fails, it warns and returns the "new release" page, and the CLI prints the
 * notes to paste by hand. With `preview`, it creates nothing.
 */
export async function createRelease(
  repo: RemoteRepository,
  provider: Provider,
  config: Pick<ChangelogConfig, "githubToken" | "gitlabToken"> | undefined,
  release: ReleaseDetails,
  preview: boolean,
): Promise<CreatedRelease> {
  const page = provider.releasePage(repo, release);
  if (preview || (page.includesNotes && !isCI())) {
    return { url: page.url, notesInReleasePage: page.includesNotes };
  }

  try {
    const url = await provider.createRelease(repo, config?.[provider.tokenKey], release);
    return { url, notesInReleasePage: true };
  } catch (error: unknown) {
    console.warn(
      pc.yellow(`✗ Could not create the ${provider.name} release: ${(error as Error).message}`),
    );
    // Either the page cannot show the notes, or nobody opens it in CI. So the log must show them.
    return { url: page.url, notesInReleasePage: false };
  }
}
