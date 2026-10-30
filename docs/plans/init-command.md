# `jvm-release init` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `jvm-release init` command. It asks a few questions, creates `.release-clirc.json` with defaults taken from the repository, and keeps API tokens out of that file.

**Architecture:** `init` is a separate citty command in `src/init/`. `src/index.ts` dispatches to it before `runMain(main)`. Helper modules do the repository checks and the file writes, so the interactive flow (`runInit`) only calls tested functions. All files are written after the last prompt, so Ctrl+C leaves nothing behind.

**Tech Stack:** TypeScript (ESM, `.ts` imports), citty 0.1.6, `@inquirer/prompts` 7, `@jungvonmatt/config-loader` 0.6, Vite+ (`vp test`, `vp check`, `vp pack`).

**Spec:** The Decisions section below, from the design discussion on 2026-10-30.

## Decisions

| #   | Decision               | Resolution                                                                                                                                                                                                                                                                                                                                    |
| --- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Command routing        | Do not add citty `subCommands` to the root command. In citty 0.1.6 the first argument without a leading dash becomes the subcommand name, so `jvm-release test` and `jvm-release --branch main` fail with "Unknown command". The root `run` also still runs after the subcommand. `src/index.ts` checks `process.argv[2] === "init"` instead. |
| 2   | Output file            | `.release-clirc.json` in the working directory. JSON, 2-space indent, trailing newline.                                                                                                                                                                                                                                                       |
| 3   | Committed keys         | `jiraBaseUrl`, `ticketPattern`, and `gitProvider`. `gitProvider` is written only when the `origin` host name contains neither "github" nor "gitlab".                                                                                                                                                                                          |
| 4   | Secrets                | The Jira email and token go to `.env` as `CHANGELOG_JIRA_API_EMAIL` and `CHANGELOG_JIRA_API_TOKEN`. config-loader loads `.env` by default (checked). They are written only if `.env` is git-ignored, or if the user agrees to add it to `.gitignore`. Otherwise `init` prints the variable names and writes no secret.                        |
| 5   | PR tokens              | `init` does not ask for them. If `gh` or `glab` is logged in for the origin host, `init` says so. Otherwise it prints a one-line hint (`gh auth login` or the environment variable).                                                                                                                                                          |
| 6   | Existing config        | If a config source exists in the working directory, `init` prints its name and exits with code 0. There is no `--force`. Detection uses file names, because config-loader's `filepath` reports `release-cli.config` even when it loaded `.release-clirc.json` (checked).                                                                      |
| 7   | Ticket pattern default | Taken from the ticket keys in the last 500 commit messages. Falls back to `[A-Z]+-\d+`. The user confirms or edits it.                                                                                                                                                                                                                        |
| 8   | Jira check             | After the user enters credentials, `init` calls `GET <host>/rest/api/2/myself`, which works on Jira Cloud and Data Center. A failure shows a warning but does not stop `init`.                                                                                                                                                                |
| 9   | Discoverability        | The "Jira credentials not configured" warning in `fetchJiraTickets` names `jvm-release init`. `jvm-release --help` mentions it too.                                                                                                                                                                                                           |
| 10  | Out of scope           | Non-interactive mode (CI uses environment variables), TS/YAML/`package.json` output, migration from `jira-changelog`, config lookup in parent directories.                                                                                                                                                                                    |

## Global Constraints

- Run `vp check` and `vp test` before every commit. Both must pass.
- No new runtime dependencies. Prompts use `@inquirer/prompts` (`input`, `password`, `confirm`, `select`). Shell calls use `node:child_process`.
- Imports use explicit `.ts` extensions. Tests import from `vite-plus/test` and sit flat in `tests/`.
- `.release-clirc.json` never contains `jiraApiEmail`, `jiraApiToken`, `githubToken` or `gitlabToken`.
- `.env` is written only when it is git-ignored. `.gitignore` is written before `.env`.
- No file is written before the user answers the last prompt.
- The default ticket pattern stays `[A-Z]+-\d+`.
- Capture group 1 of a generated ticket pattern is the whole key, because `extractTickets` uses `match[1] ?? match[0]` (`src/changelog/graph.ts:141`).
- Git helpers run in `process.cwd()`. The `init` command calls `process.chdir` for `--cwd`, like the root command.
- Commit messages use Conventional Commits (`feat:`, `docs:`).

