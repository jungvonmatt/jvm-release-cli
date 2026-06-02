import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { CommitLog } from "./types.ts";

const execa = promisify(exec);

const FIELD_SEPARATOR = "---GIT-LOG-SEP---";
const COMMIT_SEPARATOR = "---GIT-LOG-COMMIT---";

const FORMAT = [
  "%H", // hash
  "%P", // parent hashes (space-separated)
  "%ai", // author date ISO
  "%s", // subject
  "%b", // body
  "%aN", // author name
  "%ae", // author email
].join(FIELD_SEPARATOR);

/**
 * Fetches a structured git log for the given range.
 * Supports both symmetric (`from...to`) and asymmetric (`from..to`) ranges.
 */
export async function getGitLog(range: string): Promise<CommitLog[]> {
  const { stdout } = await execa(`git log --format="${COMMIT_SEPARATOR}${FORMAT}" ${range}`, {
    maxBuffer: 10 * 1024 * 1024,
  });

  if (!stdout.trim()) {
    return [];
  }

  const rawCommits = stdout.split(COMMIT_SEPARATOR).filter((s) => s.trim());

  return rawCommits.map((raw) => {
    const fields = raw.split(FIELD_SEPARATOR);
    return {
      hash: fields[0]!.trim(),
      parents: fields[1]!.trim().split(" ").filter(Boolean),
      date: fields[2]!.trim(),
      subject: fields[3]!.trim(),
      body: fields[4]!.trim(),
      authorName: fields[5]!.trim(),
      authorEmail: fields[6]!.trim(),
    };
  });
}
