/* eslint-disable no-console */
// Release preparation CLI: bumps the version, tags it, generates the changelog
// and opens the release page.
//
// It is designed for regular releases from the release branch (`--branch`, default: main).
// A production release promotes the newest prerelease when one is pending, and merges that
// version bump into the release branch. This can conflict with a hotfix flow, so the CLI asks
// before it continues on a `hotfix/*` branch.
//
// In CI (`CI` is set) nothing prompts: a question that needs an answer stops the release with an
// error, and the release page URL goes to the log instead of a browser.

import { exec } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import semver from "semver";
import { defineCommand, runMain } from "citty";
import pc from "picocolors";
import { Listr } from "listr2";
import {
  verifyCurrentBranchIsReleaseBranch,
  verifyWorkingTreeIsClean,
  verifyRemoteHistoryIsClean,
  verifyFullHistory,
  verifyGitIdentity,
  verifyOriginCanPush,
  getRemoteRepository,
  detectProvider,
  hasTag,
  deleteTemporaryBranch,
  pushRelease,
  recordReleaseStart,
  undoRelease,
  getCurrentBranch,
  getPackageVersion,
  getLatestTag,
  getLatestReleaseTag,
  commitLogFromRevision,
  INITIAL_VERSION,
} from "./git.ts";
import { isPromptCancel, parseReleaseTarget, ui } from "./ui.ts";
import { verifyVersionIsNewer } from "./version.ts";
import { generateChangelog } from "./changelog/index.ts";
import { loadChangelogConfig } from "./config.ts";
import { init } from "./init/index.ts";
import { getReleasePage } from "./release-page.ts";
import { createGitlabRelease } from "./gitlab-release.ts";
import { confirmOrFail, isCI, showReleasePage } from "./ci.ts";
import type { ChangelogConfig } from "./changelog/types.ts";
import type { ReleaseContext } from "./types.ts";
import pkg from "../package.json" with { type: "json" };

const ROOT = process.cwd();
const execa = promisify(exec);

