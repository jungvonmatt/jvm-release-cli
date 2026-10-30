import { describe, expect, test } from "vite-plus/test";
import { getReleasePage } from "../src/release-page.ts";

const release = {
  version: "v1.3.0-pre.0",
  changelog: "## Story\n\n- PROJ-1 Basket",
  isPrerelease: true,
  target: "main",
};

describe("getReleasePage", () => {
  test("GitHub draft is prefilled with tag, title, notes and prerelease flag", () => {
    const page = getReleasePage({ host: "github.com", path: "acme/shop" }, "github", release);
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
    const page = getReleasePage({ host: "github.com", path: "acme/shop" }, "github", {
      ...release,
      version: "v1.3.0",
      isPrerelease: false,
    });

    expect(new URL(page.url).searchParams.get("prerelease")).toBe("0");
  });

  test("GitLab page is prefilled with the tag only", () => {
    const page = getReleasePage({ host: "gitlab.com", path: "acme/web/shop" }, "gitlab", release);

    expect(page.url).toBe("https://gitlab.com/acme/web/shop/-/releases/new?tag_name=v1.3.0-pre.0");
    expect(page.includesNotes).toBe(false);
  });

  test("keeps the port of a self-hosted instance", () => {
    const page = getReleasePage(
      { host: "gitlab.acme.com:8443", path: "acme/shop" },
      "gitlab",
      release,
    );

    expect(page.url).toMatch(/^https:\/\/gitlab\.acme\.com:8443\/acme\/shop\/-\/releases\/new/);
  });
});
