import { select, confirm } from "@inquirer/prompts";
import semver from "semver";
import pc from "picocolors";
import Version from "./version.ts";
import { getLatestReleaseTag, getLatestTag, commitLogFromRevision } from "./git.ts";
import type { ReleaseTarget, ReleaseSelection } from "./types.ts";

/**
 * Validates the `target` argument. `ui()` treats any target other than `test` as production,
 * so an unknown value must stop the CLI.
 */
export const parseReleaseTarget = (value: string | undefined): ReleaseTarget | undefined => {
  if (!value) return undefined;
  if (value === "test" || value === "production") return value;

  // citty reads `init` as the target when a flag comes first, e.g. `jvm-release --cwd x init`
  const hint =
    value === "init"
      ? " To create a config, put the flags after init: jvm-release init --cwd <dir>."
      : "";
  throw new Error(`Unknown release target "${value}". Use "test" or "production".${hint}`);
};

/**
 * Detects the error `@inquirer/prompts` throws when the user presses Ctrl+C.
 */
export const isPromptCancel = (error: unknown): boolean =>
  error instanceof Error && /force closed|SIGINT/i.test(error.message);

/**
 * Interactive UI flow for selecting which version to publish.
 *
 * This prompts the user for either:
 * - a deployment target (`test` / `production`), or
 * - an explicit SemVer increment (e.g. `patch`, `prepatch`)
 */
export const ui = async (
  target: ReleaseTarget | undefined,
): Promise<ReleaseSelection | { cancelled: true; latestTag: string; latestReleaseTag: string }> => {
  const latestTag = await getLatestTag();
  const latestReleaseTag = await getLatestReleaseTag();

  const newReleaseVersion =
    semver.compare(latestReleaseTag, latestTag) < 0
      ? new Version(latestTag.replace(/-.*/, ""))
      : new Version(latestReleaseTag, "minor");

  const newPrereleaseVersion =
    semver.compare(latestReleaseTag, latestTag) >= 0
      ? new Version(latestTag, "preminor")
      : new Version(latestTag, "prerelease");

  const hasCommits = await commitLogFromRevision(latestTag);

  // for a production release, we don't need to confirm if there are no commits as
  // we want to release the latest pre-release version which is the same as the production release
  if (!hasCommits && target !== "production") {
    const shouldContinue = await confirm({
      message: "No commits found since previous release, continue?",
      default: false,
    });

    if (!shouldContinue) {
      return {
        cancelled: true,
        latestTag,
        latestReleaseTag,
      };
    }
  }

  const result = {
    latestTag,
    latestReleaseTag,
  };

  if (target) {
    return {
      ...result,
      target,
      version: target === "test" ? newPrereleaseVersion.toString() : newReleaseVersion.toString(),
    };
  }

  return await select({
    message: "Select deployment target",

    choices: [
      {
        name: `Test release         ${pc.dim(latestTag)} -> ${newPrereleaseVersion.format()}`,
        value: {
          ...result,
          version: newPrereleaseVersion.toString(),
          target: "test" as ReleaseTarget,
        },
      },
      {
        name: `Production release   ${pc.dim(latestTag)} -> ${newReleaseVersion.format({ color: "cyan" })}`,
        value: {
          ...result,
          version: newReleaseVersion.toString(),
          target: "production" as ReleaseTarget,
        },
      },
    ],
    loop: false,
    pageSize: 2,
  });
};
