# Built-in Changelog Engine

## Problem Statement

How might we make `jvm-release-cli` generate Jira-linked changelogs without requiring consumers to install `jira-changelog` or maintain a 300-line config file?

## Decisions (Resolved)

| #   | Decision                 | Resolution                                                                                                                                                                      |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Term "Changelog"         | The generated Markdown string (release body). Not a file, not the process.                                                                                                      |
| 2   | GitHub owner/repo        | Auto-detect from `git remote` (reuse `getGithubProjectUrl()`). Optional config override for edge cases.                                                                         |
| 3   | Config location          | `@jungvonmatt/config-loader` with `name: "release-cli"`. Multi-source lookup: `package.json` key, `.release-clirc.json`, `release-cli.config.ts`, etc.                          |
| 4   | Missing config behavior  | Dev machine (`!process.env.CI`): interactive prompts. CI: hard error with actionable message.                                                                                   |
| 5   | Jira API strategy        | Bulk via JQL: `POST /rest/api/3/search` with `key IN (...)`. Single call per release.                                                                                           |
| 6   | Commits without ticket   | "Other Commits" section. Built-in noise filter: merge commits between protected branches, l10n syncs.                                                                           |
| 7   | Missing Jira credentials | Graceful degradation: fallback to raw commit summaries + ticket IDs as plain text. Warning logged. Release continues.                                                           |
| 8   | HTTP client              | Native `fetch`. Zero HTTP dependencies.                                                                                                                                         |
| 9   | Template engine          | Hardcoded TypeScript template-literals. No template engine.                                                                                                                     |
| 10  | Issue-type grouping      | Hardcoded default order (Epic → Story → Task → Sub-Task → Bug → Technical Improvement → Technical Debt → IT Security). Unknown types appended at end under their original name. |
| 11  | Migration strategy       | Major version bump (clean break). No legacy `jira-changelog` support.                                                                                                           |
| 12  | Standalone subcommand    | Yes (`jvm-release-cli changelog --range ...`), but after MVP.                                                                                                                   |

## Recommended Direction

**Native built-in changelog with optional GitHub PR enrichment.**

Replace the `npx jira-changelog` call with a built-in module that:

1. Fetches `git log` for the given range **with parent hashes** (`%P`) to reconstruct the commit graph
2. Builds a first-parent mainline graph, nesting branch commits under their merge commit
3. Consolidates commit messages: ticket IDs from branch commits become visible at the merge commit level
4. Detects and excludes reverted commits (supports double-revert = "unrevert")
5. Extracts Jira ticket IDs from **consolidated fullText** (subject + body) via configurable regex
6. Fetches ticket metadata (summary, type, assignee) from Jira REST API via bulk JQL
7. Groups tickets by issue type and renders a Markdown changelog
8. Falls back gracefully when Jira API is unavailable (raw commit list)
9. Optionally enriches with GitHub PR data (v2.1 — contributors, PR links)

## Configuration

Uses `@jungvonmatt/config-loader` (`name: "release-cli"`).

Consumer creates **one** of:

- `"release-cli"` key in `package.json`
- `.release-clirc.json`
- `release-cli.config.ts`

```jsonc
{
  "jiraBaseUrl": "https://myorg.atlassian.net",
  "ticketPattern": "((PROJ|TEAM)-[0-9]{3,})",
}
```

Environment variables (mapped via `envMap`):

- `CHANGELOG_JIRA_API_HOST` → `jiraApiHost`
- `CHANGELOG_JIRA_API_EMAIL` → `jiraApiEmail`
- `CHANGELOG_JIRA_API_TOKEN` → `jiraApiToken`
- `CHANGELOG_JIRA_BASEURL` → `jiraBaseUrl` (fallback)
- `CHANGELOG_GITHUB_API_TOKEN` → `githubToken` (optional — enables PR enrichment in v2.1)

## Architecture

```
src/
  changelog/
    index.ts          # Public API: generateChangelog(range, config) → string
    git-log.ts        # Git log with graph parsing (parents, range, symmetric)
    graph.ts          # First-parent graph builder + message consolidation
    jira.ts           # Jira REST API client (bulk JQL search)
    formatter.ts      # Group by issue type + render markdown
    types.ts          # Shared types
  config.ts           # @jungvonmatt/config-loader integration
```

## Git Graph Parsing (Critical Detail)

jira-changelog uses `simple-git` with **parent-aware graph resolution**. Our built-in must replicate this behavior:

### How it works

1. **Structured log format** — not just subject lines:

   ```
   %H   → full SHA (revision)
   %P   → parent SHAs (space-separated — crucial for graph)
   %ai  → author date ISO
   %s   → subject
   %b   → body (ticket IDs often live here!)
   %aN  → author name
   %ae  → author email
   ```

2. **First-parent mainline walk:**
   - Start at most recent commit
   - Follow `parents[0]` (first parent) to build the mainline chain
   - Any commit NOT on the mainline is a "merged" branch commit

3. **Merge nesting (1-level-deep graph):**

   ```
   Mainline:  A ← B ← C(merge) ← D
   Branch:              ↖ b1 ← b2

   Result:
     - D (top-level)
     - C (top-level, graph.merged = [b1, b2])
     - B (top-level)
     - A (top-level)
   ```

   Branch commits at any depth are flattened into the merge's `merged[]` array.

