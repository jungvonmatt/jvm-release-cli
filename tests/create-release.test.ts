import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
  type MockInstance,
} from "vite-plus/test";
import { createRelease } from "../src/create-release.ts";
import { github as githubProvider, gitlab as gitlabProvider } from "../src/provider/index.ts";
import type { Provider } from "../src/provider/index.ts";

type CreateReleaseMock = MockInstance<Provider["createRelease"]>;
const mocks = {} as {
  createGithubRelease: CreateReleaseMock;
  createGitlabRelease: CreateReleaseMock;
};

const github = { host: "github.com", path: "acme/shop" };
const gitlab = { host: "gitlab.com", path: "acme/shop" };
const release = {
  version: "v1.3.0-pre.0",
  changelog: "- PROJ-1 Basket",
  isPrerelease: true,
  target: "main",
};
const config = { githubToken: "ghp-config", gitlabToken: "glpat-config" };

beforeEach(() => {
  // Unmocked calls fail, so no test reaches the real API
  const notMocked = () => Promise.reject(new Error("createRelease is not mocked"));
  mocks.createGithubRelease = vi
    .spyOn(githubProvider, "createRelease")
    .mockImplementation(notMocked);
  mocks.createGitlabRelease = vi
    .spyOn(gitlabProvider, "createRelease")
    .mockImplementation(notMocked);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("createRelease on GitHub", () => {
  test("returns the prefilled draft on a terminal and creates nothing", async () => {
    const result = await createRelease(github, githubProvider, config, release, false);

    expect(result.url).toContain("https://github.com/acme/shop/releases/new?");
    expect(result.notesInReleasePage).toBe(true);
    expect(mocks.createGithubRelease).not.toHaveBeenCalled();
  });

  test("creates the published release in CI", async () => {
    vi.stubEnv("CI", "true");
    const url = "https://github.com/acme/shop/releases/tag/v1.3.0-pre.0";
    mocks.createGithubRelease.mockResolvedValue(url);

    expect(await createRelease(github, githubProvider, config, release, false)).toEqual({
      url,
      notesInReleasePage: true,
    });
    expect(mocks.createGithubRelease).toHaveBeenCalledWith(github, "ghp-config", release);
  });

  test("falls back to the draft URL and the printed notes when the API fails in CI", async () => {
    vi.stubEnv("CI", "true");
    mocks.createGithubRelease.mockRejectedValue(new Error("GitHub API returned 403"));

    const result = await createRelease(github, githubProvider, config, release, false);

    expect(result.url).toContain("/releases/new?");
    expect(result.notesInReleasePage).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("GitHub API returned 403"));
  });

  test("creates nothing in preview, also in CI", async () => {
    vi.stubEnv("CI", "true");

    await createRelease(github, githubProvider, config, release, true);

    expect(mocks.createGithubRelease).not.toHaveBeenCalled();
  });
});

describe("createRelease on GitLab", () => {
  test("creates the release and returns its edit page", async () => {
    const url = "https://gitlab.com/acme/shop/-/releases/v1.3.0-pre.0/edit";
    mocks.createGitlabRelease.mockResolvedValue(url);

    expect(await createRelease(gitlab, gitlabProvider, config, release, false)).toEqual({
      url,
      notesInReleasePage: true,
    });
    expect(mocks.createGitlabRelease).toHaveBeenCalledWith(gitlab, "glpat-config", release);
  });

  test("falls back to the empty page when the API fails", async () => {
    mocks.createGitlabRelease.mockRejectedValue(new Error("GitLab API returned 401"));

    const result = await createRelease(gitlab, gitlabProvider, config, release, false);

    expect(result.url).toBe("https://gitlab.com/acme/shop/-/releases/new?tag_name=v1.3.0-pre.0");
    expect(result.notesInReleasePage).toBe(false);
  });

  test("creates nothing in preview", async () => {
    await createRelease(gitlab, gitlabProvider, config, release, true);

    expect(mocks.createGitlabRelease).not.toHaveBeenCalled();
  });
});
