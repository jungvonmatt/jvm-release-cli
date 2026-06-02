import { loadConfig } from "@jungvonmatt/config-loader";
import type { ChangelogConfig } from "./changelog/types.ts";

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
    },
    required: isCI ? ["jiraBaseUrl"] : undefined,
    prompt: isCI ? undefined : ["jiraBaseUrl", "ticketPattern"],
    prompts: isCI
      ? false
      : [
          {
            type: "input",
            name: "jiraBaseUrl",
            message: "Jira base URL (e.g. https://myorg.atlassian.net)",
          },
          {
            type: "input",
            name: "ticketPattern",
            message: "Ticket regex pattern (default: [A-Z]+-\\d+)",
          },
        ],
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

  return result.config as ChangelogConfig;
}
