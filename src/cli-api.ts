// Calls the GitHub or GitLab API with a token, or through the `gh` or `glab` CLI, which reuse
// the CLI's login.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** GitHub REST API version, see https://docs.github.com/rest/about-the-rest-api/api-versions */
export const GITHUB_API_VERSION = "2022-11-28";

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

/**
 * Sends `body` as JSON with a POST request and parses the JSON response. Rejects with
 * "<provider> API returned <status>: <reason>". GitHub and GitLab both give the reason in `message`,
 * for example "Release already exists".
 */
export const postJson = async (
  provider: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<unknown> => {
  const response = await fetch(url, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => null)) as { message?: unknown } | null;
  if (!response.ok) {
    const reason = typeof json?.message === "string" ? `: ${json.message}` : "";
    throw new Error(`${provider} API returned ${response.status}${reason}`);
  }
  return json;
};
