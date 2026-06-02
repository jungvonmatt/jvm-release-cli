import type { JiraTicket, GraphNode, ChangelogConfig } from "./types.ts";

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

/**
 * Formats the changelog as a Markdown string.
 *
 * Groups tickets by issue type in the hardcoded order.
 * Appends an "Other Commits" section for commits without tickets (filtered for noise).
 */
export function formatChangelog(
  nodes: GraphNode[],
  tickets: Map<string, JiraTicket>,
  ticketKeys: string[],
  config: ChangelogConfig,
): string {
  const sections: string[] = [];

  if (ticketKeys.length > 0) {
    // Group tickets by type
    const grouped = new Map<string, JiraTicket[]>();

    for (const key of ticketKeys) {
      const ticket = tickets.get(key);
      if (ticket) {
        const group = grouped.get(ticket.type) ?? [];
        group.push(ticket);
        grouped.set(ticket.type, group);
      } else {
        // Ticket key found in commits but not in Jira (no credentials or API error)
        const fallbackGroup = grouped.get("Unknown") ?? [];
        fallbackGroup.push({ key, summary: key, type: "Unknown", assignee: null });
        grouped.set("Unknown", fallbackGroup);
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
        const link = `${config.jiraBaseUrl.replace(/\/$/, "")}/browse/${ticket.key}`;
        const assigneeStr = ticket.assignee ? ` (${ticket.assignee})` : "";
        sections.push(`- [${ticket.key}](${link}) ${ticket.summary}${assigneeStr}`);
      }

      sections.push("");
    }
  }

  // "Other Commits" section: commits without any ticket reference
  const ticketPattern = new RegExp(ticketKeys.map(escapeRegex).join("|"));
  const otherCommits = nodes.filter((node) => {
    if (ticketKeys.length > 0 && ticketPattern.test(node.fullText)) return false;
    if (isNoiseCommit(node.commit.subject)) return false;
    return true;
  });

  if (otherCommits.length > 0) {
    sections.push("## Other Commits\n");
    for (const node of otherCommits) {
      const shortHash = node.commit.hash.slice(0, 7);
      sections.push(`- ${node.commit.subject} (${shortHash})`);
    }
    sections.push("");
  }

  return sections.join("\n").trim() || "No changes detected.";
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