## Review Focus

1. **`.env` without a trailing newline.** An appended line must start on a new line, never `FOO=barCHANGELOG_JIRA_API_EMAIL=…`. Test in Task 3.
2. **`.env` is not git-ignored and the user does not want it in `.gitignore`.** `init` writes no `.env` and no token reaches the disk. Test in Task 5.
3. **Ctrl+C during a prompt.** `init` writes no files. Test in Task 5.
4. **A malformed `package.json`.** `findExistingConfig` returns `null` and does not throw. Test in Task 2.
5. **A Jira URL without a protocol (`myorg.atlassian.net`).** `init` saves and checks `https://myorg.atlassian.net`. Test in Task 5.

## File Structure

| File                       | Responsibility                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------ |
| `src/init/detect.ts` (new) | Read-only checks: existing config files, ticket pattern inference, `gh`/`glab` login |
| `src/init/files.ts` (new)  | Writes `.release-clirc.json`, appends lines to `.env` and `.gitignore`               |
| `src/init/index.ts` (new)  | `runInit(cwd)` flow and the citty `init` command                                     |
| `src/git.ts`               | Adds `getRecentCommitMessages` and `isGitIgnored`                                    |
| `src/config.ts`            | Exports `withProtocol`, `DEFAULT_TICKET_PATTERN`, `ENV_VARS`                         |
| `src/changelog/jira.ts`    | Adds `verifyJiraCredentials`. The missing-credentials warning names `init`.          |
| `src/ui.ts`                | Adds `isPromptCancel`, used by both commands                                         |
| `src/index.ts`             | Dispatches `init`, uses `isPromptCancel`, adds the help text                         |
| `README.md`                | Documents `init`. Fixes the out-of-date "interactive prompts" line.                  |

---

### Task 1: Infer the ticket pattern from git history

**Files:**

- Create: `src/init/detect.ts`
- Modify: `src/git.ts` (after `commitLogFromRevision`)
- Test: `tests/init-detect.test.ts`, `tests/git.test.ts`

**Interfaces:**

- Produces: `inferTicketPattern(messages: string): string | null` in `src/init/detect.ts`. `getRecentCommitMessages(limit = 500): Promise<string>` in `src/git.ts`.

- [ ] **Step 1: Write the failing tests**

`tests/init-detect.test.ts`, `describe("inferTicketPattern")`:

```ts
test("joins frequent project keys in alphabetical order", () => {
  expect(inferTicketPattern("SFA-3 a\nLEV-1 b\nLEV-2 c\nSFA-4 d")).toBe("((LEV|SFA)-\\d+)");
});
test("uses one group for a single key", () => {
  expect(inferTicketPattern("LEV-1\nLEV-2")).toBe("(LEV-\\d+)");
});
test("drops keys seen only once", () => {
  expect(inferTicketPattern("LEV-1 LEV-2 ABC-1")).toBe("(LEV-\\d+)");
});
test("ignores encodings and standards", () => {
  expect(inferTicketPattern("UTF-8 UTF-8 ISO-8859 ISO-8859 RFC-2119 RFC-2119")).toBeNull();
});
test("finds keys in branch names", () => {
  const log = "Merge branch 'feature/LEV-658_foo'\nMerge branch 'feature/LEV-12-bar'";
  expect(inferTicketPattern(log)).toBe("(LEV-\\d+)");
});
test("keeps the five most frequent keys", () => {
  const log = ["AA", "BB", "CC", "DD", "EE"]
    .flatMap((key) => [`${key}-1`, `${key}-2`, `${key}-3`])
    .concat(["FF-1", "FF-2"])
    .join("\n");
  expect(inferTicketPattern(log)).toBe("((AA|BB|CC|DD|EE)-\\d+)");
});
test("captures the whole key in group 1", () => {
  const pattern = inferTicketPattern("LEV-1 SFA-2 LEV-3 SFA-4")!;
  expect(new RegExp(pattern).exec("see SFA-42 now")?.[1]).toBe("SFA-42");
});
test("returns null without keys", () => {
  expect(inferTicketPattern("")).toBeNull();
});
```

