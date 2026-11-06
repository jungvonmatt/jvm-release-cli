import { describe, expect, test } from "vite-plus/test";
import { detectProvider, github, gitlab } from "../src/provider/index.ts";

const release = {
  version: "v1.3.0-pre.0",
  changelog: "## Story\n\n- PROJ-1 Basket",
  isPrerelease: true,
  target: "main",
};

describe("releasePage", () => {
  test("GitHub draft is prefilled with tag, title, notes and prerelease flag", () => {
    const page = github.releasePage({ host: "github.com", path: "acme/shop" }, release);
    const url = new URL(page.url);

    expect(url.origin + url.pathname).toBe("https://github.com/acme/shop/releases/new");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      tag: "v1.3.0-pre.0",
      target: "main",
      title: "v1.3.0-pre.0",
      body: "## Story\n\n- PROJ-1 Basket",
      prerelease: "1",
    });
    expect(page.includesNotes).toBe(true);
  });

  test("GitHub stable release sets prerelease to 0", () => {
    const page = github.releasePage(
      { host: "github.com", path: "acme/shop" },
      {
        ...release,
        version: "v1.3.0",
        isPrerelease: false,
      },
    );

    expect(new URL(page.url).searchParams.get("prerelease")).toBe("0");
  });

  test("GitLab page is prefilled with the tag only", () => {
    const page = gitlab.releasePage({ host: "gitlab.com", path: "acme/web/shop" }, release);

    expect(page.url).toBe("https://gitlab.com/acme/web/shop/-/releases/new?tag_name=v1.3.0-pre.0");
    expect(page.includesNotes).toBe(false);
  });

  test("keeps the port of a self-hosted instance", () => {
    const page = gitlab.releasePage({ host: "gitlab.acme.com:8443", path: "acme/shop" }, release);

    expect(page.url).toMatch(/^https:\/\/gitlab\.acme\.com:8443\/acme\/shop\/-\/releases\/new/);
  });
});

describe("detectProvider", () => {
  test("detects GitHub and GitLab hosts", () => {
    expect(detectProvider("github.com")).toBe("github");
    expect(detectProvider("github.acme.com")).toBe("github");
    expect(detectProvider("gitlab.com")).toBe("gitlab");
    expect(detectProvider("gitlab.acme.com:8443")).toBe("gitlab");
  });

  test("returns null for unknown hosts", () => {
    expect(detectProvider("git.acme.com")).toBeNull();
  });
});
