// Calls the GitHub or GitLab API through the `gh` or `glab` CLI, which reuse the CLI's login.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const isCommandAvailable = async (command: string): Promise<boolean> => {
  try {
    await execFileAsync(command, ["--version"]);
    return true;
  } catch {
    return false;
  }
};

/** An expired, revoked or missing `gh`/`glab` login. */
const CLI_AUTH_ERROR = /\b401\b|unauthorized|bad credentials|invalid_grant/i;

/**
 * Runs `gh api` or `glab api` for `path` and parses the JSON response.
 * `args` adds flags, for example `--method POST` and `-f key=value` fields.
 */
export const cliJson = async (
  command: string,
  path: string,
  host: string,
  args: string[] = [],
): Promise<unknown> => {
  try {
    const { stdout } = await execFileAsync(command, ["api", path, "--hostname", host, ...args], {
      maxBuffer: 10 * 1024 * 1024,
      // A shell-wide CLICOLOR_FORCE makes gh color its JSON even when piped
      env: { ...process.env, NO_COLOR: "1", CLICOLOR_FORCE: "0" },
    });
    return JSON.parse(stdout);
  } catch (error) {
    // glab boxes its errors: an "ERROR" banner, padding and hard line breaks
    const stderr = (error as { stderr?: string }).stderr
      ?.replace(/\s+/g, " ")
      .trim()
      .replace(/^ERROR /, "");
    const message = stderr || (error as Error).message;
    throw new Error(
      CLI_AUTH_ERROR.test(message)
        ? `${message} Run \`${command} auth login --hostname ${host}\` and try again.`
        : message,
    );
  }
};
