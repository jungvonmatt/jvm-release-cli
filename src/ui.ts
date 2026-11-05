import { select, confirm } from "@inquirer/prompts";
import semver from "semver";
import pc from "picocolors";
import Version from "./version.ts";
import { getLatestReleaseTag, getLatestTag, commitLogFromRevision } from "./git.ts";
import type { ReleaseTarget, ReleaseSelection } from "./types.ts";

/**
 * Validates the `target` argument. `ui()` treats any target other than `prerelease` as
 * production, so an unknown value must stop the CLI. `test` is the old name of `prerelease`, and
 * scripts may still use it.
 */
export const parseReleaseTarget = (value: string | undefined): ReleaseTarget | undefined => {
  if (!value) return undefined;
  if (value === "test") return "prerelease";
  if (value === "prerelease" || value === "production") return value;

  // citty reads `init` as the target when a flag comes first, e.g. `jvm-release --cwd x init`
  const hint =
    value === "init"
      ? " To create a config, put the flags after init: jvm-release init --cwd <dir>."
      : "";
  throw new Error(`Unknown release target "${value}". Use "prerelease" or "production".${hint}`);
};

/**
 * Detects the error `@inquirer/prompts` throws when the user presses Ctrl+C.
 */
export const isPromptCancel = (error: unknown): boolean =>
  error instanceof Error && /force closed|SIGINT/i.test(error.message);

export interface NextVersions {
  prerelease: Version;
  release: Version;
  /** Prerelease tag that a production release promotes, or `null` to release the branch tip */
  promotedTag: string | null;
}

/**
 * Computes the next prerelease and production versions from the latest tags.
 *
 * When a prerelease is newer than the last release, a production release promotes it, so the
 * tested state goes live. Otherwise there is nothing to promote, and a production release
 * releases the tip of the release branch.
 */
export const getNextVersions = (latestTag: string, latestReleaseTag: string): NextVersions => {
  const promotedTag = semver.gt(latestTag, latestReleaseTag) ? latestTag : null;

  return {
    prerelease: promotedTag
      ? new Version(latestTag, "prerelease")
      : new Version(latestTag, "preminor"),
    release: promotedTag
      ? new Version(latestTag.replace(/-.*/, ""))
      : new Version(latestReleaseTag, "minor"),
    promotedTag,
  };
};

/**
 * Interactive UI flow for selecting which version to publish.
 *
 * This prompts the user for either:
 * - a deployment target (`prerelease` / `production`), or
 * - an explicit SemVer increment (e.g. `patch`, `prepatch`)
 */
export const ui = async (
  target: ReleaseTarget | undefined,
): Promise<ReleaseSelection | { cancelled: true; latestTag: string; latestReleaseTag: string }> => {
  const latestTag = await getLatestTag();
  const latestReleaseTag = await getLatestReleaseTag();
  const {
    prerelease: newPrereleaseVersion,
    release: newReleaseVersion,
    promotedTag,
  } = getNextVersions(latestTag, latestReleaseTag);

  const hasCommits = await commitLogFromRevision(latestTag);

  // A production release that promotes a prerelease needs no new commits: it releases the
  // commit of that prerelease
  if (!hasCommits && !(target === "production" && promotedTag)) {
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
    promotedTag,
  };

  if (target) {
    return {
      ...result,
      target,
      version:
        target === "prerelease" ? newPrereleaseVersion.toString() : newReleaseVersion.toString(),
    };
  }

  return await select({
    message: "Select deployment target",

    choices: [
      {
        name: `Pre-release          ${pc.dim(latestTag)} -> ${newPrereleaseVersion.format()}`,
        value: {
          ...result,
          version: newPrereleaseVersion.toString(),
          target: "prerelease" as ReleaseTarget,
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
