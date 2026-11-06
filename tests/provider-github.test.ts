import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

// Mock child_process: `execFile` runs gh
const execFileMock = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: any[]) => execFileMock(...args),
  exec: (_cmd: string, cb: Function) => cb(new Error("git is not mocked here")),
}));

const fetchMock = vi.fn();

const { github } = await import("../src/provider/github.ts");

const repo = { host: "github.com", path: "acme/shop" };
const release = {
  version: "v1.3.0",
  changelog: "## Story\n\n- PROJ-1 Basket",
  isPrerelease: false,
};
const htmlUrl = "https://github.com/acme/shop/releases/tag/v1.3.0";

/** Makes `execFile` succeed for `gh --version` if gh is available, and answer `api` calls. */
function mockGh(available: boolean, stdout = JSON.stringify({ html_url: htmlUrl })) {
  execFileMock.mockImplementation((cmd: string, args: string[], ...rest: any[]) => {
    const cb = rest.at(-1) as Function;
    if (!available) {
      cb(Object.assign(new Error(`spawn ${cmd} ENOENT`), { code: "ENOENT" }));
    } else if (args[0] === "api") {
      cb(null, { stdout, stderr: "" });
    } else {
      cb(null, { stdout: `${cmd} version 2.0.0`, stderr: "" });
    }
  });
}

const created = () => ({ ok: true, json: async () => ({ html_url: htmlUrl }) });
const sentFields = () => JSON.parse(fetchMock.mock.calls[0]![1].body);
const sentAuth = () => fetchMock.mock.calls[0]![1].headers.Authorization;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("github.createRelease", () => {
  test("creates a published release with the token and returns its page", async () => {
    fetchMock.mockResolvedValue(created());

    expect(await github.createRelease(repo, "ghp-config", release, {})).toBe(htmlUrl);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.github.com/repos/acme/shop/releases");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer ghp-config",
        "X-GitHub-Api-Version": "2022-11-28",
      }),
    );
    expect(sentFields()).toEqual({
      tag_name: "v1.3.0",
      name: "v1.3.0",
      body: "## Story\n\n- PROJ-1 Basket",
      prerelease: false,
    });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  test("marks a pre-release", async () => {
    fetchMock.mockResolvedValue(created());

    await github.createRelease(repo, "ghp-config", { ...release, isPrerelease: true }, {});

    expect(sentFields().prerelease).toBe(true);
  });

  test("prefers the configured token over GITHUB_TOKEN", async () => {
    fetchMock.mockResolvedValue(created());

    await github.createRelease(repo, "ghp-config", release, { GITHUB_TOKEN: "ghs-actions" });

    expect(sentAuth()).toBe("Bearer ghp-config");
  });

  test("uses GITHUB_TOKEN without a configured token", async () => {
    fetchMock.mockResolvedValue(created());

    await github.createRelease(repo, undefined, release, { GITHUB_TOKEN: "ghs-actions" });

    expect(sentAuth()).toBe("Bearer ghs-actions");
    expect(execFileMock).not.toHaveBeenCalled();
  });

  test("uses gh without any token", async () => {
    mockGh(true);

    expect(await github.createRelease(repo, undefined, release, {})).toBe(htmlUrl);

    const apiCall = execFileMock.mock.calls.find(([, args]) => args[0] === "api")!;
    expect(apiCall[0]).toBe("gh");
    expect(apiCall[1]).toEqual([
      "api",
      "repos/acme/shop/releases",
      "--hostname",
      "github.com",
      "--method",
      "POST",
      "-f",
      "tag_name=v1.3.0",
      "-f",
      "name=v1.3.0",
      "-f",
      "body=## Story\n\n- PROJ-1 Basket",
      "-F",
      "prerelease=false",
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("builds the release page when the response has no URL", async () => {
    mockGh(true, "{}");

    expect(await github.createRelease(repo, undefined, release, {})).toBe(htmlUrl);
  });

  test("rejects without a token and without gh", async () => {
    mockGh(false);

    await expect(github.createRelease(repo, undefined, release, {})).rejects.toThrow(
      "No GitHub token and no gh CLI found. Set CHANGELOG_GITHUB_API_TOKEN or GITHUB_TOKEN, or install gh.",
    );
  });

  test("reports GitHub's reason when the API refuses the release", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ message: "Resource not accessible by integration" }),
    });

    await expect(github.createRelease(repo, "ghs-actions", release, {})).rejects.toThrow(
      "GitHub API returned 403: Resource not accessible by integration",
    );
  });
});

describe("github.apiBaseUrl", () => {
  test("uses api.github.com for github.com", () => {
    expect(github.apiBaseUrl(repo, {})).toBe("https://api.github.com");
  });

  test("uses /api/v3 on GitHub Enterprise Server", () => {
    expect(github.apiBaseUrl({ host: "git.example.com", path: "acme/shop" }, {})).toBe(
      "https://git.example.com/api/v3",
    );
  });

  test("uses GITHUB_API_URL in a GitHub Actions job on the same instance", () => {
    expect(
      github.apiBaseUrl(
        { host: "git.example.com", path: "acme/shop" },
        {
          GITHUB_SERVER_URL: "http://git.example.com",
          GITHUB_API_URL: "http://git.example.com/github/api/v3/",
        },
      ),
    ).toBe("http://git.example.com/github/api/v3");
  });

  test("ignores GITHUB_API_URL when origin is on another instance", () => {
    expect(
      github.apiBaseUrl(
        { host: "git.example.com", path: "acme/shop" },
        { GITHUB_SERVER_URL: "https://github.com", GITHUB_API_URL: "https://api.github.com" },
      ),
    ).toBe("https://git.example.com/api/v3");
  });
});
