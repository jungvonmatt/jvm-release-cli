import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const prompts = vi.hoisted(() => ({
  input: vi.fn(),
  password: vi.fn(),
  confirm: vi.fn(),
  select: vi.fn(),
}));
vi.mock("@inquirer/prompts", () => prompts);

const mocks = vi.hoisted(() => ({
  getRemoteRepository: vi.fn(),
  getRecentCommitMessages: vi.fn(),
  isGitIgnored: vi.fn(),
  loadChangelogConfig: vi.fn(),
  verifyJiraCredentials: vi.fn(),
  isCliLoggedIn: vi.fn(),
}));

vi.mock("../src/git.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/git.ts")>()),
  getRemoteRepository: mocks.getRemoteRepository,
  getRecentCommitMessages: mocks.getRecentCommitMessages,
  isGitIgnored: mocks.isGitIgnored,
}));
vi.mock("../src/config.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/config.ts")>()),
  loadChangelogConfig: mocks.loadChangelogConfig,
}));
vi.mock("../src/changelog/jira.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/changelog/jira.ts")>()),
  verifyJiraCredentials: mocks.verifyJiraCredentials,
}));
vi.mock("../src/init/detect.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/init/detect.ts")>()),
  isCliLoggedIn: mocks.isCliLoggedIn,
}));

const { runInit } = await import("../src/init/index.ts");
const { isPromptCancel } = await import("../src/ui.ts");
const { DEFAULT_TICKET_PATTERN } = await import("../src/config.ts");
const { RC_FILE } = await import("../src/init/files.ts");

let dir: string;

