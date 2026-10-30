import { afterEach, describe, expect, test, vi } from "vite-plus/test";

const loadConfigMock = vi.fn();
vi.mock("@jungvonmatt/config-loader", () => ({
  loadConfig: (...args: any[]) => loadConfigMock(...args),
}));

const { loadChangelogConfig } = await import("../src/config.ts");

function mockConfig(config: Record<string, unknown>) {
  loadConfigMock.mockResolvedValue({ config, missing: [] });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("loadChangelogConfig", () => {
  test("adds https:// to a bare Jira host", async () => {
    mockConfig({ jiraBaseUrl: "myorg.atlassian.net", jiraApiHost: "myorg.atlassian.net" });

    const config = await loadChangelogConfig();

    expect(config.jiraBaseUrl).toBe("https://myorg.atlassian.net");
    expect(config.jiraApiHost).toBe("https://myorg.atlassian.net");
  });

  test("keeps URLs that already have a protocol", async () => {
    mockConfig({
      jiraBaseUrl: "https://myorg.atlassian.net",
      jiraApiHost: "http://jira.internal:8080",
    });

    const config = await loadChangelogConfig();

    expect(config.jiraBaseUrl).toBe("https://myorg.atlassian.net");
    expect(config.jiraApiHost).toBe("http://jira.internal:8080");
  });

  test("leaves missing Jira values unset", async () => {
    mockConfig({ ticketPattern: "[A-Z]+-\\d+" });

    const config = await loadChangelogConfig();

    expect(config.jiraBaseUrl).toBeUndefined();
    expect(config.jiraApiHost).toBeUndefined();
    expect(config.ticketPattern).toBe("[A-Z]+-\\d+");
  });
});
