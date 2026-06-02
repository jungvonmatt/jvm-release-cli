import type { CommitLog, GraphNode } from "./types.ts";

const REVERT_PATTERN = /^Revert "(.+)"$/;
const REVERT_SHA_PATTERN = /This reverts commit ([0-9a-f]+)\./;

/**
 * Counts consecutive "Revert" prefixes to determine if a commit is truly reverted.
 * Odd count = actual revert (exclude), Even count = unrevert (keep).
 */
function countRevertPrefixes(subject: string): number {
  let count = 0;
  let s = subject;
  while (REVERT_PATTERN.test(s)) {
    count++;
    s = s.match(REVERT_PATTERN)![1]!;
  }
  return count;
}

/**
 * Detects reverted commit SHAs from the commit body.
 * Returns the SHA if this commit is an actual revert (odd revert depth).
 */
function getRevertedSha(commit: CommitLog): string | null {
  const prefixCount = countRevertPrefixes(commit.subject);
  if (prefixCount === 0) return null;

  // Odd number of "Revert" prefixes = actual revert
  if (prefixCount % 2 === 1) {
    const match = commit.body.match(REVERT_SHA_PATTERN);
    return match ? match[1]! : null;
  }

  return null;
}

/**
 * Builds a first-parent graph from a flat list of commits.
 *
 * Walks the first-parent chain to identify mainline commits,
 * then nests all non-mainline commits under their merge commit.
 * Consolidates fullText for ticket extraction.
 */
export function buildGraph(commits: CommitLog[]): GraphNode[] {
  if (commits.length === 0) return [];

  const commitMap = new Map<string, CommitLog>();
  for (const commit of commits) {
    commitMap.set(commit.hash, commit);
  }

  // Find reverted SHAs to exclude
  const revertedShas = new Set<string>();
  for (const commit of commits) {
    const revertedSha = getRevertedSha(commit);
    if (revertedSha) {
      revertedShas.add(revertedSha);
      // Also exclude the revert commit itself from contributing text
      revertedShas.add(commit.hash);
    }
  }

  // Walk first-parent chain to identify mainline
  const mainlineShas = new Set<string>();
  let current: CommitLog | undefined = commits[0];
  while (current) {
    mainlineShas.add(current.hash);
    const firstParent: string | undefined = current.parents[0];
    current = firstParent ? commitMap.get(firstParent) : undefined;
  }

  // Group non-mainline commits under the mainline commit they were merged into
  // A branch commit belongs to the first mainline commit whose second parent's
  // reachable set includes it. Simplified: commits between two mainline commits
  // that aren't on the mainline themselves.
  const mainlineCommits = commits.filter((c) => mainlineShas.has(c.hash));
  const branchCommits = commits.filter((c) => !mainlineShas.has(c.hash));

  // Build merge map: for each mainline merge commit (2+ parents),
  // collect all branch commits reachable from non-first parents
  const mergeMap = new Map<string, CommitLog[]>();

  for (const mc of mainlineCommits) {
    if (mc.parents.length > 1) {
      // This is a merge commit — find branch commits that belong to it
      const reachable = new Set<string>();
      const queue = mc.parents.slice(1); // non-first parents

      while (queue.length > 0) {
        const sha = queue.pop()!;
        if (reachable.has(sha) || mainlineShas.has(sha)) continue;
        reachable.add(sha);
        const commit = commitMap.get(sha);
        if (commit) {
          for (const parent of commit.parents) {
            queue.push(parent);
          }
        }
      }

      const merged = branchCommits.filter((c) => reachable.has(c.hash));
      mergeMap.set(mc.hash, merged);
    }
  }

  // Build graph nodes with consolidated fullText
  return mainlineCommits.map((commit) => {
    const merged = mergeMap.get(commit.hash) ?? [];

    // Consolidate text for ticket extraction, excluding reverted commits
    const texts: string[] = [];

    if (!revertedShas.has(commit.hash)) {
      texts.push(commit.subject, commit.body);
    }

    for (const m of merged) {
      if (!revertedShas.has(m.hash)) {
        texts.push(m.subject, m.body);
      }
    }

    return {
      commit,
      fullText: texts.filter(Boolean).join("\n"),
      merged,
    };
  });
}

/**
 * Extracts unique ticket IDs from graph nodes using the given regex pattern.
 */
export function extractTickets(nodes: GraphNode[], pattern: string): string[] {
  const regex = new RegExp(pattern, "g");
  const tickets = new Set<string>();

  for (const node of nodes) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(node.fullText)) !== null) {
      tickets.add(match[1] ?? match[0]);
    }
  }

  return [...tickets];
}
