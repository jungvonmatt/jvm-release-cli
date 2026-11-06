import type { ChangelogConfig, CommitLog, GitProvider, PullRequest } from "../changelog/types.ts";
import type { RemoteRepository } from "../git.ts";

export interface ReleaseDetails {
  /** Tag of the release, already pushed */
  version: string;
  changelog: string;
  isPrerelease: boolean;
  /** Branch the tag points into */
  target: string;
}

export interface ReleasePage {
  url: string;
  /** `false` when the page cannot be prefilled with the release notes (GitLab) */
  includesNotes: boolean;
}

/**
 * Everything the CLI must know about a git provider: its API, its CLI, its pull/merge request
 * format and its release page. Code outside `src/provider/` uses this interface and never
 * checks which provider it has, so a new provider needs only a new file.
 */
export interface Provider {
  id: GitProvider;
  /** Display name, also used in messages, for example "GitHub" */
  name: string;
  /** CLI that reuses the user's login, for example `gh` */
  cli: string;
  /** Config key of the API token */
  tokenKey: keyof Pick<ChangelogConfig, "githubToken" | "gitlabToken">;
  /** What the provider calls a pull request, for example "merge request" */
  pullRequestName: string;
  /** Prefix of a pull request reference: `#` for `#12`, `!` for `!12` */
  referencePrefix: string;

  /** Base URL of the REST API for `repo`, without a trailing slash */
  apiBaseUrl: (repo: RemoteRepository, env?: NodeJS.ProcessEnv) => string;
  /** Request headers that authenticate `token` */
  authHeaders: (token: string) => Record<string, string>;

  /** Finds the pull request number in a mainline commit message */
  findPullRequestNumber: (commit: CommitLog) => number | null;
  /** API path of pull request `number`, relative to `apiBaseUrl` */
  pullRequestPath: (repo: RemoteRepository, number: number) => string;
  /** Reduces the API response for a pull request to what the changelog needs */
  toPullRequest: (data: unknown) => PullRequest;

  /** URL of the "new release" page, prefilled as far as the provider allows */
  releasePage: (repo: RemoteRepository, release: ReleaseDetails) => ReleasePage;
  /**
   * Creates the release with the changelog as its notes and returns the page to show.
   * Rejects if no credentials are available or if the provider refuses the request.
   */
  createRelease: (
    repo: RemoteRepository,
    token: string | undefined,
    release: Pick<ReleaseDetails, "version" | "changelog" | "isPrerelease">,
    env?: NodeJS.ProcessEnv,
  ) => Promise<string>;
}
