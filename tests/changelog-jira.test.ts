import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { fetchJiraTickets, verifyJiraCredentials } from "../src/changelog/jira.ts";
import type { ChangelogConfig } from "../src/changelog/types.ts";

const config: ChangelogConfig = {
  jiraBaseUrl: "https://myorg.atlassian.net",
  jiraApiEmail: "me@myorg.com",
  jiraApiToken: "token",
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchJiraTickets", () => {
  test("maps the issues of the search response", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        issues: [
          {
            key: "PROJ-1",
            fields: {
              summary: "Basket",
              issuetype: { name: "Story" },
              assignee: { displayName: "Alice" },
            },
          },
        ],
      }),
    });

    const tickets = await fetchJiraTickets(["PROJ-1"], config);

    expect(tickets.get("PROJ-1")).toEqual({
      key: "PROJ-1",
      summary: "Basket",
      type: "Story",
      assignee: "Alice",
    });
    expect(console.warn).not.toHaveBeenCalled();
  });

  test("warns when Jira answers with no issues (bad credentials on Jira Cloud)", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ issues: [] }) });

    const tickets = await fetchJiraTickets(["PROJ-1", "PROJ-2"], config);

    expect(tickets.size).toBe(0);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Jira returned none of the 2 tickets"),
    );
  });
});

test("fetchJiraTickets names jvm-release init when credentials are missing", async () => {
  await fetchJiraTickets(["LEV-1"], { jiraBaseUrl: config.jiraBaseUrl });
  expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("jvm-release init"));
});

test("fetchJiraTickets names the CI variables when credentials are missing in CI", async () => {
  vi.stubEnv("CI", "true");
  try {
    await fetchJiraTickets(["PROJ-1"], { jiraBaseUrl: config.jiraBaseUrl });
  } finally {
    vi.unstubAllEnvs();
  }
  expect(console.warn).toHaveBeenCalledWith(
    expect.stringContaining("Set CHANGELOG_JIRA_API_EMAIL and CHANGELOG_JIRA_API_TOKEN"),
  );
  expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining("jvm-release init"));
});

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
