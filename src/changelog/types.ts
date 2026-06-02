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
}

export interface ChangelogOptions {
  range: string;
  config: ChangelogConfig;
}
