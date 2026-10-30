/* eslint-disable no-console */
// Release preparation CLI: bumps the version, tags it, generates the changelog
// and opens the release page.
//
// It is designed for regular releases from the release branch (default: main).
// A production release merges the version bump into main, which can conflict
// with a hotfix flow, so the CLI asks before it continues on a `hotfix/*` branch.

import { exec } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import semver from "semver";
import { defineCommand, runMain } from "citty";
import pc from "picocolors";
import { Listr } from "listr2";
import { confirm } from "@inquirer/prompts";
import {
  verifyCurrentBranchIsReleaseBranch,
  verifyWorkingTreeIsClean,
  verifyRemoteHistoryIsClean,
  getRemoteRepository,
  detectProvider,
  hasTag,
  deleteTag,
  removeLastCommit,
  abortMerge,
  getCurrentBranch,
  getPackageVersion,
  getLatestTag,
  getLatestReleaseTag,
  INITIAL_VERSION,
} from "./git.ts";
import { ui } from "./ui.ts";
import { generateChangelog } from "./changelog/index.ts";
import { loadChangelogConfig } from "./config.ts";
import { getReleasePage } from "./release-page.ts";
import type { ChangelogConfig } from "./changelog/types.ts";
import type { ReleaseTarget, ReleaseContext } from "./types.ts";

const ROOT = process.cwd();
const execa = promisify(exec);

/**
 * Opens a URL in the system browser (lazy-loads `open` so it doesn't affect startup time).
 */
const openUrl = async (url: string): Promise<void> => {
  const { default: open } = await import("open");
  await open(url);
};

