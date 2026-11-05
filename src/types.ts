export type ReleaseTarget = "prerelease" | "production";

export interface ReleaseContext {
  version: string;
  changelog: string;
  isPrerelease?: boolean;
  /** Whether the opened release page is prefilled with the changelog */
  notesInReleasePage?: boolean;
}

export interface ReleaseSelection {
  latestTag: string;
  latestReleaseTag: string;
  /** Prerelease tag that a production release promotes, or `null` to release the branch tip */
  promotedTag: string | null;
  version: string;
  target: ReleaseTarget;
}
