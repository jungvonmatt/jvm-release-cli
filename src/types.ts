export type ReleaseTarget = "test" | "production";

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
  version: string;
  target: ReleaseTarget;
}
