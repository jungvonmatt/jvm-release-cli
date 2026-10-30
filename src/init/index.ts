/* eslint-disable no-console */
// `jvm-release init`: asks a few questions and creates `.release-clirc.json`.
//
// Only non-secret keys go into that file, because teams commit it. The Jira credentials go
// into `.env`, and only when git ignores `.env`.

import { resolve, join } from "node:path";
import { defineCommand } from "citty";
import pc from "picocolors";
import { confirm, input, password, select } from "@inquirer/prompts";
import {
  detectProvider,
  getRecentCommitMessages,
  getRemoteRepository,
  isGitIgnored,
} from "../git.ts";
import { DEFAULT_TICKET_PATTERN, ENV_VARS, loadChangelogConfig, withProtocol } from "../config.ts";
import { verifyJiraCredentials } from "../changelog/jira.ts";
import type { GitProvider } from "../changelog/types.ts";
import { isPromptCancel } from "../ui.ts";
import { findExistingConfig, inferTicketPattern, isCliLoggedIn } from "./detect.ts";
import { appendLines, RC_FILE, writeRcFile } from "./files.ts";

const isValidRegExp = (value: string): boolean => {
  try {
    RegExp(value);
    return true;
  } catch {
    return false;
  }
};

/**
 * Runs the interactive setup in `cwd`. Git helpers run in `process.cwd()`, so the caller
 * changes into `cwd` first.
 */
export async function runInit(cwd: string): Promise<void> {
  const existing = await findExistingConfig(cwd);
  if (existing) {
    console.log(`Config already exists in ${existing}. Edit that file instead.`);
    return;
  }

  // Includes the environment and `.env`, so credentials that are already set are not asked again
  const current = await loadChangelogConfig(cwd);
  const repo = await getRemoteRepository();
  const detected = repo ? detectProvider(repo.host) : null;

  const jiraBaseUrl = withProtocol(
    await input({
      message: "Jira base URL (e.g. https://myorg.atlassian.net)",
      default: current.jiraBaseUrl,
      required: true,
    }),
  );

  const ticketPattern = await input({
    message: "Ticket pattern (regex)",
    default: inferTicketPattern(await getRecentCommitMessages()) ?? DEFAULT_TICKET_PATTERN,
    validate: (value) => isValidRegExp(value) || "Enter a valid regular expression.",
  });

  const gitProvider =
    repo && !detected
      ? await select<GitProvider>({
          message: `Is ${repo.host} a GitHub or GitLab host?`,
          choices: [
            { name: "GitHub", value: "github" },
            { name: "GitLab", value: "gitlab" },
          ],
        })
      : undefined;

  const secrets: Record<string, string> = {};
  let addEnvToGitignore = false;

  if (
    (!current.jiraApiEmail || !current.jiraApiToken) &&
    (await confirm({
      message: "Add Jira API credentials? Without them the changelog lists raw commit summaries.",
      default: true,
    }))
  ) {
    const email = await input({
      message: "Jira account email",
      default: current.jiraApiEmail,
      required: true,
    });
    const token = await password({
      message: "Jira API token",
      mask: true,
      validate: (value) => value.length > 0 || "Enter the API token.",
    });

    const accepted = await verifyJiraCredentials({
      jiraBaseUrl,
      jiraApiHost: current.jiraApiHost,
      jiraApiEmail: email,
      jiraApiToken: token,
    });
    console.log(
      accepted
        ? pc.green("✓ Jira accepted the credentials.")
        : pc.yellow("⚠️  Jira rejected the credentials or is unreachable. Continuing anyway."),
    );

    const envIgnored = await isGitIgnored(".env");
    addEnvToGitignore =
      !envIgnored &&
      (await confirm({ message: ".env is not git-ignored. Add it to .gitignore?", default: true }));

    if (envIgnored || addEnvToGitignore) {
      if (email !== current.jiraApiEmail) secrets[ENV_VARS.jiraApiEmail] = email;
      if (token !== current.jiraApiToken) secrets[ENV_VARS.jiraApiToken] = token;
    } else {
      console.log(
        pc.dim(`Set ${ENV_VARS.jiraApiEmail} and ${ENV_VARS.jiraApiToken} in your environment.`),
      );
    }
  }

  // Write only after the last prompt, so Ctrl+C leaves no files behind.
  // `.gitignore` comes before `.env`, so `.env` never exists without being ignored.
  await writeRcFile(cwd, { jiraBaseUrl, ticketPattern, gitProvider });
  if (addEnvToGitignore) {
    await appendLines(join(cwd, ".gitignore"), [".env"]);
  }
  const envLines = Object.entries(secrets).map(([key, value]) => `${key}='${value}'`);
  if (envLines.length > 0) {
    await appendLines(join(cwd, ".env"), envLines);
  }

  const provider = gitProvider ?? detected;
  if (repo && provider && !(provider === "github" ? current.githubToken : current.gitlabToken)) {
    const cli = provider === "github" ? "gh" : "glab";
    const envVar = provider === "github" ? ENV_VARS.githubToken : ENV_VARS.gitlabToken;
    console.log(
      (await isCliLoggedIn(cli, repo.host))
        ? pc.green(`✓ Pull request links use your ${cli} login.`)
        : pc.dim(`For pull request links, run \`${cli} auth login\` or set ${envVar}.`),
    );
  }

  console.log(pc.green(`✓ Created ${RC_FILE}. Commit it so your team shares the settings.`));
}

export const init = defineCommand({
  meta: {
    name: "init",
    description: "Create a .release-clirc.json config file interactively.",
  },
  args: {
    cwd: {
      type: "string",
      description: "Working directory to use (default: current directory)",
    },
  },
  async run({ args }) {
    const root = args.cwd ? resolve(args.cwd) : process.cwd();
    if (args.cwd) {
      process.chdir(root);
    }

    try {
      await runInit(root);
    } catch (err: unknown) {
      if (isPromptCancel(err)) {
        console.log("");
        process.exit(130);
      }
      throw err;
    }
  },
});
