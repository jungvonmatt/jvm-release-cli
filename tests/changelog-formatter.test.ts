import { describe, expect, test } from "vite-plus/test";
import { formatChangelog } from "../src/changelog/formatter.ts";
import type { GraphNode, JiraTicket, ChangelogConfig } from "../src/changelog/types.ts";

const baseConfig: ChangelogConfig = {
  jiraBaseUrl: "https://myorg.atlassian.net",
  ticketPattern: "[A-Z]+-\\d+",
};

function makeNode(hash: string, subject: string, fullText?: string): GraphNode {
  return {
    commit: {
      hash,
      parents: [],
      date: "2025-01-01",
      subject,
      body: "",
      authorName: "Author",
      authorEmail: "a@b.com",
    },
    fullText: fullText ?? subject,
    merged: [],
  };
}

describe("formatChangelog", () => {
  test("groups tickets by type in correct order", () => {
    const nodes = [makeNode("aaa", "CPP-1 something", "CPP-1 CPP-2")];
    const tickets = new Map<string, JiraTicket>([
      ["CPP-1", { key: "CPP-1", summary: "Fix bug", type: "Bug", assignee: "Alice" }],
      ["CPP-2", { key: "CPP-2", summary: "New feature", type: "Story", assignee: null }],
    ]);

    const result = formatChangelog(nodes, tickets, ["CPP-1", "CPP-2"], baseConfig);

    // Story should come before Bug per hardcoded order
    const storyPos = result.indexOf("## Story");
    const bugPos = result.indexOf("## Bug");
    expect(storyPos).toBeLessThan(bugPos);
    expect(result).toContain("[CPP-1](https://myorg.atlassian.net/browse/CPP-1) Fix bug (Alice)");
    expect(result).toContain("[CPP-2](https://myorg.atlassian.net/browse/CPP-2) New feature");
  });

  test("shows Other Commits for commits without tickets", () => {
    const nodes = [makeNode("aaa", "chore: update deps", "chore: update deps")];
    const tickets = new Map<string, JiraTicket>();

    const result = formatChangelog(nodes, tickets, [], baseConfig);
    expect(result).toContain("## Other Commits");
    expect(result).toContain("chore: update deps (aaa");
  });

  test("filters noise commits", () => {
    const nodes = [
      makeNode("aaa", "Merge branch 'main' into feature", "Merge branch 'main' into feature"),
      makeNode("bbb", "[l10n] sync translations", "[l10n] sync translations"),
      makeNode("ccc", "real commit", "real commit"),
    ];
    const tickets = new Map<string, JiraTicket>();

    const result = formatChangelog(nodes, tickets, [], baseConfig);
    expect(result).not.toContain("Merge branch");
    expect(result).not.toContain("[l10n]");
    expect(result).toContain("real commit");
  });

  test("returns fallback for empty input", () => {
    const result = formatChangelog([], new Map(), [], baseConfig);
    expect(result).toBe("No changes detected.");
  });

  test("shows ticket keys as fallback when Jira data is missing", () => {
    const nodes = [makeNode("aaa", "CPP-99 something", "CPP-99 something")];
    const tickets = new Map<string, JiraTicket>(); // empty — no Jira data

    const result = formatChangelog(nodes, tickets, ["CPP-99"], baseConfig);
    expect(result).toContain("CPP-99");
    expect(result).toContain("## Tickets");
  });
});
