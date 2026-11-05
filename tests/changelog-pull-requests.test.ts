import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import type { CommitLog, GraphNode, PullRequest } from "../src/changelog/types.ts";

// Mock child_process: `execFile` runs gh/glab, `exec` runs git
const execFileMock = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: any[]) => execFileMock(...args),
  exec: (_cmd: string, cb: Function) => cb(new Error("git is not mocked here")),
}));

const fetchMock = vi.fn();

const { attachPullRequests, createPullRequestClient, findPullRequestNumber } =
  await import("../src/changelog/pull-requests.ts");

/** Makes `execFile` succeed for the listed commands and answer `api` calls with `apiResponse`. */
function mockCli(available: string[], apiResponse: unknown = {}) {
  execFileMock.mockImplementation((cmd: string, args: string[], ...rest: any[]) => {
    const cb = rest.at(-1) as Function;
    if (!available.includes(cmd)) {
      cb(Object.assign(new Error(`spawn ${cmd} ENOENT`), { code: "ENOENT" }));
    } else if (args[0] === "api") {
      cb(null, { stdout: JSON.stringify(apiResponse), stderr: "" });
    } else {
      cb(null, { stdout: `${cmd} version 1.0.0`, stderr: "" });
    }
  });
}

/** Makes `execFile` succeed for `cmd --version` and fail `api` calls with `stderr`. */
function mockCliError(cmd: string, stderr: string) {
  execFileMock.mockImplementation((_cmd: string, args: string[], ...rest: any[]) => {
    const cb = rest.at(-1) as Function;
    if (args[0] === "api") {
      cb(Object.assign(new Error(`Command failed: ${cmd} api`), { stderr }), {
        stdout: "",
        stderr,
      });
    } else {
      cb(null, { stdout: `${cmd} version 1.0.0`, stderr: "" });
    }
  });
}

function makeCommit(subject: string, body = ""): CommitLog {
  return {
    hash: `hash-${subject}`,
    parents: [],
    date: "2025-01-01",
    subject,
    body,
    authorName: "Author",
    authorEmail: "a@b.com",
  };
}

function makeNode(subject: string, body = ""): GraphNode {
  return { commit: makeCommit(subject, body), fullText: subject, merged: [] };
}

const githubPr = {
  number: 12,
  title: "PROJ-1 Add basket",
  html_url: "https://github.com/acme/shop/pull/12",
  user: { login: "alice" },
  head: { ref: "feature/PROJ-1-basket" },
};

