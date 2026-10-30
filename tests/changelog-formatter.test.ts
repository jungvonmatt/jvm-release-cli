import { describe, expect, test } from "vite-plus/test";
import { formatChangelog } from "../src/changelog/formatter.ts";
import type {
  GraphNode,
  JiraTicket,
  ChangelogConfig,
  PullRequest,
} from "../src/changelog/types.ts";

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
    const nodes = [makeNode("aaa", "PROJ-1 something", "PROJ-1 PROJ-2")];
    const tickets = new Map<string, JiraTicket>([
      ["PROJ-1", { key: "PROJ-1", summary: "Fix bug", type: "Bug", assignee: "Alice" }],
      ["PROJ-2", { key: "PROJ-2", summary: "New feature", type: "Story", assignee: null }],
    ]);

    const result = formatChangelog(nodes, tickets, ["PROJ-1", "PROJ-2"], baseConfig);

    // Story should come before Bug per hardcoded order
    const storyPos = result.indexOf("## Story");
    const bugPos = result.indexOf("## Bug");
    expect(storyPos).toBeLessThan(bugPos);
    expect(result).toContain("[PROJ-1](https://myorg.atlassian.net/browse/PROJ-1) Fix bug (Alice)");
    expect(result).toContain("[PROJ-2](https://myorg.atlassian.net/browse/PROJ-2) New feature");
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
    const nodes = [makeNode("aaa", "PROJ-99 something", "PROJ-99 something")];
    const tickets = new Map<string, JiraTicket>(); // empty — no Jira data

    const result = formatChangelog(nodes, tickets, ["PROJ-99"], baseConfig);
    expect(result).toContain("PROJ-99");
    expect(result).toContain("## Tickets");
  });
});

describe("formatChangelog with pull requests", () => {
  const pr = (number: number, title: string, author: string | null = "alice"): PullRequest => ({
    number,
    reference: `#${number}`,
    title,
    sourceBranch: "feature/x",
    author,
    url: `https://github.com/acme/shop/pull/${number}`,
  });

  const withPr = (node: GraphNode, pullRequest: PullRequest): GraphNode => ({
    ...node,
    pullRequest,
  });

  test("lists every ticket when Jira data is missing", () => {
    const nodes = [
      makeNode("aaa", "PROJ-1 a"),
      makeNode("bbb", "PROJ-2 b"),
      makeNode("ccc", "PROJ-3 c"),
    ];

    const result = formatChangelog(nodes, new Map(), ["PROJ-1", "PROJ-2", "PROJ-3"], baseConfig);

    expect(result).toContain("PROJ-1");
    expect(result).toContain("PROJ-2");
    expect(result).toContain("PROJ-3");
  });

  test("adds PR links and authors to tickets instead of the Jira assignee", () => {
    const nodes = [
      withPr(makeNode("aaa", "PROJ-1 part one (#12)"), pr(12, "PROJ-1 part one")),
      withPr(makeNode("bbb", "PROJ-1 part two (#13)"), pr(13, "PROJ-1 part two", "bob")),
    ];
    const tickets = new Map<string, JiraTicket>([
      ["PROJ-1", { key: "PROJ-1", summary: "Basket", type: "Story", assignee: "Alice A." }],
    ]);

    const result = formatChangelog(nodes, tickets, ["PROJ-1"], baseConfig);

    expect(result).toContain(
      "- [PROJ-1](https://myorg.atlassian.net/browse/PROJ-1) Basket " +
        "([#12](https://github.com/acme/shop/pull/12), [#13](https://github.com/acme/shop/pull/13)) @alice, @bob",
    );
    expect(result).not.toContain("Alice A.");
  });

  test("keeps the Jira assignee when no PR is linked", () => {
    const nodes = [makeNode("aaa", "PROJ-1 direct push")];
    const tickets = new Map<string, JiraTicket>([
      ["PROJ-1", { key: "PROJ-1", summary: "Basket", type: "Story", assignee: "Alice A." }],
    ]);

    const result = formatChangelog(nodes, tickets, ["PROJ-1"], baseConfig);

    expect(result).toContain("Basket (Alice A.)");
  });

  test("lists a ticket-less merge commit by its PR title", () => {
    const nodes = [
      withPr(
        makeNode("aaa1111", "Merge pull request #894 from acme/fix/vue-warnings"),
        pr(894, "Fix vue warnings"),
      ),
    ];

    const result = formatChangelog(nodes, new Map(), [], baseConfig);

    expect(result).toContain(
      "- Fix vue warnings ([#894](https://github.com/acme/shop/pull/894)) @alice",
    );
    expect(result).not.toContain("Merge pull request");
  });

  test("requirePullRequest drops tickets without a PR", () => {
    const nodes = [
      withPr(makeNode("aaa", "PROJ-1 with PR (#12)"), pr(12, "PROJ-1 with PR")),
      makeNode("bbb", "PROJ-2 direct push"),
    ];

    const result = formatChangelog(nodes, new Map(), ["PROJ-1", "PROJ-2"], baseConfig, {
      requirePullRequest: true,
    });

    expect(result).toContain("PROJ-1");
    expect(result).not.toContain("PROJ-2");
  });
});