const main = defineCommand({
  meta: {
    name: "jvm-release-cli",
    description: "Release preparation CLI for git-based projects.",
  },
  args: {
    target: {
      type: "positional",
      description: "Release target: test | production (omit for interactive selection)",
      required: false,
    },
    branch: {
      type: "string",
      description: "Name of the release branch",
      default: "main",
    },
    preview: {
      type: "boolean",
      description: "Show tasks without actually executing them",
      default: false,
    },
    // citty reads `--no-tests` as `tests: false`, and lists a default-true flag as `--no-tests`
    tests: {
      type: "boolean",
      description: "Skip running tests",
      default: true,
    },
    changelog: {
      type: "boolean",
      description: "Generate and print the changelog without creating a release",
      default: false,
    },
    cwd: {
      type: "string",
      description: "Working directory to use (default: current directory)",
    },
  },
  async run({ args }) {
    try {
      const releaseTarget = (args.target as ReleaseTarget) || undefined;
      const branch = args.branch;
      const preview = args.preview;
      const skipTests = !args.tests;
      const changelogOnly = args["changelog"];
      const root = args.cwd ? resolve(args.cwd) : ROOT;

      if (args.cwd) {
        process.chdir(root);
      }

      if (changelogOnly) {
        const [latestTag, latestReleaseTag] = await Promise.all([
          getLatestTag(),
          getLatestReleaseTag(),
        ]);
        const fromTag = latestReleaseTag === INITIAL_VERSION ? latestTag : latestReleaseTag;
        const range = fromTag === INITIAL_VERSION ? "HEAD" : `tags/${fromTag}...HEAD`;
        const config = await loadChangelogConfig(root);
        const changelog = await generateChangelog(range, config);
        console.log(changelog || "No changes detected.");
        process.exit(0);
      }

      // Context object to share state between tasks
      const ctx: ReleaseContext = {
        version: "",
        changelog: "",
      };
      // Loaded by the changelog task, reused by the release page task
      let changelogConfig: ChangelogConfig | undefined;

      const result = await ui(releaseTarget);

      if ("cancelled" in result) {
        console.log("");
        console.log(pc.dim("Release cancelled."));
        console.log("");
        process.exit(0);
      }

      const { version, latestTag, latestReleaseTag } = result;

      console.log("");
      console.log(
        `🚀 Preparing release ${pc.cyan(pc.bold(version))}.${
          preview ? " (preview mode - no changes will be made)" : ""
        }`,
      );
      console.log("");
      console.log(pc.dim(`  Current live version: ${pc.cyan(latestReleaseTag)}`));
      console.log(pc.dim(`  Current test version: ${pc.cyan(latestTag)}`));
      console.log("");

      // Check if running from a hotfix branch
      const currentBranch = await getCurrentBranch();
      if (currentBranch.startsWith("hotfix/")) {
        console.log(pc.yellow("⚠️  Warning: Running the release from a hotfix branch"));
        console.log(
          pc.yellow(
            "   A production release merges the version bump into main, which can cause merge conflicts.",
          ),
        );
        console.log(pc.yellow("   Consider tagging and releasing the hotfix by hand."));
        console.log("");

        const shouldContinue = await confirm({
          message: "Do you want to continue with the automated release anyway?",
          default: false,
        });

        if (!shouldContinue) {
          console.log("");
          console.log(pc.dim("Release cancelled."));
          console.log("");
          process.exit(0);
        }

        console.log("");
      }

      /**
       * Rolls back the project to its previous state.
       */
      const rollback = async (): Promise<void> => {
        console.log("\nPublish failed. Rolling back to the previous state…");
        const versionWithoutPrefix = version.slice(1);

        try {
          // First, abort any in-progress merge to clean up the working tree
          await abortMerge();

          // Try to get package version, but handle the case where package.json might be corrupted
          let currentPackageVersion: string | null;
          try {
            currentPackageVersion = await getPackageVersion(root);
          } catch {
            currentPackageVersion = null;
          }

          // Verify that the package's version has been bumped before deleting the last tag and commit.
          if (
            currentPackageVersion &&
            versionWithoutPrefix === currentPackageVersion &&
            versionWithoutPrefix !== latestTag.slice(1) &&
            versionWithoutPrefix !== latestReleaseTag.slice(1)
          ) {
            await removeLastCommit();
          }

          if (await hasTag(version)) {
            await deleteTag(version);
          }

          console.log("Successfully rolled back the project to its previous state.");
        } catch (error: unknown) {
          console.log(`Couldn't roll back because of the following error:\n${String(error)}`);
        }
      };

      // Prerequisite checks
      const prerequisiteTasks = new Listr([
        {
          title: "Check current branch",
          task: () => verifyCurrentBranchIsReleaseBranch(branch),
        },
        {
          title: "Check local working tree",
          task: () => verifyWorkingTreeIsClean(),
        },
        {
          title: "Check remote history",
          task: () => verifyRemoteHistoryIsClean(),
        },
      ]);

      const bumpVersion = new Listr([
        {
          title: `Creating new release version ${version}`,
          skip: () => Boolean(semver.prerelease(version)),
          task: async () => {
            ctx.isPrerelease = false;

            const pkgVersion = version.replace("v", "");
            const releaseBranch = `release/tmp-${version}`;
            if (preview) {
              console.log(pc.yellow(`git switch -c "${releaseBranch}" "${latestTag}^{commit}"`));
              console.log(pc.yellow(`pnpm version --new-version ${pkgVersion} --no-commit-hooks`));
              console.log(pc.yellow("git switch main"));
              console.log(
                pc.yellow(`git merge --no-ff "${releaseBranch}" -m "Merge release ${version}"`),
              );
              console.log(pc.yellow(`git branch -D "${releaseBranch}"`));
            } else {
              try {
                // create a temporary release branch
                await execa(`git switch -c "${releaseBranch}" "${latestTag}^{commit}"`);
                // bump version (package/git) using pnpm
                await execa(`pnpm version --new-version ${pkgVersion} --no-commit-hooks`);
                // switch to main branch
                await execa("git switch main");

                // Check if main's version is higher than the version we're trying to release
                const mainVersion = await getPackageVersion(root);
                if (semver.gt(mainVersion, pkgVersion)) {
                  const suggestedVersion = `v${semver.inc(mainVersion, "patch")}`;
                  throw new Error(
                    `Cannot release ${version}: main branch is already at v${mainVersion}.\n` +
                      `Your branch is based on ${latestTag}.\n\n` +
                      `Suggested solutions:\n` +
                      `1. Merge your changes into main first, then run the release from main\n` +
                      `2. Use a higher version number like ${suggestedVersion}\n` +
                      `3. For a production hotfix, tag and release it by hand`,
                  );
                }

                // merge the release branch
                await execa(`git merge --no-ff "${releaseBranch}" -m "Merge release ${version}"`);

                // verify the new version tag was created
                if (!(await hasTag(version))) {
                  throw new Error(`Failed to create new version tag ${version}`);
                }

                // verify the package.json version was updated
                const packageVersion = await getPackageVersion(root);
                if (semver.compare(packageVersion, version) !== 0) {
                  throw new Error(
                    `Failed to update package.json version. Expected ${version} but got ${packageVersion}`,
                  );
                }
              } finally {
                // always delete the temporary release branch (ignore errors if it doesn't exist)
                try {
                  await execa(`git branch -D "${releaseBranch}"`);
                } catch {
                  // Branch might not exist if we failed early
                }
              }
            }

            ctx.version = version;
          },
        },
        {
          title: `Creating new pre-release version ${version}`,
          skip: () => !semver.prerelease(version),
          task: async () => {
            ctx.isPrerelease = true;

            const pkgVersion = version.replace("v", "");
            if (preview) {
              console.log(pc.yellow(`pnpm version --new-version ${pkgVersion} --no-commit-hooks`));
            } else {
              // bump version (package/git) using pnpm
              await execa(`pnpm version --new-version ${pkgVersion} --no-commit-hooks`);
              // verify the new version tag was created
              if (!(await hasTag(version))) {
                throw new Error(`Failed to create new version tag ${version}`);
              }

              // verify the package.json version was updated
              const packageVersion = await getPackageVersion(root);
              if (semver.compare(packageVersion, version) !== 0) {
                throw new Error(
                  `Failed to update package.json version. Expected ${version} but got ${packageVersion}`,
                );
              }
            }

            ctx.version = version;
          },
        },
        {
          title: "Pushing changes and tags to origin",
          skip: () => preview,
          task: async () => {
            // push the changes and tags to origin, first changes, then the tag
            await execa("git push origin HEAD --no-verify");
            await execa("git push origin --follow-tags --no-verify");
          },
        },
      ]);

      // Define tasks
      const tasks = new Listr(
        [
          {
            title: "Prerequisite check",
            task: () => prerequisiteTasks,
          },
          {
            title: "Running tests",
            enabled: () => !skipTests,
            task: () => execa("pnpm test"),
          },
          {
            title: "Bumping version",
            task: () => bumpVersion,
            rollback,
          },
          {
            title: "Generating changelog",
            task: async () => {
              const prereleaseTarget = preview ? "HEAD" : `tags/${ctx.version}`;
              const releaseTarget = preview
                ? latestTag === INITIAL_VERSION
                  ? "HEAD"
                  : `tags/${latestTag}`
                : `tags/${ctx.version}`;

              const fromTag = ctx.isPrerelease ? latestTag : latestReleaseTag;
              const toRef = ctx.isPrerelease ? prereleaseTarget : releaseTarget;
              const range = fromTag === INITIAL_VERSION ? toRef : `tags/${fromTag}...${toRef}`;

              changelogConfig = await loadChangelogConfig(root);
              ctx.changelog = await generateChangelog(range, changelogConfig);

              if (!ctx.changelog) {
                ctx.changelog = "No ticket changes detected.";
              }
            },
          },
          {
            title: "Opening release page",
            task: async () => {
              const repo = await getRemoteRepository();
              if (!repo) {
                console.warn(
                  pc.yellow("✗ Cannot read the origin remote. Create the release by hand."),
                );
                return;
              }

              const provider =
                changelogConfig?.gitProvider ?? detectProvider(repo.host) ?? "github";
              const page = getReleasePage(repo, provider, {
                version: ctx.version,
                changelog: ctx.changelog,
                isPrerelease: Boolean(ctx.isPrerelease),
                target: "main",
              });
              ctx.notesInReleasePage = page.includesNotes;

              try {
                await openUrl(page.url);
              } catch (error: unknown) {
                console.warn(pc.yellow(`✗ Failed to open browser: ${(error as Error).message}`));
                console.warn(pc.yellow("Please open the following URL in your browser:"));
                console.warn(pc.yellow(page.url));
              }
            },
          },
        ],
        {
          concurrent: false,
          exitOnError: true,
          rendererOptions: {
            collapseSubtasks: true,
            collapseErrors: false,
          },
        },
      );

      await tasks.run(ctx);

      // GitLab's release page cannot be prefilled with notes, so print them for pasting
      if (!ctx.notesInReleasePage) {
        console.log("");
        console.log(pc.bold("Release notes (paste them into the release form):"));
        console.log("");
        console.log(ctx.changelog);
      }

      console.log("");
      console.log(
        pc.bold(pc.green(`✓ Release preparation for ${pc.cyan(pc.bold(ctx.version))} complete!`)),
      );
      console.log("");
    } catch (err: unknown) {
      // @inquirer/prompts throws "User force closed the prompt with SIGINT" on Ctrl+C
      if (err instanceof Error && /force closed|SIGINT/i.test(err.message)) {
        console.log("");
        process.exit(130);
      }
      throw err;
    }
  },
});

void runMain(main);
