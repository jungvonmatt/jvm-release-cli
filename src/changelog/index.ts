import type { ChangelogConfig } from "./types.ts";
import { getGitLog } from "./git-log.ts";
import { buildGraph, extractTickets } from "./graph.ts";
import { fetchJiraTickets } from "./jira.ts";
import { formatChangelog } from "./formatter.ts";
import { attachPullRequests, createPullRequestClient } from "./pull-requests.ts";

/**
 * Generates a Markdown changelog for the given git range.
 *
 * Orchestrates: git-log → graph → pull/merge requests → extract tickets → jira → format
 */
export async function generateChangelog(range: string, config: ChangelogConfig): Promise<string> {
  // 1. Fetch structured git log
  const commits = await getGitLog(range);

  if (commits.length === 0) {
    return "No changes detected.";
  }

  // 2. Build first-parent graph with merge nesting
  const graph = buildGraph(commits);

  // 3. Attach GitHub pull requests / GitLab merge requests (graceful fallback)
  const client = config.pullRequests === false ? null : await createPullRequestClient(config);
  const nodes = client ? await attachPullRequests(graph, client, config.backMergeBranches) : graph;

  // 4. Extract ticket IDs from consolidated text
  const pattern = config.ticketPattern ?? "[A-Z]+-\\d+";
  const ticketKeys = extractTickets(nodes, pattern);

  // 5. Fetch ticket metadata from Jira (graceful fallback)
  const tickets = await fetchJiraTickets(ticketKeys, config);

  // 6. Format as Markdown
  return formatChangelog(nodes, tickets, ticketKeys, config, {
    requirePullRequest: Boolean(client && config.onlyTicketsWithPullRequest),
  });
}