const main = defineCommand({
  meta: {
    name: "jvm-release",
    version: pkg.version,
    description:
      "Release preparation CLI for git-based projects. Run `jvm-release init` to create a config file.",
  },
  args: {
    target: {
      type: "positional",
      description: "Release target: prerelease | production (omit for interactive selection)",
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
      const releaseTarget = parseReleaseTarget(args.target);
      const branch = args.branch;
      const preview = args.preview;
      const skipTests = !args.tests;
      const changelogOnly = args["changelog"];
      const root = args.cwd ? resolve(args.cwd) : ROOT;

      if (args.cwd) {
        process.chdir(root);
      }

      // Without the full history the tags are missing, and the version would be wrong
      await verifyFullHistory();

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

      // Without tags, the version in package.json is the starting point
      const packageVersion = await getPackageVersion(root).catch(() => undefined);
      const result = await ui(releaseTarget, packageVersion);

      if ("cancelled" in result) {
        console.log("");
        console.log(pc.dim("Release cancelled."));
        console.log("");
        process.exit(0);
      }

      const { version, latestTag, latestReleaseTag, promotedTag } = result;

      console.log("");
      console.log(
        `🚀 Preparing release ${pc.cyan(pc.bold(version))}.${
          preview ? " (preview mode - no changes will be made)" : ""
        }`,
      );
      console.log("");
      console.log(pc.dim(`  Current live version: ${pc.cyan(latestReleaseTag)}`));
      if (latestTag === INITIAL_VERSION && packageVersion && packageVersion !== "0.0.0") {
        console.log(
          pc.dim(`  No tags yet, so the CLI starts from ${packageVersion} in package.json.`),
        );
      }
      if (promotedTag) {
        console.log(pc.dim(`  Current pre-release:  ${pc.cyan(promotedTag)}`));
      }
      // Say what a production release contains, because newer commits can stay unreleased
      if (!semver.prerelease(version)) {
        if (promotedTag) {
          const newer = (await commitLogFromRevision(promotedTag)).split("\n").filter(Boolean);
          const unreleased =
            newer.length === 1 ? "1 newer commit stays" : `${newer.length} newer commits stay`;
          console.log(
            pc.dim(
              `  Promotes ${pc.cyan(promotedTag)}.${newer.length > 0 ? ` ${unreleased} unreleased.` : ""}`,
            ),
          );
        } else {
          console.log(
            pc.dim(`  Releases the tip of ${branch}, because no pre-release is pending.`),
          );
        }
      }
      console.log("");

      // Check if running from a hotfix branch
      const currentBranch = await getCurrentBranch();
      if (currentBranch.startsWith("hotfix/")) {
        console.log(pc.yellow("⚠️  Warning: Running the release from a hotfix branch"));
        console.log(
          pc.yellow(
            `   A production release merges the version bump into ${branch}, which can cause merge conflicts.`,
          ),
        );
        console.log(pc.yellow("   Consider tagging and releasing the hotfix by hand."));
        console.log("");

        const shouldContinue = await confirmOrFail(
          { message: "Do you want to continue with the automated release anyway?", default: false },
          `Release from ${currentBranch} stopped: CI cannot confirm a release from a hotfix branch.`,
        );

        if (!shouldContinue) {
          console.log("");
          console.log(pc.dim("Release cancelled."));
          console.log("");
          process.exit(0);
        }

        console.log("");
      }

      // Remember the branches and the tag, so a failed release can undo exactly its own changes
      const start = await recordReleaseStart(branch, version);

      /**
       * Rolls back the project to its previous state.
       */
      const rollback = async (): Promise<void> => {
        console.log("\nPublish failed. Rolling back to the previous state…");
        try {
          await undoRelease(start, version);
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
        {
          title: "Check git user",
          skip: () => preview,
          task: () => verifyGitIdentity(),
        },
        {
          title: "Check push access",
          skip: () => preview,
          task: () => verifyOriginCanPush(),
        },
        {
          title: "Check package version",
          skip: () => !packageVersion,
          task: () => verifyVersionIsNewer(version, packageVersion!),
        },
      ]);

      /**
       * Bumps the version on the current branch with `pnpm version`, which commits and tags it.
       */
      const bumpOnCurrentBranch = async (): Promise<void> => {
        const pkgVersion = version.replace("v", "");
        if (preview) {
          console.log(pc.yellow(`pnpm version ${pkgVersion} --no-commit-hooks`));
          return;
        }

        await execa(`pnpm version ${pkgVersion} --no-commit-hooks`);
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
      };

      const bumpVersion = new Listr([
        {
          title: `Creating new release version ${version}`,
          skip: () => Boolean(semver.prerelease(version)),
          task: async () => {
            ctx.isPrerelease = false;

            // Without a pending prerelease, release the tip of the release branch
            if (!promotedTag) {
              await bumpOnCurrentBranch();
              ctx.version = version;
              return;
            }

            const pkgVersion = version.replace("v", "");
            const releaseBranch = `release/tmp-${version}`;
            if (preview) {
              console.log(pc.yellow(`git switch -c "${releaseBranch}" "${promotedTag}^{commit}"`));
              console.log(pc.yellow(`pnpm version ${pkgVersion} --no-commit-hooks`));
              console.log(pc.yellow(`git switch "${branch}"`));
              console.log(
                pc.yellow(`git merge --no-ff "${releaseBranch}" -m "Merge release ${version}"`),
              );
              console.log(pc.yellow(`git branch -D "${releaseBranch}"`));
            } else {
              try {
                // create a temporary release branch
                await execa(`git switch -c "${releaseBranch}" "${promotedTag}^{commit}"`);
                // bump version (package/git) using pnpm
                await execa(`pnpm version ${pkgVersion} --no-commit-hooks`);
                // switch to the release branch
                await execa(`git switch "${branch}"`);

                // Check if the release branch's version is higher than the version we're trying to release
                const branchVersion = await getPackageVersion(root);
                if (semver.gt(branchVersion, pkgVersion)) {
                  const suggestedVersion = `v${semver.inc(branchVersion, "patch")}`;
                  throw new Error(
                    `Cannot release ${version}: ${branch} branch is already at v${branchVersion}.\n` +
                      `Your branch is based on ${promotedTag}.\n\n` +
                      `Suggested solutions:\n` +
                      `1. Merge your changes into ${branch} first, then run the release from ${branch}\n` +
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
                // always return to the start branch and delete the temporary release branch
                // (ignore errors if it doesn't exist)
                try {
                  await deleteTemporaryBranch(releaseBranch, currentBranch);
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
            await bumpOnCurrentBranch();
            ctx.version = version;
          },
        },
        {
          title: "Pushing changes and tags to origin",
          skip: () => preview,
          task: () => pushRelease(version),
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
                ? promotedTag
                  ? `tags/${promotedTag}`
                  : "HEAD"
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
            title: isCI() ? "Creating release page" : "Opening release page",
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
                target: branch,
              });
              ctx.notesInReleasePage = page.includesNotes;
              let url = page.url;

              // GitLab's page cannot be prefilled with notes, so create the release through the
              // API and open its edit page. If that fails, open the empty page and print the notes.
              if (provider === "gitlab" && !preview) {
                try {
                  url = await createGitlabRelease(repo, changelogConfig?.gitlabToken, {
                    version: ctx.version,
                    changelog: ctx.changelog,
                  });
                  ctx.notesInReleasePage = true;
                } catch (error: unknown) {
                  console.warn(
                    pc.yellow(`✗ Could not create the GitLab release: ${(error as Error).message}`),
                  );
                }
              }

              await showReleasePage(url);
            },
          },
        ],
        {
          concurrent: false,
          exitOnError: true,
          // A CI log is not a terminal: print one line per task instead of redrawing spinners
          fallbackRendererCondition: () => isCI(),
          rendererOptions: {
            collapseSubtasks: true,
            collapseErrors: false,
          },
        },
      );

      await tasks.run(ctx);

      // The empty GitLab page (preview, or no API access) needs the notes pasted by hand
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
      if (isPromptCancel(err)) {
        console.log("");
        process.exit(130);
      }
      throw err;
    }
  },
});

// citty 0.1.6 reads the first positional as a subcommand name and still runs the root
// command after the subcommand, so `init` is dispatched here instead of via `subCommands`.
const [command, ...rest] = process.argv.slice(2);
void (command === "init" ? runMain(init, { rawArgs: rest }) : runMain(main));
