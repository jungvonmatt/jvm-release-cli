# jvm-release

[![CI](https://github.com/jungvonmatt/jvm-release-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/jungvonmatt/jvm-release-cli/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@jungvonmatt/release)](https://www.npmjs.com/package/@jungvonmatt/release)
[![license](https://img.shields.io/npm/l/@jungvonmatt/release)](./LICENSE)

A general-purpose release preparation CLI for git-based projects. Automates version bumping, Jira-linked changelog generation, and GitHub or GitLab release pages — all in a single interactive workflow.

## Features

- **Interactive version selection** — choose a pre-release or a production release, or pass the target directly
- **Built-in changelog engine** — graph-based git log parsing with Jira ticket enrichment
- **First-parent graph resolution** — correctly handles merge commits, nesting branch commits under their merge
- **Revert detection** — excludes reverted commits (odd revert depth = excluded, even = kept)
- **Pull/merge request links** — adds GitHub PR or GitLab MR links and author handles to the changelog, via an API token or the `gh` / `glab` CLI
- **Graceful degradation** — works without Jira credentials (falls back to raw commit list)
- **Release pages** — after a successful release, opens a pre-filled GitHub release draft, or creates the GitLab release with the changelog and opens its edit page. In CI, it creates the GitHub or GitLab release through the API
- **Preview mode** — dry-run that prints all git commands without executing them
- **Rollback support** — automatic cleanup of tags and version bump commits on failure
- **Hotfix awareness** — warns and asks before it continues on a `hotfix/*` branch
- **CI-ready** — runs unattended in GitLab CI and GitHub Actions, see [Running in CI](#running-in-ci)

## Requirements

- Node.js 22 or later
- [pnpm](https://pnpm.io). The CLI runs `pnpm version` to bump the version and `pnpm test` to run the tests.
- A git repository with an `origin` remote
- A `test` script in `package.json`, or the `--no-tests` flag

## Installation

```bash
pnpm add -D @jungvonmatt/release
# or
npm install --save-dev @jungvonmatt/release
```

## Usage

```bash
# Create .release-clirc.json interactively (run once per project)
jvm-release init

# Interactive mode — prompts for deployment target
jvm-release

# Skip the prompt and release directly
jvm-release prerelease   # creates a pre-release (e.g. v1.2.0-pre.1). `test` still works.
jvm-release production   # creates a stable release (e.g. v1.2.0)

# Flags
jvm-release --branch main   # release branch to check against and merge into (default: main)
jvm-release --preview       # dry-run: print git commands, make no changes
jvm-release --no-tests      # skip test execution step
jvm-release --version       # print the CLI version
```

### Release workflow

When you run `jvm-release`, it:

1. **Validates prerequisites** — confirms you are on the release branch, the working tree is clean, the remote history is up to date, and the new version is higher than the version in `package.json`
2. **Prompts for a target** (unless passed as an argument) — shows the computed next pre-release and production versions. Without tags, the CLI starts from the version in `package.json`, so a project at 0.1.0 releases 0.2.0 next.
3. **Bumps the version** — runs `pnpm version` and creates a git tag. A pre-release tags the tip of the release branch. A production release promotes the newest pre-release when one is newer than the last production release, so the tested state goes live. Newer commits stay unreleased. Without a pending pre-release, a production release tags the tip of the release branch.
4. **Runs tests** — executes the project's test suite (skipped with `--no-tests`)
5. **Generates a changelog** — builds a Jira-enriched Markdown changelog for the tag range
6. **Pushes to origin** — pushes the commit and the tag in one atomic push, so `origin` gets both or neither
7. **Opens the release page** (in CI, prints its URL) — on GitHub, a release draft pre-filled with tag, title and changelog. In CI nobody reviews a draft, so the CLI creates the published GitHub release through the API instead. If that fails, it prints the draft URL and the changelog. GitLab cannot pre-fill its page, and it has no drafts. So the CLI creates the GitLab release with the changelog through the API, with `gitlabToken` or the `glab` login, and opens its edit page. The release is public right away. Without a token or `glab`, or if GitLab refuses the request, the CLI opens the empty page and prints the changelog for you to paste. `--preview` creates no release.

If the release fails, the CLI rolls back automatically. It aborts a merge in progress, resets the branches to their commits from before the release, and deletes the tag that the release created. Commits and tags that existed before the release stay.

> **Hotfix releases:** The CLI is designed for regular releases from the release branch. A production release that promotes a pre-release merges the version bump into the release branch (`--branch`, default `main`), which can conflict with a hotfix flow. On a `hotfix/*` branch, the CLI warns and asks before it continues.

## Configuration

Run `jvm-release init` in the project root to create the config:

```bash
jvm-release init
jvm-release init --cwd ./packages/shop   # another working directory
```

It asks for the Jira URL and the ticket pattern, and suggests a pattern from the ticket keys in recent commits. It writes:

- `.release-clirc.json` with `jiraBaseUrl`, `ticketPattern` and, for self-hosted git hosts, `gitProvider`. Commit this file.
- `.env` with the Jira email and API token, if you enter them. `init` writes `.env` only when git ignores it, and offers to add it to `.gitignore`.

`init` stops when the project already has a config. To change a value, edit the file.

To write the config by hand, create one of the following files (resolved by `@jungvonmatt/config-loader`):

| File                                  | Format     |
| ------------------------------------- | ---------- |
| `"release-cli"` key in `package.json` | JSON       |
| `.release-clirc.json`                 | JSON       |
| `release-cli.config.ts`               | TypeScript |

**Minimal config:**

```jsonc
{
  "jiraBaseUrl": "https://myorg.atlassian.net",
}
```

**Full config reference:**

```jsonc
{
  // Required: Jira instance URL used to build ticket links in the changelog
  "jiraBaseUrl": "https://myorg.atlassian.net",

  // Optional: override the Jira API host (defaults to jiraBaseUrl).
  // A bare host such as "myorg.atlassian.net" (the jira-changelog format) gets https:// added.
  "jiraApiHost": "https://myorg.atlassian.net",

  // Optional: Jira API credentials for ticket enrichment
  "jiraApiEmail": "you@example.com",
  "jiraApiToken": "your-jira-api-token",

  // Optional: regex used to extract ticket IDs from commit messages (default: [A-Z]+-\d+)
  "ticketPattern": "((PROJ|TEAM)-[0-9]{3,})",

  // Optional: API tokens for pull/merge request links and GitLab releases.
  // Without a token, the CLI uses `gh` (GitHub) or `glab` (GitLab) if it is installed and logged in.
  "githubToken": "ghp_...",
  "gitlabToken": "glpat-...", // needs the `api` scope to create releases

  // Optional: provider of the `origin` remote. Detected from the host name ("github"/"gitlab").
  // Set it for self-hosted instances whose host name contains neither word.
  "gitProvider": "gitlab",

  // Optional: set to false to skip pull/merge request lookups (default: true)
  "pullRequests": true,

  // Optional: list only tickets that are linked to a pull/merge request (default: false)
  "onlyTicketsWithPullRequest": false,

  // Optional: source branches of back-merge pull/merge requests, which are ignored
  // (default: ["main", "master", "production", "release"])
  "backMergeBranches": ["main", "master", "production", "release"],
}
```

### Environment variables

All config values can be provided via environment variables. This is the recommended approach for CI. The CLI also loads a `.env` file from the working directory.

| Environment variable         | Config key     | Description                                                  |
| ---------------------------- | -------------- | ------------------------------------------------------------ |
| `CHANGELOG_JIRA_BASEURL`     | `jiraBaseUrl`  | Jira base URL                                                |
| `CHANGELOG_JIRA_API_HOST`    | `jiraApiHost`  | Jira API host (defaults to `jiraBaseUrl`)                    |
| `CHANGELOG_JIRA_API_EMAIL`   | `jiraApiEmail` | Jira API email for Basic Auth                                |
| `CHANGELOG_JIRA_API_TOKEN`   | `jiraApiToken` | Jira API token for Basic Auth                                |
| `CHANGELOG_GITHUB_API_TOKEN` | `githubToken`  | GitHub token for pull request links and releases (optional)  |
| `CHANGELOG_GITLAB_API_TOKEN` | `gitlabToken`  | GitLab token for merge request links and releases (optional) |

To create a GitHub release in CI, the CLI uses `CHANGELOG_GITHUB_API_TOKEN`, then `GITHUB_TOKEN`, then the `gh` login.

**Behavior by environment:**

- **Local (non-CI):** missing values do not stop the release. The changelog falls back to raw commit summaries, and the CLI suggests `jvm-release init`.
- **CI (`CI=true`):** missing `jiraBaseUrl` throws a hard error with an actionable message listing all missing fields.

## Running in CI

The CLI runs unattended when `CI` is set. GitLab CI and GitHub Actions set it in every job. In CI, the CLI:

- Never asks a question. If it would ask, it stops with an error: without a target argument, without new commits, on a `hotfix/*` branch, and for `jvm-release init`.
- Prints the release page URL to the job log instead of opening a browser.
- Prints one log line per step instead of animated spinners.
- Creates the GitLab release through the REST API with `CHANGELOG_GITLAB_API_TOKEN`, so the job needs no `glab`. In a GitLab CI job, it uses the API URL of the job's instance (`CI_API_V4_URL`).
- Creates the GitHub release through the REST API, published, not as a draft. It uses `CHANGELOG_GITHUB_API_TOKEN`, then `GITHUB_TOKEN`, then the `gh` login. Pre-releases are marked as pre-releases.
- If the API call fails, warns and prints the release page URL and the release notes. The tag is pushed at that point, so do not run the job again. Create the release by hand instead.

### GitLab CI

#### What the CLI checks, and what the job does

A GitLab CI checkout is not ready for a release. The CLI checks each problem before it changes anything, and stops with the command that fixes it. The job script must do the fix.

| Problem in a default CI checkout                                     | CLI check                      | Fix in the job                                                       |
| -------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------- |
| Shallow clone: tags and history are missing, so the version is wrong | Stops before it reads the tags | `GIT_DEPTH: 0`                                                       |
| Detached HEAD: no branch to commit to                                | Stops before the release       | `git checkout -B <branch> origin/<branch>`                           |
| No git user for the version commit                                   | "Check git user"               | `git config user.name` and `git config user.email`                   |
| `origin` uses `CI_JOB_TOKEN`, which cannot push                      | "Check push access"            | `git remote set-url origin` with a token that has `write_repository` |
| Tags from other branches are missing                                 | none                           | `git fetch --tags --force origin <branch>`                           |

#### Token

Create a project access token, for example "Release Bot", with these scopes:

- `write_repository`, to push the version commit and the tag
- `api`, to create the release

If the release branch is protected, add the token's bot user to "Allowed to push and merge" for that branch. If version tags are protected, also allow the bot user to create them. Store the token as a masked CI/CD variable, for example `RELEASE_BOT_TOKEN`.

#### Example job

This example releases from the `main` branch with two manual jobs. Each job pushes the version commit to `main` and the tag in one atomic push. The tag then starts the deploy pipeline.

```yaml
.release:
  stage: release
  image: node:22
  # One release at a time
  resource_group: release
  variables:
    GIT_DEPTH: 0 # full history, so the CLI sees all tags
    GIT_STRATEGY: clone # no local branches or tags from an earlier job
    CHANGELOG_GITLAB_API_TOKEN: $RELEASE_BOT_TOKEN
    # Set CHANGELOG_JIRA_BASEURL, CHANGELOG_JIRA_API_EMAIL and
    # CHANGELOG_JIRA_API_TOKEN as CI/CD variables, or commit .release-clirc.json
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
      when: manual
  before_script:
    - corepack enable
    - pnpm install --frozen-lockfile
    - git config user.name "Release Bot"
    - git config user.email "release-bot@noreply.${CI_SERVER_HOST}"
    - git remote set-url origin "https://release-bot:${RELEASE_BOT_TOKEN}@${CI_SERVER_HOST}/${CI_PROJECT_PATH}.git"
    - git fetch --tags --force origin main
    - git checkout -B main origin/main

release:prerelease:
  extends: .release
  script:
    - pnpm exec jvm-release prerelease --branch main --no-tests

release:production:
  extends: .release
  script:
    - pnpm exec jvm-release production --branch main --no-tests
```

Notes:

- The job releases the current tip of `origin/main`, not the commit of the pipeline that runs the job. A production release promotes the newest pre-release.
- The version commit starts a new `main` pipeline. The release jobs are manual, so this does not start a new release.

### GitHub Actions

`actions/checkout` checks out a branch, but a shallow one, and without a git user. Set `fetch-depth: 0` and the git user. The CLI checks both.

The workflow's `GITHUB_TOKEN` can push the version commit and the tag, and create the release, with `permissions: contents: write`. Pass it to the CLI as an environment variable. It has two limits:

- It cannot push to a protected branch that requires pull requests. Use a GitHub App token or a fine-grained personal access token instead. Pass it to `actions/checkout` as `token`, and to the CLI as `CHANGELOG_GITHUB_API_TOKEN`.
- A tag pushed with `GITHUB_TOKEN` does not start other workflows. If a tag must start a deploy workflow, use one of those tokens too.

#### Example workflow

```yaml
name: Release

on:
  workflow_dispatch:
    inputs:
      target:
        description: Release target
        type: choice
        options: [prerelease, production]

permissions:
  contents: write # push the version commit and the tag, create the release

# One release at a time
concurrency: release

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: main
          fetch-depth: 0 # full history, so the CLI sees all tags
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
      - run: pnpm exec jvm-release "$TARGET" --branch main --no-tests
        env:
          TARGET: ${{ inputs.target }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          CHANGELOG_JIRA_BASEURL: ${{ vars.CHANGELOG_JIRA_BASEURL }}
          CHANGELOG_JIRA_API_EMAIL: ${{ secrets.CHANGELOG_JIRA_API_EMAIL }}
          CHANGELOG_JIRA_API_TOKEN: ${{ secrets.CHANGELOG_JIRA_API_TOKEN }}
```

## How the changelog works

The changelog engine is a fully self-contained module that replaces the need for external tools like `jira-changelog`.

```
git log (with parents)
       │
       ▼
First-parent graph builder
  └─ branch commits nested under their merge commit
       │
       ▼
Revert detection & consolidation
  └─ subject + body of merge + branch commits unified
       │
       ▼
Pull/merge request lookup  ──→  (fallback: skipped)
  └─ PR title + source branch added to the text
       │
       ▼
Ticket extraction (configurable regex)
       │
       ▼
Jira bulk JQL fetch  ──→  (fallback: raw ticket IDs)
  POST /rest/api/3/search/jql  (Data Center: /rest/api/2/search)
       │
       ▼
Markdown formatter
  └─ grouped by issue type: Epic → Story → Task → Bug → …
```

**Issue type display order:** Epic → Story → Task → Sub-Task → Bug → Technical Improvement → Technical Debt → IT Security. Unknown types are appended at the end.

**Commits without a Jira ticket** appear in an "Other Commits" section. Noise commits (e.g. branch-merge bookkeeping, l10n syncs) are filtered automatically.

**Pull/merge request links:** the CLI finds the request number in each mainline commit:

| Provider | Merge commit                                   | Squash commit        |
| -------- | ---------------------------------------------- | -------------------- |
| GitHub   | `Merge pull request #12 from …`                | subject ends `(#12)` |
| GitLab   | body line `See merge request group/project!12` | subject ends `(!12)` |

It loads each request once, with the token from the config or with `gh api` / `glab api`. Each ticket line then gets the request links and the authors' handles (for example `([#12](…)) @alice`). The handles replace the Jira assignee. A commit with a ticket appears only on that ticket's line. A commit without a ticket is listed once under "Other Commits", by its request title. A back-merge request (source branch in `backMergeBranches`, for example `production` into `main`) is ignored: it adds no link, no handle and no "Other Commits" entry. Commits from fast-forward merges have no request number, so they get no link. If a lookup fails, the changelog is still generated and the CLI prints one warning.

**Revert handling:** a commit reverted an odd number of times is excluded; reverted an even number of times (i.e. the revert itself was reverted) it is kept.

## Development

This project uses [Vite+](https://viteplus.dev/guide/) (`vp`) as its unified toolchain.

```bash
# Install dependencies
vp install

# Run in watch mode (rebuilds on change)
vp pack --watch

# Run tests
vp test

# Type-check and lint
vp check

# Production build
vp pack
```

## License

MIT
