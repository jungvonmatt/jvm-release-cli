# jvm-release-cli

A general-purpose release preparation CLI for git-based projects. Automates version bumping, Jira-linked changelog generation, and GitHub release drafts — all in a single interactive workflow.

## Features

- **Interactive version selection** — choose test (prerelease) or production targets
- **Built-in changelog engine** — graph-based git log parsing with Jira ticket enrichment
- **First-parent graph resolution** — correctly handles merge commits, nesting branch commits
- **Revert detection** — excludes reverted commits (supports double-revert / unrevert)
- **Graceful degradation** — works without Jira credentials (falls back to raw commit list)
- **GitHub release drafts** — opens a pre-filled release draft in your browser
- **Preview mode** — dry-run without making changes
- **Rollback support** — automatic cleanup on failure

## Installation

```bash
pnpm add -D jvm-release-cli
```

## Usage

```bash
# Interactive mode (prompts for target)
jvm-release-cli

# Direct target selection
jvm-release-cli test
jvm-release-cli production

# Options
jvm-release-cli --branch main        # Release branch (default: main)
jvm-release-cli --preview            # Dry-run, no changes
jvm-release-cli --no-tests           # Skip test execution
```

## Configuration

Create one of the following config files (powered by `@jungvonmatt/config-loader`):

- `"release-cli"` key in `package.json`
- `.release-clirc.json`
- `release-cli.config.ts`

```jsonc
{
  "jiraBaseUrl": "https://myorg.atlassian.net",
  "ticketPattern": "[A-Z]+-\\d+",
}
```

### Environment Variables

| Variable                     | Config key     | Description                                       |
| ---------------------------- | -------------- | ------------------------------------------------- |
| `CHANGELOG_JIRA_API_HOST`    | `jiraApiHost`  | Jira API host (defaults to `jiraBaseUrl`)         |
| `CHANGELOG_JIRA_API_EMAIL`   | `jiraApiEmail` | Jira API email for authentication                 |
| `CHANGELOG_JIRA_API_TOKEN`   | `jiraApiToken` | Jira API token for authentication                 |
| `CHANGELOG_JIRA_BASEURL`     | `jiraBaseUrl`  | Jira base URL (fallback)                          |
| `CHANGELOG_GITHUB_API_TOKEN` | `githubToken`  | GitHub token (optional, for future PR enrichment) |

On dev machines (non-CI), missing config triggers interactive prompts. In CI, missing required fields cause a hard error with an actionable message.

## How the Changelog Works

1. Fetches `git log` with parent hashes for the given tag range
2. Builds a first-parent mainline graph, nesting branch commits under their merge commit
3. Consolidates commit messages — ticket IDs from branch commits surface at merge level
4. Detects and excludes reverted commits (odd revert depth = exclude, even = keep)
5. Extracts Jira ticket IDs via configurable regex against consolidated text
6. Fetches ticket metadata (summary, type, assignee) from Jira REST API via bulk JQL
7. Groups tickets by issue type and renders Markdown
8. Falls back gracefully when Jira API is unavailable

## Development

```bash
# Install dependencies
vp install

# Run tests
vp test

# Type-check and lint
vp check

# Build
vp pack
```

## License

MIT
