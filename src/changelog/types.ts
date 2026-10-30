export interface CommitLog {
  hash: string;
  parents: string[];
  date: string;
  subject: string;
  body: string;
  authorName: string;
  authorEmail: string;
}

export interface GraphNode {
  commit: CommitLog;
  /** Consolidated fullText: subject + body of this commit and all merged branch commits */
  fullText: string;
  /** Branch commits nested under this merge commit */
  merged: CommitLog[];
  /** The pull request (GitHub) or merge request (GitLab) this commit belongs to, if known */
  pullRequest?: PullRequest;
}

export type GitProvider = "github" | "gitlab";

/** A GitHub pull request or a GitLab merge request, reduced to what the changelog needs. */
export interface PullRequest {
  number: number;
  /** `#12` on GitHub, `!12` on GitLab */
  reference: string;
  title: string;
  sourceBranch: string;
  /** Login (GitHub) or username (GitLab) of the author, without `@` */
  author: string | null;
  url: string;
}

export interface JiraTicket {
  key: string;
  summary: string;
  type: string;
  assignee: string | null;
}

export interface ChangelogConfig {
  jiraBaseUrl: string;
  jiraApiHost?: string;
  jiraApiEmail?: string;
  jiraApiToken?: string;
  ticketPattern?: string;
  githubToken?: string;
  gitlabToken?: string;
  /** Overrides the provider detected from the `origin` host (needed for self-hosted instances) */
  gitProvider?: GitProvider;
  /** Set to `false` to skip pull/merge request lookups */
  pullRequests?: boolean;
  /** Lists only tickets that are linked to a pull/merge request */
  onlyTicketsWithPullRequest?: boolean;
  /** Source branches of back-merge PRs, which are ignored (default: main, master, production, release) */
  backMergeBranches?: string[];
}

export interface ChangelogOptions {
  range: string;
  config: ChangelogConfig;
}
