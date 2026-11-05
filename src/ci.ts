/* eslint-disable no-console */
// Behaviour that changes when the CLI runs unattended in CI, where nobody can answer a prompt
// and no browser can open.

import { confirm } from "@inquirer/prompts";
import pc from "picocolors";

/**
 * Detects a CI run. GitLab CI, GitHub Actions and most other CI services set `CI`.
 * `CI=false` and `CI=0` turn the CI behaviour off.
 */
export const isCI = (env: NodeJS.ProcessEnv = process.env): boolean =>
  Boolean(env.CI) && env.CI !== "false" && env.CI !== "0";

/**
 * Asks a yes/no question. In CI nobody can answer, so it throws `ciError` instead of waiting.
 */
export const confirmOrFail = async (
  question: { message: string; default: boolean },
  ciError: string,
): Promise<boolean> => {
  if (isCI()) {
    throw new Error(ciError);
  }
  return confirm(question);
};

/**
 * Opens the release page in the browser. In CI there is no browser, so it prints the URL to the
 * job log. If the browser does not open, it prints the URL too.
 */
export const showReleasePage = async (
  url: string,
  open: (url: string) => Promise<unknown> = async (target) => {
    // Lazy-load `open` so it does not slow down the start of the CLI
    const { default: openUrl } = await import("open");
    await openUrl(target);
  },
): Promise<void> => {
  if (isCI()) {
    console.log(`Release page: ${url}`);
    return;
  }

  try {
    await open(url);
  } catch (error: unknown) {
    console.warn(pc.yellow(`✗ Failed to open browser: ${(error as Error).message}`));
    console.warn(pc.yellow("Please open the following URL in your browser:"));
    console.warn(pc.yellow(url));
  }
};
