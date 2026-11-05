# jvm-release

[![CI](https://github.com/jungvonmatt/jvm-release-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/jungvonmatt/jvm-release-cli/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@jungvonmatt/release)](https://www.npmjs.com/package/@jungvonmatt/release)
[![license](https://img.shields.io/npm/l/@jungvonmatt/release)](./LICENSE)

A general-purpose release preparation CLI for git-based projects. Automates version bumping, Jira-linked changelog generation, and GitHub or GitLab release pages — all in a single interactive workflow.

## Features

- **Interactive version selection** — choose test (prerelease) or production targets, or pass a target directly
- **Built-in changelog engine** — graph-based git log parsing with Jira ticket enrichment
- **First-parent graph resolution** — correctly handles merge commits, nesting branch commits under their merge
- **Revert detection** — excludes reverted commits (odd revert depth = excluded, even = kept)
- **Pull/merge request links** — adds GitHub PR or GitLab MR links and author handles to the changelog, via an API token or the `gh` / `glab` CLI
- **Graceful degradation** — works without Jira credentials (falls back to raw commit list)
- **Release pages** — opens a pre-filled GitHub release draft, or the GitLab "new release" page, in your browser after a successful release
- **Preview mode** — dry-run that prints all git commands without executing them
- **Rollback support** — automatic cleanup of tags and version bump commits on failure
- **Hotfix awareness** — warns and asks before it continues on a `hotfix/*` branch

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
jvm-release test         # creates a prerelease (e.g. v1.2.0-pre.1)
jvm-release production   # creates a stable release (e.g. v1.2.0)

# Flags
jvm-release --branch main   # release branch to check against and merge into (default: main)
jvm-release --preview       # dry-run: print git commands, make no changes
jvm-release --no-tests      # skip test execution step
jvm-release --version       # print the CLI version
```

### Release workflow

When you run `jvm-release`, it:

1. **Validates prerequisites** — confirms you are on the release branch, the working tree is clean, and the remote history is up to date
2. **Prompts for a target** (unless passed as an argument) — shows the computed next test and production versions
3. **Bumps the version** — runs `pnpm version` and creates a git tag. A test release tags the tip of the release branch. A production release promotes the newest test release when one is newer than the last production release, so the tested state goes live. Newer commits stay unreleased. Without a pending test release, a production release tags the tip of the release branch.
4. **Runs tests** — executes the project's test suite (skipped with `--no-tests`)
5. **Generates a changelog** — builds a Jira-enriched Markdown changelog for the tag range
6. **Pushes to origin** — pushes the commit and tag
7. **Opens the release page** — on GitHub, a release draft pre-filled with tag, title and changelog. GitLab can only pre-fill the tag, so the CLI also prints the changelog for you to paste.

On any failure, the CLI automatically rolls back: the version commit is removed, the tag is deleted, and any in-progress merge is aborted.

> **Hotfix releases:** The CLI is designed for regular releases from the release branch. A production release that promotes a test release merges the version bump into the release branch (`--branch`, default `main`), which can conflict with a hotfix flow. On a `hotfix/*` branch, the CLI warns and asks before it continues.

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

  // Optional: API tokens for pull/merge request links.
  // Without a token, the CLI uses `gh` (GitHub) or `glab` (GitLab) if it is installed and logged in.
  "githubToken": "ghp_...",
  "gitlabToken": "glpat-...",

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

| Environment variable         | Config key     | Description                                     |
| ---------------------------- | -------------- | ----------------------------------------------- |
| `CHANGELOG_JIRA_BASEURL`     | `jiraBaseUrl`  | Jira base URL                                   |
| `CHANGELOG_JIRA_API_HOST`    | `jiraApiHost`  | Jira API host (defaults to `jiraBaseUrl`)       |
| `CHANGELOG_JIRA_API_EMAIL`   | `jiraApiEmail` | Jira API email for Basic Auth                   |
| `CHANGELOG_JIRA_API_TOKEN`   | `jiraApiToken` | Jira API token for Basic Auth                   |
| `CHANGELOG_GITHUB_API_TOKEN` | `githubToken`  | GitHub token for pull request links (optional)  |
| `CHANGELOG_GITLAB_API_TOKEN` | `gitlabToken`  | GitLab token for merge request links (optional) |

**Behavior by environment:**

- **Local (non-CI):** missing values do not stop the release. The changelog falls back to raw commit summaries, and the CLI suggests `jvm-release init`.
- **CI (`CI=true`):** missing `jiraBaseUrl` throws a hard error with an actionable message listing all missing fields.

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