const gitlabMr = {
  iid: 41,
  title: "Add basket",
  web_url: "https://gitlab.com/acme/web/shop/-/merge_requests/41",
  author: { username: "bob" },
  source_branch: "story/PROJ-2-basket",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("findPullRequestNumber", () => {
  test("GitHub merge commit", () => {
    const commit = makeCommit("Merge pull request #879 from acme/feature/PROJ-1-x");
    expect(findPullRequestNumber(commit, "github")).toBe(879);
  });

  test("GitHub squash merge", () => {
    const commit = makeCommit("PROJ-42: add search suggestions (#753)");
    expect(findPullRequestNumber(commit, "github")).toBe(753);
  });

  test("GitLab merge commit body", () => {
    const commit = makeCommit(
      "Merge branch 'story/TEAM-6318-docs' into 'main'",
      "Correct the docs (TEAM-6318)\n\nSee merge request acme/web/shop!39",
    );
    expect(findPullRequestNumber(commit, "gitlab")).toBe(39);
  });

  test("GitLab squash commit with MR reference", () => {
    expect(findPullRequestNumber(makeCommit("Add basket (!41)"), "gitlab")).toBe(41);
  });

  test("does not mix up provider formats", () => {
    expect(findPullRequestNumber(makeCommit("Add basket (#12)"), "gitlab")).toBeNull();
    expect(findPullRequestNumber(makeCommit("Add basket (!41)"), "github")).toBeNull();
  });

  test("returns null without a reference", () => {
    expect(findPullRequestNumber(makeCommit("chore: bump version"), "github")).toBeNull();
  });
});

describe("createPullRequestClient", () => {
  const githubRepo = { host: "github.com", path: "acme/shop" };
  const gitlabRepo = { host: "gitlab.com", path: "acme/web/shop" };

  test("GitHub with token calls the REST API", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => githubPr });

    const client = await createPullRequestClient(
      { jiraBaseUrl: "", githubToken: "t0k" },
      githubRepo,
    );
    const pr = await client!.get(12);

    expect(fetchMock).toHaveBeenCalledWith("https://api.github.com/repos/acme/shop/pulls/12", {
      headers: expect.objectContaining({ Authorization: "Bearer t0k" }),
    });
    expect(pr).toEqual<PullRequest>({
      number: 12,
      reference: "#12",
      title: "PROJ-1 Add basket",
      sourceBranch: "feature/PROJ-1-basket",
      author: "alice",
      url: "https://github.com/acme/shop/pull/12",
    });
  });

  test("GitHub Enterprise uses the /api/v3 base", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => githubPr });

    const client = await createPullRequestClient(
      { jiraBaseUrl: "", githubToken: "t0k" },
      { host: "github.acme.com", path: "acme/shop" },
    );
    await client!.get(12);

    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://github.acme.com/api/v3/repos/acme/shop/pulls/12",
    );
  });

  test("GitHub without token falls back to gh", async () => {
    mockCli(["gh"], githubPr);

    const client = await createPullRequestClient({ jiraBaseUrl: "" }, githubRepo);
    const pr = await client!.get(12);

    expect(execFileMock).toHaveBeenCalledWith(
      "gh",
      ["api", "repos/acme/shop/pulls/12", "--hostname", "github.com"],
      expect.anything(),
      expect.any(Function),
    );
    expect(pr.author).toBe("alice");
  });

  test("turns off CLI colors so the JSON stays parseable", async () => {
    mockCli(["gh"], githubPr);

    const client = await createPullRequestClient({ jiraBaseUrl: "" }, githubRepo);
    await client!.get(12);

    const options = execFileMock.mock.calls.find(([, args]) => args[0] === "api")![2];
    expect(options.env).toMatchObject({ NO_COLOR: "1", CLICOLOR_FORCE: "0" });
  });

  test("GitLab with token encodes the project path", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => gitlabMr });

    const client = await createPullRequestClient(
      { jiraBaseUrl: "", gitlabToken: "glt" },
      gitlabRepo,
    );
    const mr = await client!.get(41);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://gitlab.com/api/v4/projects/acme%2Fweb%2Fshop/merge_requests/41",
      { headers: { "PRIVATE-TOKEN": "glt" } },
    );
    expect(mr).toEqual<PullRequest>({
      number: 41,
      reference: "!41",
      title: "Add basket",
      sourceBranch: "story/PROJ-2-basket",
      author: "bob",
      url: "https://gitlab.com/acme/web/shop/-/merge_requests/41",
    });
  });

  test("GitLab without token falls back to glab", async () => {
    mockCli(["glab"], gitlabMr);

    const client = await createPullRequestClient({ jiraBaseUrl: "" }, gitlabRepo);
    const mr = await client!.get(41);

    expect(execFileMock).toHaveBeenCalledWith(
      "glab",
      ["api", "projects/acme%2Fweb%2Fshop/merge_requests/41", "--hostname", "gitlab.com"],
      expect.anything(),
      expect.any(Function),
    );
    expect(mr.reference).toBe("!41");
  });

  test("flattens a boxed CLI error into one line", async () => {
    mockCliError("glab", "          \n  ERROR  \n          \n  404 Not Found      \n\n");

    const client = await createPullRequestClient({ jiraBaseUrl: "" }, gitlabRepo);

    await expect(client!.get(41)).rejects.toThrow(/^404 Not Found$/);
  });

  test("adds a login hint when the CLI login has expired", async () => {
    mockCliError(
      "glab",
      '  ERROR  \n          \n  oauth2: "invalid_grant" "The provided authorization grant is invalid, expired, revoked, does not match the          \n  redirection URI."      \n',
    );

    const client = await createPullRequestClient({ jiraBaseUrl: "" }, gitlabRepo);

    await expect(client!.get(41)).rejects.toThrow(
      'oauth2: "invalid_grant" "The provided authorization grant is invalid, expired, revoked, does not match the redirection URI." Run `glab auth login --hostname gitlab.com` and try again.',
    );
  });

  test("returns null and warns without token and CLI", async () => {
    mockCli([]);

    const client = await createPullRequestClient({ jiraBaseUrl: "" }, gitlabRepo);

    expect(client).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("no glab CLI found"));
  });

  test("returns null for an unknown host", async () => {
    const client = await createPullRequestClient(
      { jiraBaseUrl: "", gitlabToken: "glt" },
      { host: "git.acme.com", path: "acme/shop" },
    );
    expect(client).toBeNull();
  });

  test("gitProvider overrides host detection", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => gitlabMr });

    const client = await createPullRequestClient(
      { jiraBaseUrl: "", gitlabToken: "glt", gitProvider: "gitlab" },
      { host: "git.acme.com", path: "acme/shop" },
    );
    await client!.get(41);

    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://git.acme.com/api/v4/projects/acme%2Fshop/merge_requests/41",
    );
  });

  test("throws a readable error when the API fails", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });

    const client = await createPullRequestClient(
      { jiraBaseUrl: "", githubToken: "t0k" },
      githubRepo,
    );

    await expect(client!.get(99)).rejects.toThrow("API returned 404");
  });
});

