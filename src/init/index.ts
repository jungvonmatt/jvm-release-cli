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
  getRecentCommitMessages,
  getRemoteRepository,
  isGitIgnored,
  isGitTracked,
} from "../git.ts";
import { DEFAULT_TICKET_PATTERN, ENV_VARS, loadChangelogConfig, withProtocol } from "../config.ts";
import { verifyJiraCredentials } from "../changelog/jira.ts";
import type { GitProvider } from "../changelog/types.ts";
import { detectProvider, getProvider, providers } from "../provider/index.ts";
import { isPromptCancel } from "../ui.ts";
import { isCI } from "../ci.ts";
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
  if (isCI()) {
    throw new Error(
      "`jvm-release init` asks questions, so it cannot run in CI. Commit .release-clirc.json " +
        "from your machine, and set the credentials as CI variables.",
    );
  }

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
    (
      await input({
        message: "Jira base URL (e.g. https://myorg.atlassian.net)",
        default: current.jiraBaseUrl,
        required: true,
      })
    ).trim(),
  );

  const ticketPattern = (
    await input({
      message: "Ticket pattern (regex)",
      default: inferTicketPattern(await getRecentCommitMessages()) ?? DEFAULT_TICKET_PATTERN,
      validate: (value) => isValidRegExp(value.trim()) || "Enter a valid regular expression.",
    })
  ).trim();

  const gitProvider =
    repo && !detected
      ? await select<GitProvider>({
          message: `Is ${repo.host} a GitHub or GitLab host?`,
          choices: Object.values(providers).map(({ name, id }) => ({ name, value: id })),
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
    const email = (
      await input({ message: "Jira account email", default: current.jiraApiEmail, required: true })
    ).trim();
    const token = (
      await password({
        message: "Jira API token",
        mask: true,
        validate: (value) => value.trim().length > 0 || "Enter the API token.",
      })
    ).trim();

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

    // A tracked `.env` stays tracked even when `.gitignore` lists it, so it never gets secrets
    const envTracked = await isGitTracked(".env");
    const envIgnored = !envTracked && (await isGitIgnored(".env"));
    addEnvToGitignore =
      !envTracked &&
      !envIgnored &&
      (await confirm({ message: ".env is not git-ignored. Add it to .gitignore?", default: true }));

    if (envIgnored || addEnvToGitignore) {
      if (email !== current.jiraApiEmail) secrets[ENV_VARS.jiraApiEmail] = email;
      if (token !== current.jiraApiToken) secrets[ENV_VARS.jiraApiToken] = token;
    } else {
      const reason = envTracked ? "git tracks .env, so the credentials stay out of it. " : "";
      console.log(
        pc.dim(
          `${reason}Set ${ENV_VARS.jiraApiEmail} and ${ENV_VARS.jiraApiToken} in your environment.`,
        ),
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

  const providerId = gitProvider ?? detected;
  const provider = providerId ? getProvider(providerId) : null;
  if (repo && provider && !current[provider.tokenKey]) {
    const { cli, tokenKey } = provider;
    const envVar = ENV_VARS[tokenKey];
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
    name: "jvm-release init",
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