`tests/git.test.ts`. Use the existing `mockExec` and `mockExecError` helpers, and import from `../src/git.ts` inside each test like the existing tests do:

```ts
describe("getRecentCommitMessages", () => {
  test("reads subject and body of the last commits", async () => {
    mockExec("LEV-1 fix\n\nbody\n");
    expect(await getRecentCommitMessages(500)).toBe("LEV-1 fix\n\nbody");
    expect(execMock.mock.calls[0]![0]).toBe('git log -n 500 --format="%s%n%b"');
  });
  test("returns an empty string in a repository without commits", async () => {
    mockExecError(new Error("fatal: your current branch 'main' does not have any commits yet"));
    expect(await getRecentCommitMessages()).toBe("");
  });
});
```

- [ ] **Step 2: Run the tests to make sure they fail**

Run: `vp test tests/init-detect.test.ts tests/git.test.ts`
Expected: FAIL, because `inferTicketPattern` and `getRecentCommitMessages` are not exported.

- [ ] **Step 3: Implement both functions**

`getRecentCommitMessages`: run `git log -n ${limit} --format="%s%n%b"`. Return the trimmed stdout. Return `""` if the command fails.

`inferTicketPattern`:

```
match /\b([A-Z][A-Z0-9]+)-\d+/g  (no trailing \b, so "LEV-658_foo" matches)
skip IGNORED_PREFIXES = ["CVE", "ISO", "RFC", "SHA", "UTF"]
keep prefixes counted >= 2, take the 5 most frequent, sort them alphabetically
one prefix  → `(${prefix}-\\d+)`
more        → `((${prefixes.join("|")})-\\d+)`
none        → null
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `vp test tests/init-detect.test.ts tests/git.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/init/detect.ts src/git.ts tests/init-detect.test.ts tests/git.test.ts
git commit -m "feat(init): infer the ticket pattern from commit history"
```

### Task 2: Detect an existing config, git-ignored files and CLI logins

**Files:**

- Modify: `src/init/detect.ts`, `src/git.ts`
- Test: `tests/init-detect.test.ts`, `tests/git.test.ts`

**Interfaces:**

- Produces:
  - `findExistingConfig(cwd: string): Promise<string | null>`. Returns the file name relative to `cwd` (`".release-clirc.json"`, `"release-cli.config.ts"`, `"package.json"`) or `null`.
  - `isCliLoggedIn(command: "gh" | "glab", host: string): Promise<boolean>` in `src/init/detect.ts`
  - `isGitIgnored(path: string): Promise<boolean>` in `src/git.ts`

- [ ] **Step 1: Write the failing tests**

`tests/init-detect.test.ts`. The `findExistingConfig` tests use a real temporary directory (`mkdtemp(join(tmpdir(), "release-cli-"))`, removed in `afterEach`). Mock `node:child_process` `execFile` like `tests/changelog-pull-requests.test.ts` does.

```ts
describe("findExistingConfig", () => {
  test("returns null for an empty directory", async () => {
    expect(await findExistingConfig(dir)).toBeNull();
  });
  test.each([
    ".release-clirc",
    ".release-clirc.json",
    ".release-clirc.yaml",
    "release-cli.config.ts",
    "release-cli.config.mjs",
  ])("finds %s", async (name) => {
    await writeFile(join(dir, name), "");
    expect(await findExistingConfig(dir)).toBe(name);
  });
  test("finds the release-cli key in package.json", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ "release-cli": {} }));
    expect(await findExistingConfig(dir)).toBe("package.json");
  });
  test("ignores a package.json without the key", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "x" }));
    expect(await findExistingConfig(dir)).toBeNull();
  });
  test("ignores a malformed package.json", async () => {
    await writeFile(join(dir, "package.json"), "{ not json");
    expect(await findExistingConfig(dir)).toBeNull();
  });
});

