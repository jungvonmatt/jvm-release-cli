/**
 * Read-only checks for `jvm-release init`: what the repository already has and what it suggests.
 */
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Config files that `@jungvonmatt/config-loader` reads for the name `release-cli`. */
const CONFIG_FILE = /^(\.release-clirc(\.[a-z]+)?|release-cli\.config\.[a-z0-9]+)$/;

/**
 * Returns the config source in `cwd` (a file name, or `package.json` for its `release-cli` key),
 * or `null` if there is none.
 */
export const findExistingConfig = async (cwd: string): Promise<string | null> => {
  const names = (await readdir(cwd)).sort();
  const configFile = names.find((name) => CONFIG_FILE.test(name));
  if (configFile) return configFile;

  try {
    const pkg = JSON.parse(await readFile(join(cwd, "package.json"), "utf8")) as object;
    return "release-cli" in pkg ? "package.json" : null;
  } catch {
    // A missing or malformed package.json holds no config
    return null;
  }
};

/** Checks whether a provider CLI such as `gh` or `glab` is installed and logged in for `host`. */
export const isCliLoggedIn = async (command: string, host: string): Promise<boolean> => {
  try {
    await execFileAsync(command, ["auth", "status", "--hostname", host]);
    return true;
  } catch {
    return false;
  }
};

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
