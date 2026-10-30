/**
 * Read-only checks for `jvm-release init`: what the repository already has and what it suggests.
 */

/** Prefixes that look like ticket keys but name encodings and standards (`UTF-8`, `RFC-2119`). */
const IGNORED_PREFIXES = new Set(["CVE", "ISO", "RFC", "SHA", "UTF"]);

/**
 * Suggests a ticket pattern from the Jira keys in commit messages, e.g. `((LEV|SFA)-\d+)`.
 * Keeps the five most frequent prefixes seen at least twice. Group 1 captures the whole key.
 */
export const inferTicketPattern = (messages: string): string | null => {
  const counts = new Map<string, number>();
  // No trailing \b, so keys in branch names such as `LEV-658_foo` match too
  for (const [, prefix] of messages.matchAll(/\b([A-Z][A-Z0-9]+)-\d+/g)) {
    if (!IGNORED_PREFIXES.has(prefix!)) {
      counts.set(prefix!, (counts.get(prefix!) ?? 0) + 1);
    }
  }

  const prefixes = [...counts]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([prefix]) => prefix)
    .sort();

  if (prefixes.length === 0) return null;
  if (prefixes.length === 1) return `(${prefixes[0]}-\\d+)`;
  return `((${prefixes.join("|")})-\\d+)`;
};
