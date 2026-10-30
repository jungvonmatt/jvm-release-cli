import { loadConfig } from "@jungvonmatt/config-loader";
import type { ChangelogConfig } from "./changelog/types.ts";

/**
 * Adds `https://` to a bare host such as `myorg.atlassian.net`.
 * `jira-changelog` configs set the Jira API host without a protocol.
 */
const withProtocol = (url: string): string => (/^https?:\/\//i.test(url) ? url : `https://${url}`);

export async function loadChangelogConfig(cwd?: string): Promise<ChangelogConfig> {
  const isCI = Boolean(process.env.CI);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await loadConfig<any>({
    name: "release-cli",
    cwd,
    envMap: {
      CHANGELOG_JIRA_API_HOST: "jiraApiHost",
      CHANGELOG_JIRA_API_EMAIL: "jiraApiEmail",
      CHANGELOG_JIRA_API_TOKEN: "jiraApiToken",
      CHANGELOG_JIRA_BASEURL: "jiraBaseUrl",
      CHANGELOG_GITHUB_API_TOKEN: "githubToken",
      CHANGELOG_GITLAB_API_TOKEN: "gitlabToken",
    },
    required: isCI ? ["jiraBaseUrl"] : undefined,
    prompts: false,
    defaults: {
      ticketPattern: "[A-Z]+-\\d+",
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