describe("isCliLoggedIn", () => {
  test("checks the login for the host", async () => {
    // execFileMock calls back with success
    expect(await isCliLoggedIn("gh", "github.com")).toBe(true);
    expect(execFileMock.mock.calls[0]!.slice(0, 2)).toEqual([
      "gh",
      ["auth", "status", "--hostname", "github.com"],
    ]);
  });
  test("is false when the command is missing or not logged in", async () => {
    // execFileMock calls back with an ENOENT error
    expect(await isCliLoggedIn("glab", "gitlab.com")).toBe(false);
  });
});
```

`tests/git.test.ts`:

```ts
describe("isGitIgnored", () => {
  test("is true when git check-ignore matches", async () => {
    mockExec("");
    expect(await isGitIgnored(".env")).toBe(true);
    expect(execMock.mock.calls[0]![0]).toBe('git check-ignore -q ".env"');
  });
  test("is false when git check-ignore exits non-zero", async () => {
    mockExecError(new Error("exit 1"));
    expect(await isGitIgnored(".env")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to make sure they fail**

Run: `vp test tests/init-detect.test.ts tests/git.test.ts`
Expected: FAIL, because the three functions are not exported.

- [ ] **Step 3: Implement the three functions**

- `findExistingConfig`: `readdir(cwd)`, sort the names, and return the first one that matches `/^(\.release-clirc(\.[a-z]+)?|release-cli\.config\.[a-z0-9]+)$/`. If there is no match, parse `package.json` and return `"package.json"` if it has a `"release-cli"` key. If reading or parsing fails, treat the file as absent.
- `isCliLoggedIn`: `execFile(command, ["auth", "status", "--hostname", host])`. Return `true` if it resolves and `false` if it rejects.
- `isGitIgnored`: `git check-ignore -q "${path}"`. Return `true` if it resolves and `false` if it rejects (exit 1 = not ignored, 128 = not a repository).

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `vp test tests/init-detect.test.ts tests/git.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/init/detect.ts src/git.ts tests/init-detect.test.ts tests/git.test.ts
git commit -m "feat(init): detect existing config, git-ignored files and CLI logins"
```

### Task 3: Write the config file and append to dotfiles

**Files:**

- Create: `src/init/files.ts`
- Test: `tests/init-files.test.ts`

**Interfaces:**

- Consumes: `ChangelogConfig` from `src/changelog/types.ts`
- Produces:
  - `type InitConfig = Pick<ChangelogConfig, "jiraBaseUrl" | "ticketPattern" | "gitProvider">`
  - `RC_FILE = ".release-clirc.json"`
  - `writeRcFile(cwd: string, config: InitConfig): Promise<void>`
  - `appendLines(path: string, lines: string[]): Promise<void>`

- [ ] **Step 1: Write the failing tests** (real temporary directory, as in Task 2)

```ts
test("writeRcFile writes formatted JSON without unset keys", async () => {
  const config = { jiraBaseUrl: "https://x.atlassian.net", ticketPattern: "(LEV-\\d+)" };
  await writeRcFile(dir, { ...config, gitProvider: undefined });
  expect(await readFile(join(dir, RC_FILE), "utf8")).toBe(`${JSON.stringify(config, null, 2)}\n`);
});
test("writeRcFile does not overwrite an existing file", async () => {
  await writeFile(join(dir, RC_FILE), "{}");
  await expect(writeRcFile(dir, { jiraBaseUrl: "https://x" })).rejects.toThrow();
  expect(await readFile(join(dir, RC_FILE), "utf8")).toBe("{}");
});
test("appendLines creates a missing file", async () => {
  await appendLines(join(dir, ".env"), ["A=1", "B=2"]);
  expect(await readFile(join(dir, ".env"), "utf8")).toBe("A=1\nB=2\n");
});
test("appendLines starts on a new line when the file has no trailing newline", async () => {
  await writeFile(join(dir, ".env"), "FOO=bar");
  await appendLines(join(dir, ".env"), ["A=1"]);
  expect(await readFile(join(dir, ".env"), "utf8")).toBe("FOO=bar\nA=1\n");
});
test("appendLines keeps a file that ends with a newline", async () => {
  await writeFile(join(dir, ".env"), "FOO=bar\n");
  await appendLines(join(dir, ".env"), ["A=1"]);
  expect(await readFile(join(dir, ".env"), "utf8")).toBe("FOO=bar\nA=1\n");
});
```

- [ ] **Step 2: Run the tests to make sure they fail**

Run: `vp test tests/init-files.test.ts`
Expected: FAIL, because `src/init/files.ts` does not exist.

- [ ] **Step 3: Implement `writeRcFile` and `appendLines` in `src/init/files.ts`**

`writeRcFile` uses `writeFile(…, { flag: "wx" })`, so it never overwrites. `appendLines` reads the file (missing file = `""`), adds `"\n"` first if the content is not empty and does not end with one, then calls `appendFile`.

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `vp test tests/init-files.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/init/files.ts tests/init-files.test.ts
git commit -m "feat(init): write the config file and append to dotfiles"
```

### Task 4: Check Jira credentials and share the config constants

**Files:**

- Modify: `src/config.ts`, `src/changelog/jira.ts`
- Test: `tests/config.test.ts`, `tests/changelog-jira.test.ts`

**Interfaces:**

- Produces from `src/config.ts`:
  - `withProtocol(url: string): string`: now exported, no other change
  - `DEFAULT_TICKET_PATTERN = "[A-Z]+-\\d+"`: used in the `defaults` of `loadChangelogConfig`
  - `ENV_VARS = { jiraApiHost: "CHANGELOG_JIRA_API_HOST", jiraApiEmail: "CHANGELOG_JIRA_API_EMAIL", jiraApiToken: "CHANGELOG_JIRA_API_TOKEN", jiraBaseUrl: "CHANGELOG_JIRA_BASEURL", githubToken: "CHANGELOG_GITHUB_API_TOKEN", gitlabToken: "CHANGELOG_GITLAB_API_TOKEN" } as const`. `loadChangelogConfig` builds `envMap` from it by swapping keys and values.
- Produces from `src/changelog/jira.ts`: `verifyJiraCredentials(config: ChangelogConfig): Promise<boolean>`

- [ ] **Step 1: Write the tests**

`tests/config.test.ts`. This test passes today. It keeps the `ENV_VARS` refactor safe:

```ts
test("maps the environment variables to config keys", async () => {
  mockConfig({});
  await loadChangelogConfig();
  expect(loadConfigMock.mock.calls[0]![0].envMap).toEqual({
    CHANGELOG_JIRA_API_HOST: "jiraApiHost",
    CHANGELOG_JIRA_API_EMAIL: "jiraApiEmail",
    CHANGELOG_JIRA_API_TOKEN: "jiraApiToken",
    CHANGELOG_JIRA_BASEURL: "jiraBaseUrl",
    CHANGELOG_GITHUB_API_TOKEN: "githubToken",
    CHANGELOG_GITLAB_API_TOKEN: "gitlabToken",
  });
});
```

`tests/changelog-jira.test.ts` (use the existing `config`, `fetchMock` and the `console.warn` spy):

```ts
describe("verifyJiraCredentials", () => {
  test("calls /myself with Basic auth and returns true on success", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    expect(await verifyJiraCredentials(config)).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://myorg.atlassian.net/rest/api/2/myself",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Basic ${btoa("me@myorg.com:token")}` }),
      }),
    );
  });
  test("uses jiraApiHost when set", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await verifyJiraCredentials({ ...config, jiraApiHost: "https://api.example.com/" });
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.example.com/rest/api/2/myself");
  });
  test("returns false on 401", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 });
    expect(await verifyJiraCredentials(config)).toBe(false);
  });
  test("returns false when the request fails", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await verifyJiraCredentials(config)).toBe(false);
  });
  test("returns false without a request when credentials are missing", async () => {
    expect(await verifyJiraCredentials({ jiraBaseUrl: config.jiraBaseUrl })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

test("fetchJiraTickets names jvm-release init when credentials are missing", async () => {
  await fetchJiraTickets(["LEV-1"], { jiraBaseUrl: config.jiraBaseUrl });
  expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("jvm-release init"));
});
```

- [ ] **Step 2: Run the tests to make sure the new ones fail**

Run: `vp test tests/config.test.ts tests/changelog-jira.test.ts`
Expected: the `envMap` test PASSES. The `verifyJiraCredentials` tests and the warning test FAIL.

- [ ] **Step 3: Implement**

- `src/config.ts`: export `withProtocol`, `DEFAULT_TICKET_PATTERN` and `ENV_VARS`. Build `envMap` from `ENV_VARS`.
- `src/changelog/jira.ts`: `verifyJiraCredentials` sends a `GET` to `${(jiraApiHost ?? jiraBaseUrl).replace(/\/$/, "")}/rest/api/2/myself` with the same `Basic` header as `fetchJiraTickets`. It returns `response.ok`, and `false` on a thrown error or missing credentials. The missing-credentials warning becomes `⚠️  Jira credentials not configured. Falling back to raw commit summaries. Run \`jvm-release init\` to set them up.`

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `vp test tests/config.test.ts tests/changelog-jira.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/changelog/jira.ts tests/config.test.ts tests/changelog-jira.test.ts
git commit -m "feat(init): verify Jira credentials and share config constants"
```

### Task 5: Interactive `runInit` flow

**Files:**

- Create: `src/init/index.ts`
- Modify: `src/ui.ts`
- Test: `tests/init.test.ts`

**Interfaces:**

- Consumes: all functions from Tasks 1–4. `getRemoteRepository` and `detectProvider` from `src/git.ts`. `loadChangelogConfig` from `src/config.ts`.
- Produces:
  - `isPromptCancel(error: unknown): boolean` in `src/ui.ts`. It returns `true` for the `@inquirer/prompts` Ctrl+C error (`/force closed|SIGINT/i` on `Error.message`, the same check as `src/index.ts` today).
  - `runInit(cwd: string): Promise<void>` in `src/init/index.ts`
  - `init`, the citty command in `src/init/index.ts`. `meta.name: "init"`. One arg: `cwd` (string, optional). It resolves `cwd`, calls `process.chdir` if `--cwd` is given, and runs `runInit`. On `isPromptCancel` it prints an empty line and exits with code 130.

**Flow of `runInit`.** The prompts run in this order, and the test mocks depend on it:

1. `findExistingConfig(cwd)`. If it finds a config: log `Config already exists in <name>. Edit that file instead.` and return.
2. `current = await loadChangelogConfig(cwd)`. This includes values from the environment and `.env`.
3. `repo = await getRemoteRepository()` and `detected = repo ? detectProvider(repo.host) : null`.
4. `input` "Jira base URL (e.g. https://myorg.atlassian.net)", default `current.jiraBaseUrl`, `required: true`. Pass the answer through `withProtocol`.
5. `input` "Ticket pattern (regex)". The default is `inferTicketPattern(await getRecentCommitMessages()) ?? DEFAULT_TICKET_PATTERN`. `validate` rejects strings that make `new RegExp` throw.
6. `select` "Is <host> a GitHub or GitLab host?" (choices `github` and `gitlab`). Only when `repo && !detected`.
7. Only when `current.jiraApiEmail` or `current.jiraApiToken` is missing: `confirm` "Add Jira API credentials? Without them the changelog lists raw commit summaries." (default yes). On yes:
   - `input` "Jira account email" (default `current.jiraApiEmail`, required) and `password` "Jira API token" (`mask: true`, required).
   - `verifyJiraCredentials({ jiraBaseUrl, jiraApiHost: current.jiraApiHost, jiraApiEmail: email, jiraApiToken: token })`. Log `✓ Jira accepted the credentials.` or `⚠️  Jira rejected the credentials or is unreachable. Saving them anyway.`
   - If `!(await isGitIgnored(".env"))`: `confirm` ".env is not git-ignored. Add it to .gitignore?" (default yes). On no: log `Set CHANGELOG_JIRA_API_EMAIL and CHANGELOG_JIRA_API_TOKEN in your environment.` and drop the secrets.
8. Write the files, in this order: `writeRcFile`. Then `appendLines(.gitignore, [".env"])` if the user agreed. Then `appendLines(.env, …)` with `KEY='value'` lines (single quotes stop dotenv from expanding `$`). Write only the email and token values that differ from `current`.
9. PR hint. Only when `repo` is set and the provider (`gitProvider ?? detected`) has no token in `current`. If `isCliLoggedIn` is true, log `✓ Pull request links use your gh login.` Otherwise log ``For pull request links, run `gh auth login` or set CHANGELOG_GITHUB_API_TOKEN.`` On GitLab, use `glab` and `CHANGELOG_GITLAB_API_TOKEN`.
10. Log `✓ Created .release-clirc.json. Commit it so your team shares the settings.`

- [ ] **Step 1: Write the failing tests**

Set up `tests/init.test.ts`:

- `vi.mock("@inquirer/prompts")` with `input`, `password`, `confirm` and `select` as `vi.fn()`.
- Partially mock `../src/git.ts` (`getRemoteRepository`, `getRecentCommitMessages`, `isGitIgnored`), `../src/config.ts` (`loadChangelogConfig`), `../src/changelog/jira.ts` (`verifyJiraCredentials`) and `../src/init/detect.ts` (`isCliLoggedIn`). Use `importOriginal` so the other exports stay real.
- Pass a real temporary directory as `cwd`, and silence `console.log`.

Default mocks:

- origin `{ host: "github.com", path: "o/r" }`
- `current = { ticketPattern: DEFAULT_TICKET_PATTERN }`
- `isGitIgnored` → `true`
- `verifyJiraCredentials` → `true`
- `isCliLoggedIn` → `false`
- `getRecentCommitMessages` → `""`

```ts
test("writes only non-secret keys to .release-clirc.json", async () => {
  input.mockResolvedValueOnce("https://x.atlassian.net").mockResolvedValueOnce("(LEV-\\d+)").mockResolvedValueOnce("me@x.com");
  confirm.mockResolvedValueOnce(true);
  password.mockResolvedValueOnce("s3cret");
  await runInit(dir);
  const rc = await readFile(join(dir, RC_FILE), "utf8");
  expect(JSON.parse(rc)).toEqual({ jiraBaseUrl: "https://x.atlassian.net", ticketPattern: "(LEV-\\d+)" });
  expect(rc).not.toContain("s3cret");
  expect(await readFile(join(dir, ".env"), "utf8")).toBe(
    "CHANGELOG_JIRA_API_EMAIL='me@x.com'\nCHANGELOG_JIRA_API_TOKEN='s3cret'\n",
  );
});
test("adds .env to .gitignore before it writes secrets", …);
// isGitIgnored → false, second confirm → true: .gitignore is ".env\n" and .env exists
test("writes no secrets when the user keeps .env out of .gitignore", …);
// isGitIgnored → false, second confirm → false: no .env, no .gitignore, rc file exists
test("stops without prompts when a config exists", …);
// .release-clirc.json exists: input is not called and the file is unchanged
test("asks for the provider when the host is unknown", …);
// host "git.example.com", select → "gitlab": rc has gitProvider "gitlab"
test("skips the provider question and the PR hint without an origin remote", …);
// getRemoteRepository → null: select and isCliLoggedIn are not called
test("adds https:// to a Jira URL without a protocol", …);
// input "myorg.atlassian.net": rc jiraBaseUrl and the verifyJiraCredentials argument use "https://myorg.atlassian.net"
test("skips the credential questions when the environment has them", …);
// current has jiraApiEmail and jiraApiToken: confirm and password are not called, no .env
test("writes nothing when the user presses Ctrl+C", …);
// input rejects with new Error("User force closed the prompt with SIGINT"):
// runInit rejects and readdir(dir) is empty

describe("isPromptCancel", () => {
  test("detects the Ctrl+C error of @inquirer/prompts", () => {
    expect(isPromptCancel(new Error("User force closed the prompt with SIGINT"))).toBe(true);
  });
  test("ignores other errors", () => {
    expect(isPromptCancel(new Error("boom"))).toBe(false);
    expect(isPromptCancel("SIGINT")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to make sure they fail**

Run: `vp test tests/init.test.ts`
Expected: FAIL, because `src/init/index.ts` does not exist and `isPromptCancel` is not exported.

- [ ] **Step 3: Implement `isPromptCancel` in `src/ui.ts`, and `runInit` and `init` in `src/init/index.ts`, as the flow above describes**

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `vp test tests/init.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/init/index.ts src/ui.ts tests/init.test.ts
git commit -m "feat(init): add the interactive init flow"
```

### Task 6: Wire `init` into the CLI and document it

**Files:**

- Modify: `src/index.ts`, `README.md`

**Interfaces:**

- Consumes: `init` from `src/init/index.ts`, `isPromptCancel` from `src/ui.ts`.

- [ ] **Step 1: Dispatch `init` in `src/index.ts`**

Replace `void runMain(main);` with:

```ts
// citty 0.1.6 reads the first positional as a subcommand name and still runs the root
// command after the subcommand, so `init` is dispatched here instead of via `subCommands`.
const [command, ...rest] = process.argv.slice(2);
void (command === "init" ? runMain(init, { rawArgs: rest }) : runMain(main));
```

Also:

- The `catch` in `main` uses `isPromptCancel(err)`.
- `meta.description` becomes ``"Release preparation CLI for git-based projects. Run `jvm-release init` to create a config file."``

- [ ] **Step 2: Update `README.md`**

- Usage block: add `jvm-release init   # create .release-clirc.json interactively`.
- Configuration section: open with `jvm-release init`. Say what it writes: non-secret keys go to `.release-clirc.json`, and the Jira credentials go to `.env`, which it git-ignores first.
- Replace "**Local (non-CI):** missing `jiraBaseUrl` or `ticketPattern` trigger interactive prompts." with "**Local (non-CI):** missing values do not stop the release. The changelog falls back to raw commit summaries, and the CLI suggests `jvm-release init`." The old line is wrong: `src/config.ts` sets `prompts: false`.
- Environment variables section: add that the CLI also loads a `.env` file from the working directory.

- [ ] **Step 3: Run all checks**

Run: `vp check && vp test`
Expected: no errors. All tests pass.

- [ ] **Step 4: Build and run a smoke test**

Run: `vp pack`
Expected: `dist/index.mjs` is built.

Run: `node dist/index.mjs --help`
Expected: usage of `jvm-release-cli` with `--branch`, `--preview` and the `init` hint in the description.

Run: `node dist/index.mjs init --help`
Expected: usage of `init` with `--cwd`. No release prompt appears.

Run:

```bash
tmp=$(mktemp -d) && git -C "$tmp" init -q && echo '{}' > "$tmp/.release-clirc.json" && node dist/index.mjs init --cwd "$tmp"; echo "exit $?"
```

Expected: `Config already exists in .release-clirc.json. Edit that file instead.` and `exit 0`.

Run: `node dist/index.mjs --changelog`
Expected: the changelog of this repository. The root command still works.

Manual check in a terminal: run `node dist/index.mjs init --cwd <a clone without config>` and answer the prompts. `.release-clirc.json` has no token. `.env` has the two lines. `node dist/index.mjs --changelog --cwd <clone>` lists Jira summaries.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts README.md
git commit -m "feat: add the jvm-release init command"
```
