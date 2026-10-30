import { loadConfig } from "@jungvonmatt/config-loader";
import type { ChangelogConfig } from "./changelog/types.ts";

/**
 * Adds `https://` to a bare host such as `myorg.atlassian.net`.
 * `jira-changelog` configs set the Jira API host without a protocol.
 */
export const withProtocol = (url: string): string =>
  /^https?:\/\//i.test(url) ? url : `https://${url}`;

export const DEFAULT_TICKET_PATTERN = "[A-Z]+-\\d+";

/** Environment variable for each config key. A `.env` file in the working directory is loaded too. */
export const ENV_VARS = {
  jiraApiHost: "CHANGELOG_JIRA_API_HOST",
  jiraApiEmail: "CHANGELOG_JIRA_API_EMAIL",
  jiraApiToken: "CHANGELOG_JIRA_API_TOKEN",
  jiraBaseUrl: "CHANGELOG_JIRA_BASEURL",
  githubToken: "CHANGELOG_GITHUB_API_TOKEN",
  gitlabToken: "CHANGELOG_GITLAB_API_TOKEN",
} as const satisfies Partial<Record<keyof ChangelogConfig, string>>;

export async function loadChangelogConfig(cwd?: string): Promise<ChangelogConfig> {
  const isCI = Boolean(process.env.CI);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await loadConfig<any>({
    name: "release-cli",
    cwd,
    envMap: Object.fromEntries(Object.entries(ENV_VARS).map(([key, envVar]) => [envVar, key])),
    required: isCI ? ["jiraBaseUrl"] : undefined,
    prompts: false,
    defaults: {
      ticketPattern: DEFAULT_TICKET_PATTERN,
    },
  });

  if (isCI && result.missing.length > 0) {
    throw new Error(
      `Missing required changelog config: ${result.missing.join(", ")}.\n` +
        `Provide via environment variables or a config file (e.g. .release-clirc.json).`,
    );
  }

  const config = result.config as ChangelogConfig;

  return {
    ...config,
    jiraBaseUrl: config.jiraBaseUrl && withProtocol(config.jiraBaseUrl),
    jiraApiHost: config.jiraApiHost && withProtocol(config.jiraApiHost),
  };
}
