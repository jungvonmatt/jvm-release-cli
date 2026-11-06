// `ui()` asks questions, so in CI it must stop with an error instead of waiting for an answer.
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

const prompts = vi.hoisted(() => ({ confirm: vi.fn(), select: vi.fn() }));
vi.mock("@inquirer/prompts", () => prompts);

const git = vi.hoisted(() => ({
  getLatestTag: vi.fn(),
  getLatestReleaseTag: vi.fn(),
  commitLogFromRevision: vi.fn(),
}));
vi.mock("../src/git.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/git.ts")>()),
  ...git,
}));

const { ui } = await import("../src/ui.ts");

beforeEach(() => {
  vi.resetAllMocks();
  git.getLatestTag.mockResolvedValue("v1.2.0");
  git.getLatestReleaseTag.mockResolvedValue("v1.2.0");
  git.commitLogFromRevision.mockResolvedValue("PROJ-1 Add basket abc1234");
  vi.stubEnv("CI", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ui in CI", () => {
  test("returns the version for the target without a prompt", async () => {
    expect(await ui("prerelease", "1.2.0")).toMatchObject({ version: "v1.3.0-pre.0" });
    expect(prompts.select).not.toHaveBeenCalled();
    expect(prompts.confirm).not.toHaveBeenCalled();
  });

  test("asks for the target as an argument instead of a selection", async () => {
    await expect(ui(undefined, "1.2.0")).rejects.toThrow("jvm-release prerelease");
    expect(prompts.select).not.toHaveBeenCalled();
  });

  test("stops when there is nothing to release", async () => {
    git.commitLogFromRevision.mockResolvedValue("");

    await expect(ui("prerelease", "1.2.0")).rejects.toThrow(
      "No commits since v1.2.0, so there is nothing to release.",
    );
    expect(prompts.confirm).not.toHaveBeenCalled();
  });

  test("promotes a pending prerelease without new commits", async () => {
    git.getLatestTag.mockResolvedValue("v1.3.0-pre.1");
    git.commitLogFromRevision.mockResolvedValue("");

    expect(await ui("production", "1.3.0-pre.1")).toMatchObject({
      version: "v1.3.0",
      promotedTag: "v1.3.0-pre.1",
    });
  });
});
