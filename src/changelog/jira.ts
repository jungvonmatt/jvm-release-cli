import type { JiraTicket, ChangelogConfig } from "./types.ts";

/**
 * Fetches ticket metadata from Jira via bulk JQL search.
 * Returns a Map of ticket key → JiraTicket.
 * Falls back gracefully (returns empty map) if credentials are missing or API fails.
 */
export async function fetchJiraTickets(
  ticketKeys: string[],
  config: ChangelogConfig,
): Promise<Map<string, JiraTicket>> {
  const result = new Map<string, JiraTicket>();

  if (ticketKeys.length === 0) return result;

  const host = config.jiraApiHost ?? config.jiraBaseUrl;
  const email = config.jiraApiEmail;
  const token = config.jiraApiToken;

  if (!host || !email || !token) {
    console.warn("⚠️  Jira credentials not configured. Falling back to raw commit summaries.");
    return result;
  }

  // Jira JQL has a limit on query length, batch in groups of 50
  const batches: string[][] = [];
  for (let i = 0; i < ticketKeys.length; i += 50) {
    batches.push(ticketKeys.slice(i, i + 50));
  }

  for (const batch of batches) {
    const jql = `key IN (${batch.join(",")})`;
    const apiUrl = `${host.replace(/\/$/, "")}/rest/api/3/search`;

    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${email}:${token}`)}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          jql,
          fields: ["summary", "issuetype", "assignee"],
          maxResults: batch.length,
        }),
      });

      if (!response.ok) {
        console.warn(`⚠️  Jira API returned ${response.status}. Falling back to raw ticket IDs.`);
        continue;
      }

      const data = (await response.json()) as {
        issues: Array<{
          key: string;
          fields: {
            summary: string;
            issuetype: { name: string };
            assignee: { displayName: string } | null;
          };
        }>;
      };

      for (const issue of data.issues) {
        result.set(issue.key, {
          key: issue.key,
          summary: issue.fields.summary,
          type: issue.fields.issuetype.name,
          assignee: issue.fields.assignee?.displayName ?? null,
        });
      }
    } catch (error) {
      console.warn(
        `⚠️  Failed to fetch Jira tickets: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return result;
}
