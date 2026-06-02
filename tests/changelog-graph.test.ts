import { describe, expect, test } from "vite-plus/test";
import { buildGraph, extractTickets } from "../src/changelog/graph.ts";
import type { CommitLog, GraphNode } from "../src/changelog/types.ts";

function makeCommit(overrides: Partial<CommitLog> = {}): CommitLog {
  return {
    hash: overrides.hash ?? "abc1234",
    parents: overrides.parents ?? [],
    date: overrides.date ?? "2025-01-01 12:00:00 +0000",
    subject: overrides.subject ?? "test commit",
    body: overrides.body ?? "",
    authorName: overrides.authorName ?? "Test Author",
    authorEmail: overrides.authorEmail ?? "test@example.com",
  };
}

describe("buildGraph", () => {
  test("returns empty array for empty input", () => {
    expect(buildGraph([])).toEqual([]);
  });

  test("single commit becomes a single graph node", () => {
    const commit = makeCommit({ hash: "aaa", parents: [] });
    const result = buildGraph([commit]);

    expect(result).toHaveLength(1);
    expect(result[0]!.commit.hash).toBe("aaa");
    expect(result[0]!.merged).toEqual([]);
  });

  test("linear history — all commits on mainline", () => {
    const commits: CommitLog[] = [
      makeCommit({ hash: "ccc", parents: ["bbb"] }),
      makeCommit({ hash: "bbb", parents: ["aaa"] }),
      makeCommit({ hash: "aaa", parents: [] }),
    ];
    const result = buildGraph(commits);

    expect(result).toHaveLength(3);
    expect(result.map((n) => n.commit.hash)).toEqual(["ccc", "bbb", "aaa"]);
    expect(result.every((n) => n.merged.length === 0)).toBe(true);
  });

  test("merge commit nests branch commits", () => {
    // Mainline: A ← B ← C(merge) ← D
    // Branch:             ↖ b1 ← b2
    const commits: CommitLog[] = [
      makeCommit({ hash: "ddd", parents: ["ccc"] }),
      makeCommit({ hash: "ccc", parents: ["bbb", "b2b"] }), // merge
      makeCommit({ hash: "b2b", parents: ["b1b"], subject: "branch commit 2" }),
      makeCommit({ hash: "b1b", parents: ["bbb"], subject: "branch commit 1" }),
      makeCommit({ hash: "bbb", parents: ["aaa"] }),
      makeCommit({ hash: "aaa", parents: [] }),
    ];

    const result = buildGraph(commits);

    // Mainline should be D, C, B, A
    expect(result.map((n) => n.commit.hash)).toEqual(["ddd", "ccc", "bbb", "aaa"]);

    // C should have b1 and b2 as merged
    const mergeNode = result.find((n) => n.commit.hash === "ccc")!;
    expect(mergeNode.merged).toHaveLength(2);
    expect(mergeNode.merged.map((c) => c.hash).sort()).toEqual(["b1b", "b2b"]);
  });

  test("consolidated fullText includes branch commit messages", () => {
    const commits: CommitLog[] = [
      makeCommit({ hash: "merge1", parents: ["base", "feat1"], subject: "Merge feat" }),
      makeCommit({
        hash: "feat1",
        parents: ["base"],
        subject: "CPP-1234 add feature",
        body: "Resolves CPP-5678",
      }),
      makeCommit({ hash: "base", parents: [] }),
    ];

    const result = buildGraph(commits);
    const mergeNode = result.find((n) => n.commit.hash === "merge1")!;

    expect(mergeNode.fullText).toContain("Merge feat");
    expect(mergeNode.fullText).toContain("CPP-1234 add feature");
    expect(mergeNode.fullText).toContain("Resolves CPP-5678");
  });

  test("revert detection excludes reverted commits", () => {
    const commits: CommitLog[] = [
      makeCommit({
        hash: "aaa111",
        parents: ["bbb222"],
        subject: 'Revert "add feature"',
        body: "This reverts commit bbb222.",
      }),
      makeCommit({ hash: "bbb222", parents: ["ccc333"], subject: "add feature" }),
      makeCommit({ hash: "ccc333", parents: [] }),
    ];

    const result = buildGraph(commits);
    // Revert commit excludes both itself and the reverted commit from fullText
    const revertNode = result.find((n) => n.commit.hash === "aaa111")!;
    expect(revertNode.fullText).toBe("");

    const featNode = result.find((n) => n.commit.hash === "bbb222")!;
    expect(featNode.fullText).toBe("");
  });

  test("double-revert (unrevert) keeps the commit", () => {
    const commits: CommitLog[] = [
      makeCommit({
        hash: "ddd444",
        parents: ["aaa111"],
        subject: 'Revert "Revert "add feature""',
        body: "This reverts commit aaa111.",
      }),
      makeCommit({
        hash: "aaa111",
        parents: ["bbb222"],
        subject: 'Revert "add feature"',
        body: "This reverts commit bbb222.",
      }),
      makeCommit({ hash: "bbb222", parents: ["ccc333"], subject: "CPP-1000 add feature" }),
      makeCommit({ hash: "ccc333", parents: [] }),
    ];

    const result = buildGraph(commits);
    // The unrevert (even revert depth) should retain its text
    const unrevertNode = result.find((n) => n.commit.hash === "ddd444")!;
    expect(unrevertNode.fullText).toContain("Revert");
  });
});

describe("extractTickets", () => {
  test("extracts tickets from fullText using default pattern", () => {
    const nodes: GraphNode[] = [
      {
        commit: makeCommit({ hash: "a" }),
        fullText: "CPP-1234 did something\nSCAYLE-5678 other thing",
        merged: [],
      },
      {
        commit: makeCommit({ hash: "b" }),
        fullText: "no ticket here",
        merged: [],
      },
    ];

    const tickets = extractTickets(nodes, "[A-Z]+-\\d+");
    expect(tickets).toContain("CPP-1234");
    expect(tickets).toContain("SCAYLE-5678");
    expect(tickets).toHaveLength(2);
  });

  test("deduplicates ticket IDs", () => {
    const nodes: GraphNode[] = [
      {
        commit: makeCommit({ hash: "a" }),
        fullText: "CPP-1234 first mention",
        merged: [],
      },
      {
        commit: makeCommit({ hash: "b" }),
        fullText: "CPP-1234 second mention",
        merged: [],
      },
    ];

    const tickets = extractTickets(nodes, "[A-Z]+-\\d+");
    expect(tickets).toEqual(["CPP-1234"]);
  });

  test("uses capture group when present in pattern", () => {
    const nodes: GraphNode[] = [
      {
        commit: makeCommit({ hash: "a" }),
        fullText: "feat(CPP-1234): something",
        merged: [],
      },
    ];

    const tickets = extractTickets(nodes, "((CPP|SCAYLE)-\\d+)");
    expect(tickets).toContain("CPP-1234");
  });

  test("returns empty array when no tickets found", () => {
    const nodes: GraphNode[] = [
      {
        commit: makeCommit({ hash: "a" }),
        fullText: "just a regular commit",
        merged: [],
      },
    ];

    const tickets = extractTickets(nodes, "[A-Z]+-\\d+");
    expect(tickets).toEqual([]);
  });
});
