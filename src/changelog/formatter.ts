import type { JiraTicket, GraphNode, ChangelogConfig, PullRequest } from "./types.ts";
import { extractTickets } from "./graph.ts";

/** Hardcoded issue type display order per plan decision #10 */
const TYPE_ORDER = [
  "Epic",
  "Story",
  "Task",
  "Sub-Task",
  "Bug",
  "Technical Improvement",
  "Technical Debt",
  "IT Security",
];

/** Merge commits between protected branches, l10n syncs */
const NOISE_PATTERNS = [
  /^Merge (branch|remote-tracking branch) '.+' into .+$/,
  /^Merge pull request #\d+ from .+$/,
  /^Merge branch '.+' of .+ into .+$/,
  /^\[l10n\]/i,
  /^chore\(l10n\)/i,
];

function isNoiseCommit(subject: string): boolean {
  return NOISE_PATTERNS.some((p) => p.test(subject));
}

const formatPullRequestLink = (pr: PullRequest): string => `[${pr.reference}](${pr.url})`;

const formatAuthors = (pullRequests: PullRequest[]): string => {
  const authors = [...new Set(pullRequests.map((pr) => pr.author).filter(Boolean))];
  return authors.map((author) => `@${author}`).join(", ");
};

/**
 * Formats the changelog as a Markdown string.
 *
 * Groups tickets by issue type in the hardcoded order.
 * Appends an "Other Commits" section for commits without tickets (filtered for noise).
 * With `requirePullRequest`, lists only tickets that are linked to a pull/merge request.
 */
export function formatChangelog(
  nodes: GraphNode[],
  tickets: Map<string, JiraTicket>,
  ticketKeys: string[],
  config: ChangelogConfig,
  { requirePullRequest = false }: { requirePullRequest?: boolean } = {},
): string {
  const sections: string[] = [];
  const pattern = config.ticketPattern ?? "[A-Z]+-\\d+";
  const ticketsByNode = new Map(nodes.map((node) => [node, extractTickets([node], pattern)]));

  // Pull/merge requests per ticket, from the commits that mention the ticket
  const pullRequestsByTicket = new Map<string, PullRequest[]>();
  for (const node of nodes) {
    const pr = node.pullRequest;
    if (!pr) continue;
    for (const key of ticketsByNode.get(node)!) {
      const list = pullRequestsByTicket.get(key) ?? [];
      if (!list.some((p) => p.number === pr.number)) list.push(pr);
      pullRequestsByTicket.set(key, list);
    }
  }

  const listedKeys = requirePullRequest
    ? ticketKeys.filter((key) => pullRequestsByTicket.has(key))
    : ticketKeys;

  if (listedKeys.length > 0) {
    // Group tickets by type
    const grouped = new Map<string, JiraTicket[]>();

    for (const key of listedKeys) {
      const ticket = tickets.get(key);
      if (ticket) {
        const group = grouped.get(ticket.type) ?? [];
        group.push(ticket);
        grouped.set(ticket.type, group);
      } else {
        // Ticket key found in commits but not in Jira (no credentials or API error)
        const fallbackGroup = grouped.get("Tickets") ?? [];
        fallbackGroup.push({ key, summary: key, type: "Tickets", assignee: null });
        grouped.set("Tickets", fallbackGroup);
      }
    }

    // Sort groups by hardcoded order, unknowns appended
    const sortedTypes = [...grouped.keys()].sort((a, b) => {
      const ai = TYPE_ORDER.indexOf(a);
      const bi = TYPE_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

    for (const type of sortedTypes) {
      const group = grouped.get(type)!;
      sections.push(`## ${type}\n`);

      for (const ticket of group) {
        const baseUrl = config.jiraBaseUrl?.replace(/\/$/, "");
        const ticketRef = baseUrl ? `[${ticket.key}](${baseUrl}/browse/${ticket.key})` : ticket.key;
        const summary = ticket.summary !== ticket.key ? ` ${ticket.summary}` : "";
        const pullRequests = pullRequestsByTicket.get(ticket.key) ?? [];
        const links =
          pullRequests.length > 0 ? ` (${pullRequests.map(formatPullRequestLink).join(", ")})` : "";
        // PR authors are the people who did the work; the Jira assignee is the fallback
        const authors = formatAuthors(pullRequests);
        const people = authors ? ` ${authors}` : ticket.assignee ? ` (${ticket.assignee})` : "";
        sections.push(`- ${ticketRef}${summary}${links}${people}`);
      }

      sections.push("");
    }
  }

  // "Other Commits" section: commits without any ticket reference.
  // A merge commit with a known PR is not noise: it is listed by its PR title, once per PR.
  const listedPullRequests = new Set<number>();
  const otherCommits = nodes.filter((node) => {
    if (ticketsByNode.get(node)!.length > 0) return false;
    if (!node.pullRequest) return !isNoiseCommit(node.commit.subject);
    if (listedPullRequests.has(node.pullRequest.number)) return false;
    listedPullRequests.add(node.pullRequest.number);
    return true;
  });

  if (otherCommits.length > 0) {
    sections.push("## Other Commits\n");
    for (const node of otherCommits) {
      const pr = node.pullRequest;
      if (pr) {
        const authors = formatAuthors([pr]);
        sections.push(
          `- ${pr.title} (${formatPullRequestLink(pr)})${authors ? ` ${authors}` : ""}`,
        );
      } else {
        sections.push(`- ${node.commit.subject} (${node.commit.hash.slice(0, 7)})`);
      }
    }
    sections.push("");
  }

  return sections.join("\n").trim() || "No changes detected.";
}
