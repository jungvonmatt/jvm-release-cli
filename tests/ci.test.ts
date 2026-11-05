import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

const prompts = vi.hoisted(() => ({ confirm: vi.fn() }));
vi.mock("@inquirer/prompts", () => prompts);

const { confirmOrFail, isCI, showReleasePage } = await import("../src/ci.ts");

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("isCI", () => {
  test("is true when CI is set", () => {
    expect(isCI({ CI: "true" })).toBe(true);
    expect(isCI({ CI: "1" })).toBe(true);
  });

  test("is false when CI is missing, empty or turned off", () => {
    expect(isCI({})).toBe(false);
    expect(isCI({ CI: "" })).toBe(false);
    expect(isCI({ CI: "false" })).toBe(false);
    expect(isCI({ CI: "0" })).toBe(false);
  });
});

describe("confirmOrFail", () => {
  const question = { message: "Continue?", default: false };

  test("asks the question on a terminal", async () => {
    prompts.confirm.mockResolvedValue(true);

    expect(await confirmOrFail(question, "stopped")).toBe(true);
    expect(prompts.confirm).toHaveBeenCalledWith(question);
  });

  test("throws in CI instead of waiting for an answer", async () => {
    vi.stubEnv("CI", "true");

    await expect(confirmOrFail(question, "stopped")).rejects.toThrow("stopped");
    expect(prompts.confirm).not.toHaveBeenCalled();
  });
});

describe("showReleasePage", () => {
  const url = "https://gitlab.com/acme/shop/-/releases/v1.3.0/edit";

  test("opens the browser on a terminal", async () => {
    const open = vi.fn().mockResolvedValue(undefined);

    await showReleasePage(url, open);

    expect(open).toHaveBeenCalledWith(url);
    expect(console.log).not.toHaveBeenCalled();
  });

  test("prints the URL in CI instead of opening a browser", async () => {
    vi.stubEnv("CI", "true");
    const open = vi.fn();

    await showReleasePage(url, open);

    expect(open).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(`Release page: ${url}`);
  });

  test("prints the URL when the browser does not open", async () => {
    const open = vi.fn().mockRejectedValue(new Error("no display"));

    await showReleasePage(url, open);

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(url));
  });
});