describe("attachPullRequests", () => {
  const pr = (number: number, title: string, sourceBranch = "feature/x"): PullRequest => ({
    number,
    reference: `#${number}`,
    title,
    sourceBranch,
    author: "alice",
    url: `https://github.com/acme/shop/pull/${number}`,
  });

  test("attaches the PR and adds its title and branch to fullText", async () => {
    const get = vi.fn(async (n: number) => pr(n, "Add basket", "feature/PROJ-7-basket"));
    const nodes = [makeNode("Merge pull request #12 from acme/feature/PROJ-7-basket")];

    const [node] = await attachPullRequests(nodes, { provider: "github", get });

    expect(node!.pullRequest?.number).toBe(12);
    expect(node!.fullText).toContain("Add basket");
    expect(node!.fullText).toContain("feature/PROJ-7-basket");
  });

  test("leaves commits without a reference unchanged", async () => {
    const get = vi.fn();
    const nodes = [makeNode("chore: bump version")];

    const result = await attachPullRequests(nodes, { provider: "github", get });

    expect(get).not.toHaveBeenCalled();
    expect(result[0]).toBe(nodes[0]);
  });

  test("loads each PR once", async () => {
    const get = vi.fn(async (n: number) => pr(n, "Add basket"));
    const nodes = [makeNode("First (#12)"), makeNode("Second (#12)")];

    await attachPullRequests(nodes, { provider: "github", get });

    expect(get).toHaveBeenCalledTimes(1);
  });

  test("skips failed lookups with one warning", async () => {
    const get = vi.fn(async (n: number) => {
      if (n !== 1) throw new Error("401 Unauthorized");
      return pr(n, "Works");
    });
    const nodes = [makeNode("One (#1)"), makeNode("Two (#2)"), makeNode("Three (#3)")];

    const result = await attachPullRequests(nodes, { provider: "github", get });

    expect(result.map((n) => n.pullRequest?.number)).toEqual([1, undefined, undefined]);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("#2, #3"));
  });

  test("lists failed lookups in number order", async () => {
    const get = vi.fn(async (n: number) => {
      // #2 fails last
      if (n === 2) await new Promise((resolve) => setTimeout(resolve, 5));
      throw new Error("401 Unauthorized");
    });
    const nodes = [makeNode("One (#1)"), makeNode("Two (#2)"), makeNode("Three (#3)")];

    await attachPullRequests(nodes, { provider: "github", get });

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("(#1, #2, #3)"));
  });

  test("ignores back-merge PRs from the default long-lived branches", async () => {
    const get = vi.fn(async (n: number) => pr(n, "Back-merge production", "production"));
    const nodes = [makeNode("Merge pull request #880 from acme/production")];

    const [node] = await attachPullRequests(nodes, { provider: "github", get });

    expect(node!.pullRequest).toBeUndefined();
    expect(node!.fullText).not.toContain("Back-merge production");
  });

  test("uses the configured back-merge branches", async () => {
    const get = vi.fn(async (n: number) =>
      n === 1
        ? pr(n, "Promote staging", "staging")
        : pr(n, "Release from production", "production"),
    );
    const nodes = [makeNode("One (#1)"), makeNode("Two (#2)")];

    const result = await attachPullRequests(nodes, { provider: "github", get }, ["staging"]);

    expect(result.map((n) => n.pullRequest?.number)).toEqual([undefined, 2]);
  });
});
