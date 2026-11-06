// Calls the GitHub or GitLab API with a token, or through the `gh` or `glab` CLI, which reuse
// the CLI's login.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RemoteRepository } from "../git.ts";
import type { Provider } from "./types.ts";

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

/**
 * Sends a request and parses the JSON response. Rejects with
 * "<provider> API returned <status>: <reason>". GitHub and GitLab both give the reason in `message`,
 * for example "Release already exists".
 */
const fetchJson = async (
  providerName: string,
  url: string,
  init: RequestInit,
): Promise<unknown> => {
  const response = await fetch(url, init);
  const json = (await Promise.resolve()
    .then(() => response.json())
    .catch(() => null)) as { message?: unknown } | null;
  if (!response.ok) {
    const reason = typeof json?.message === "string" ? `: ${json.message}` : "";
    throw new Error(`${providerName} API returned ${response.status}${reason}`);
  }
  return json;
};

/** Reads and writes the REST API of one repository. Paths are relative to the API base URL. */
export interface ApiClient {
  get: (path: string) => Promise<unknown>;
  post: (path: string, fields: Record<string, string | boolean>) => Promise<unknown>;
}

/**
 * Creates an API client for `repo`. Uses `token` with the REST API if set, so a CI job needs no
 * CLI, and the provider's CLI login otherwise. Returns `null` if neither is available.
 */
export async function createApiClient(
  provider: Provider,
  repo: RemoteRepository,
  token: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ApiClient | null> {
  if (token) {
    const baseUrl = provider.apiBaseUrl(repo, env);
    const headers = provider.authHeaders(token);
    return {
      get: (path) => fetchJson(provider.name, `${baseUrl}/${path}`, { headers }),
      post: (path, fields) =>
        fetchJson(provider.name, `${baseUrl}/${path}`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(fields),
        }),
    };
  }

  if (await isCommandAvailable(provider.cli)) {
    return {
      get: (path) => cliJson(provider.cli, path, repo.host),
      post: (path, fields) => {
        // `-f` sends a string, so Markdown in the notes is not parsed. `-F` sends a boolean.
        const args = Object.entries(fields).flatMap(([key, value]) => [
          typeof value === "string" ? "-f" : "-F",
          `${key}=${value}`,
        ]);
        return cliJson(provider.cli, path, repo.host, ["--method", "POST", ...args]);
      },
    };
  }

  return null;
}
