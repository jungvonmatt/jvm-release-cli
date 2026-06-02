export type ReleaseTarget = "test" | "production";

export interface ReleaseContext {
  version: string;
  changelog: string;
  isPrerelease?: boolean;
}

export interface ReleaseSelection {
  latestTag: string;
  latestReleaseTag: string;
  version: string;
  target: ReleaseTarget;
}