const readRc = async () => JSON.parse(await readFile(join(dir, RC_FILE), "utf8"));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "release-cli-"));
  vi.resetAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  mocks.getRemoteRepository.mockResolvedValue({ host: "github.com", path: "o/r" });
  mocks.getRecentCommitMessages.mockResolvedValue("");
  mocks.isGitIgnored.mockResolvedValue(true);
  mocks.loadChangelogConfig.mockResolvedValue({ ticketPattern: DEFAULT_TICKET_PATTERN });
  mocks.verifyJiraCredentials.mockResolvedValue(true);
  mocks.isCliLoggedIn.mockResolvedValue(false);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe("runInit", () => {
  test("writes only non-secret keys to .release-clirc.json", async () => {
    prompts.input
      .mockResolvedValueOnce("https://x.atlassian.net")
      .mockResolvedValueOnce("(LEV-\\d+)")
      .mockResolvedValueOnce("me@x.com");
    prompts.confirm.mockResolvedValueOnce(true);
    prompts.password.mockResolvedValueOnce("s3cret");

    await runInit(dir);

    const rc = await readFile(join(dir, RC_FILE), "utf8");
    expect(JSON.parse(rc)).toEqual({
      jiraBaseUrl: "https://x.atlassian.net",
      ticketPattern: "(LEV-\\d+)",
    });
    expect(rc).not.toContain("s3cret");
    expect(await readFile(join(dir, ".env"), "utf8")).toBe(
      "CHANGELOG_JIRA_API_EMAIL='me@x.com'\nCHANGELOG_JIRA_API_TOKEN='s3cret'\n",
    );
  });

  test("adds .env to .gitignore before it writes secrets", async () => {
    mocks.isGitIgnored.mockResolvedValue(false);
    prompts.input
      .mockResolvedValueOnce("https://x.atlassian.net")
      .mockResolvedValueOnce("(LEV-\\d+)")
      .mockResolvedValueOnce("me@x.com");
    prompts.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(true);
    prompts.password.mockResolvedValueOnce("s3cret");

    await runInit(dir);

    expect(await readFile(join(dir, ".gitignore"), "utf8")).toBe(".env\n");
    expect(await readFile(join(dir, ".env"), "utf8")).toContain(
      "CHANGELOG_JIRA_API_TOKEN='s3cret'",
    );
  });

  test("writes no secrets when the user keeps .env out of .gitignore", async () => {
    mocks.isGitIgnored.mockResolvedValue(false);
    prompts.input
      .mockResolvedValueOnce("https://x.atlassian.net")
      .mockResolvedValueOnce("(LEV-\\d+)")
      .mockResolvedValueOnce("me@x.com");
    prompts.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    prompts.password.mockResolvedValueOnce("s3cret");

    await runInit(dir);

    expect((await readdir(dir)).sort()).toEqual([RC_FILE]);
  });

  test("stops without prompts when a config exists", async () => {
    await writeFile(join(dir, RC_FILE), '{"x":1}');

    await runInit(dir);

    expect(prompts.input).not.toHaveBeenCalled();
    expect(await readFile(join(dir, RC_FILE), "utf8")).toBe('{"x":1}');
  });

  test("asks for the provider when the host is unknown", async () => {
    mocks.getRemoteRepository.mockResolvedValue({ host: "git.example.com", path: "o/r" });
    prompts.input
      .mockResolvedValueOnce("https://x.atlassian.net")
      .mockResolvedValueOnce("(LEV-\\d+)");
    prompts.select.mockResolvedValueOnce("gitlab");
    prompts.confirm.mockResolvedValueOnce(false);

    await runInit(dir);

    expect((await readRc()).gitProvider).toBe("gitlab");
    expect(mocks.isCliLoggedIn).toHaveBeenCalledWith("glab", "git.example.com");
  });

  test("skips the provider question and the PR hint without an origin remote", async () => {
    mocks.getRemoteRepository.mockResolvedValue(null);
    prompts.input
      .mockResolvedValueOnce("https://x.atlassian.net")
      .mockResolvedValueOnce("(LEV-\\d+)");
    prompts.confirm.mockResolvedValueOnce(false);

    await runInit(dir);

    expect(prompts.select).not.toHaveBeenCalled();
    expect(mocks.isCliLoggedIn).not.toHaveBeenCalled();
    expect(await readRc()).not.toHaveProperty("gitProvider");
  });

  test("adds https:// to a Jira URL without a protocol", async () => {
    prompts.input
      .mockResolvedValueOnce("myorg.atlassian.net")
      .mockResolvedValueOnce("(LEV-\\d+)")
      .mockResolvedValueOnce("me@x.com");
    prompts.confirm.mockResolvedValueOnce(true);
    prompts.password.mockResolvedValueOnce("s3cret");

    await runInit(dir);

    expect((await readRc()).jiraBaseUrl).toBe("https://myorg.atlassian.net");
    expect(mocks.verifyJiraCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ jiraBaseUrl: "https://myorg.atlassian.net" }),
    );
  });

  test("skips the credential questions when the environment has them", async () => {
    mocks.loadChangelogConfig.mockResolvedValue({
      ticketPattern: DEFAULT_TICKET_PATTERN,
      jiraApiEmail: "me@x.com",
      jiraApiToken: "s3cret",
    });
    prompts.input
      .mockResolvedValueOnce("https://x.atlassian.net")
      .mockResolvedValueOnce("(LEV-\\d+)");

    await runInit(dir);

    expect(prompts.confirm).not.toHaveBeenCalled();
    expect(prompts.password).not.toHaveBeenCalled();
    expect(await readdir(dir)).not.toContain(".env");
  });

  test("suggests the ticket pattern from the history and rejects invalid regexes", async () => {
    mocks.getRecentCommitMessages.mockResolvedValue("LEV-1 a\nLEV-2 b");
    prompts.input
      .mockResolvedValueOnce("https://x.atlassian.net")
      .mockResolvedValueOnce("(LEV-\\d+)");
    prompts.confirm.mockResolvedValueOnce(false);

    await runInit(dir);

    const options = prompts.input.mock.calls[1]![0];
    expect(options.default).toBe("(LEV-\\d+)");
    expect(options.validate("((")).not.toBe(true);
    expect(options.validate("(LEV-\\d+)")).toBe(true);
  });

  test("writes nothing when the user presses Ctrl+C", async () => {
    prompts.input.mockRejectedValueOnce(new Error("User force closed the prompt with SIGINT"));

    await expect(runInit(dir)).rejects.toThrow("force closed");

    expect(await readdir(dir)).toEqual([]);
  });
});

describe("isPromptCancel", () => {
  test("detects the Ctrl+C error of @inquirer/prompts", () => {
    expect(isPromptCancel(new Error("User force closed the prompt with SIGINT"))).toBe(true);
  });

  test("ignores other errors", () => {
    expect(isPromptCancel(new Error("boom"))).toBe(false);
    expect(isPromptCancel("SIGINT")).toBe(false);
  });
});
