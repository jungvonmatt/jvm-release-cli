/**
 * Files that `jvm-release init` writes.
 */
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChangelogConfig } from "../changelog/types.ts";

/** The config keys `init` commits. Secrets never go in this file. */
export type InitConfig = Pick<ChangelogConfig, "jiraBaseUrl" | "ticketPattern" | "gitProvider">;

export const RC_FILE = ".release-clirc.json";

/** Writes `.release-clirc.json` in `cwd`. Rejects if the file exists. */
export const writeRcFile = async (cwd: string, config: InitConfig): Promise<void> => {
  await writeFile(join(cwd, RC_FILE), `${JSON.stringify(config, null, 2)}\n`, { flag: "wx" });
};

/** Appends `lines` to the file at `path` and creates it if it is missing. */
export const appendLines = async (path: string, lines: string[]): Promise<void> => {
  const content = await readFile(path, "utf8").catch(() => "");
  const separator = content && !content.endsWith("\n") ? "\n" : "";
  await appendFile(path, `${separator}${lines.join("\n")}\n`);
};
