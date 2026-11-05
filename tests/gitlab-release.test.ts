import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

// Mock child_process: `execFile` runs glab
const execFileMock = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: any[]) => execFileMock(...args),
  exec: (_cmd: string, cb: Function) => cb(new Error("git is not mocked here")),
}));

const fetchMock = vi.fn();

const { createGitlabRelease, getGitlabApiUrl } = await import("../src/gitlab-release.ts");

const repo = { host: "gitlab.com", path: "acme/web/shop" };
const release = { version: "v1.3.0", changelog: "## Story\n\n- PROJ-1 Basket" };
const editUrl = "https://gitlab.com/acme/web/shop/-/releases/v1.3.0/edit";

/** Makes `execFile` succeed for `glab --version` if glab is available, and answer `api` calls. */
function mockGlab(
  available: boolean,
  api: { stdout?: string; stderr?: string } = { stdout: "{}" },
) {
  execFileMock.mockImplementation((cmd: string, args: string[], ...rest: any[]) => {
    const cb = rest.at(-1) as Function;
    if (!available) {
      cb(Object.assign(new Error(`spawn ${cmd} ENOENT`), { code: "ENOENT" }));
    } else if (args[0] === "api" && api.stderr) {
      cb(Object.assign(new Error(`Command failed: ${cmd} api`), { stderr: api.stderr }), {
        stdout: "",
        stderr: api.stderr,
      });
    } else if (args[0] === "api") {
      cb(null, { stdout: api.stdout ?? "{}", stderr: "" });
    } else {
      cb(null, { stdout: `${cmd} version 1.0.0`, stderr: "" });
    }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("createGitlabRelease", () => {
  test("creates the release with the token and returns its edit page", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ tag_name: "v1.3.0" }) });

    expect(await createGitlabRelease(repo, "glpat-x", release)).toBe(editUrl);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://gitlab.com/api/v4/projects/acme%2Fweb%2Fshop/releases");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "PRIVATE-TOKEN": "glpat-x",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body)).toEqual({
      tag_name: "v1.3.0",
      name: "v1.3.0",
      description: "## Story\n\n- PROJ-1 Basket",
    });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  test("reports GitLab's reason when the API refuses the release", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ message: "Release already exists" }),
    });

    await expect(createGitlabRelease(repo, "glpat-x", release)).rejects.toThrow(
      "GitLab API returned 409: Release already exists",
    );
  });

  test("reports the status when the error has no JSON body", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    });

    await expect(createGitlabRelease(repo, "glpat-x", release)).rejects.toThrow(
      /^GitLab API returned 502$/,
    );
  });

  test("uses glab without a token", async () => {
    mockGlab(true);

    expect(await createGitlabRelease(repo, undefined, release)).toBe(editUrl);

    const apiCall = execFileMock.mock.calls.find(([, args]) => args[0] === "api")!;
    expect(apiCall[0]).toBe("glab");
    expect(apiCall[1]).toEqual([
      "api",
      "projects/acme%2Fweb%2Fshop/releases",
      "--hostname",
      "gitlab.com",
      "--method",
      "POST",
      "-f",
      "tag_name=v1.3.0",
      "-f",
      "name=v1.3.0",
      "-f",
      "description=## Story\n\n- PROJ-1 Basket",
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("passes on the login hint when the glab login has expired", async () => {
    mockGlab(true, { stderr: "  ERROR  \n\n  401 Unauthorized  \n" });

    await expect(createGitlabRelease(repo, undefined, release)).rejects.toThrow(
      "401 Unauthorized Run `glab auth login --hostname gitlab.com` and try again.",
    );
  });

  test("rejects without a token and without glab", async () => {
    mockGlab(false);

    await expect(createGitlabRelease(repo, undefined, release)).rejects.toThrow(
      "No GitLab token and no glab CLI found. Set CHANGELOG_GITLAB_API_TOKEN or install glab.",
    );
  });
});

describe("getGitlabApiUrl", () => {
  const ci = { CI_SERVER_URL: "https://gitlab.com", CI_API_V4_URL: "https://gitlab.com/api/v4" };

  test("uses the remote host outside GitLab CI", () => {
    expect(getGitlabApiUrl(repo, {})).toBe("https://gitlab.com/api/v4");
  });

  test("uses CI_API_V4_URL in a GitLab CI job on the same instance", () => {
    const selfHosted = { host: "git.example.com", path: "acme/shop" };
    expect(
      getGitlabApiUrl(selfHosted, {
        CI_SERVER_URL: "http://git.example.com",
        CI_API_V4_URL: "http://git.example.com/gitlab/api/v4/",
      }),
    ).toBe("http://git.example.com/gitlab/api/v4");
  });

  test("ignores CI_API_V4_URL when origin is on another instance", () => {
    expect(getGitlabApiUrl({ host: "git.example.com", path: "acme/shop" }, ci)).toBe(
      "https://git.example.com/api/v4",
    );
  });
});

describe("createGitlabRelease in GitLab CI", () => {
  test("creates the release through the API of the job's instance, without glab", async () => {
    vi.stubEnv("CI", "true");
    vi.stubEnv("CI_SERVER_URL", "https://gitlab.com");
    vi.stubEnv("CI_API_V4_URL", "https://gitlab.com/api/v4");
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

    expect(await createGitlabRelease(repo, "glpat-bot", release)).toBe(editUrl);

    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://gitlab.com/api/v4/projects/acme%2Fweb%2Fshop/releases",
    );
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