4. **Message consolidation:**
   - For each mainline commit, concatenate `fullText` of all its `merged[]` commits
   - Ticket extraction runs against the **consolidated** text
   - This means: a ticket mentioned only in a branch commit body still gets picked up

5. **Revert detection:**

   ```
   Pattern: /^Revert ".*?This reverts commit ([0-9a-z]+)\.$/
   ```

   - Odd number of "Revert" prefixes → actual revert → exclude from consolidation
   - Even number → unrevert → keep it

6. **Range semantics:**
   - `from...to` → symmetric difference (three dots = `--symmetric` flag in simple-git)
   - `from..to` → asymmetric (standard git log range)
   - Existing `index.ts` already builds correct range strings (`tags/v1.0.0...tags/v2.0.0`)

### Why this matters

Without graph parsing, in a project using merge commits (non-squash):

- Tickets in branch commits would be **invisible** (only the merge commit summary appears in flat `git log --first-parent`)
- Reverting a feature would still show the reverted tickets in the changelog
- You'd get duplicate ticket entries from both the branch commit and the merge commit

### Implementation approach

Use `git log --format=...` directly via native `promisify(exec)` from `node:child_process` (already used throughout `src/git.ts`). No `simple-git`, no npm `execa` package. Parse the structured output ourselves — the graph algorithm is ~60 lines of code.

## New Dependency

```
"@jungvonmatt/config-loader": "^0.6.0"
```

No other new runtime dependencies. `fetch` is native. No `simple-git` needed — raw `git log` with custom format via native `node:child_process`.

## MVP Scope (v2.0.0)

### In

- **Graph-based git log parsing** (not flat `git log`):
  - Fetch with `%H`, `%P`, `%ai`, `%s`, `%b`, `%aN`, `%ae` format
  - Range support: `from...to` (symmetric) and `from..to` (asymmetric)
  - Range passed from existing `index.ts` logic (tag-based)
- **First-parent graph resolution:**
  - Walk first-parent chain to identify mainline commits
  - Nest branch commits under their merge commit (`graph.merged[]`)
  - Consolidate `fullText` of all merged commits onto the top-level commit
- **Revert detection:**
  - Detect via `This reverts commit <sha>.` pattern
  - Double-revert (even number of "Revert" prefixes) = unrevert, keep it
  - Exclude reverted commits from message consolidation
- Ticket ID extraction via configurable regex against **consolidated fullText** (default: `[A-Z]+-\d+`)
- Jira bulk JQL search (summary, type, assignee)
- Issue grouping by type (hardcoded order, unknowns appended)
- "Other Commits" section with noise filter
- Hardcoded Markdown template (template-literals)
- Config via `@jungvonmatt/config-loader`
- Graceful degradation without Jira credentials
- Interactive prompts for missing config on dev machines
- Hard error in CI for missing required fields
- GitHub owner/repo auto-detection from git remote

### Out

- GitHub PR contributor enrichment (v2.1)
- Custom template override (later if needed)
- Standalone `changelog` subcommand (v2.1)
- Jira release version linking
- Response caching

## Not Doing (and Why)

- **Keeping `jira-changelog`** — replaced entirely, no legacy path
- **Template engine** — YAGNI; hardcoded format covers all current consumers
- **`dotenv` auto-loading** — consumers control env injection at CI level
- **`ofetch`/`@octokit/core`** — native `fetch` suffices for 1-2 API calls
- **Bitbucket** — GitHub and GitLab cover the current needs

## Implementation Phases

### Phase 1: MVP (v2.0.0)

1. Add `@jungvonmatt/config-loader` dependency
2. Create `src/config.ts` — load config with `envMap` + conditional prompts
3. Create `src/changelog/types.ts` — `CommitLog`, `GraphNode`, `Range` types
4. Create `src/changelog/git-log.ts` — structured git log with parents (`%P`), range options
5. Create `src/changelog/graph.ts` — first-parent graph builder, merge nesting, message consolidation, revert detection
6. Create `src/changelog/jira.ts` — bulk JQL fetch with graceful fallback
7. Create `src/changelog/formatter.ts` — group + render Markdown
8. Create `src/changelog/index.ts` — orchestrate: git-log → graph → extract tickets → jira → format
9. Wire into `index.ts` replacing `npx jira-changelog` call
10. Tests for each module (graph logic needs extensive coverage)

### Phase 2: Enrichment (v2.1)

1. Add `src/changelog/github.ts` — PR data fetch via native `fetch`
2. Contributor attribution + PR links in formatter
3. Conditional on `CHANGELOG_GITHUB_API_TOKEN`
4. Standalone `changelog` subcommand via `citty` subcommands

## Migration Guide (for consumers)

```bash
# 1. Update CLI
pnpm update jvm-release-cli@^2.0.0

# 2. Create config (minimal)
echo '{ "jiraBaseUrl": "https://myorg.atlassian.net", "ticketPattern": "((PROJ|TEAM)-[0-9]{3,})" }' > .release-clirc.json

# 3. Remove legacy
rm changelog.config.cjs
pnpm remove jira-changelog @octokit/core dotenv

# 4. Verify env vars are set (unchanged)
# CHANGELOG_JIRA_API_HOST, CHANGELOG_JIRA_API_EMAIL, CHANGELOG_JIRA_API_TOKEN, CHANGELOG_JIRA_BASEURL
```
