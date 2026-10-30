import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { fetchJiraTickets } from "../src/changelog/jira.ts";
import type { ChangelogConfig } from "../src/changelog/types.ts";

const config: ChangelogConfig = {
  jiraBaseUrl: "https://myorg.atlassian.net",
  jiraApiEmail: "me@myorg.com",
  jiraApiToken: "token",
};

const fetchMock = vi.fn();

beforeEach(() => {
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
