import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendLines, RC_FILE, writeRcFile } from "../src/init/files.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "release-cli-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("writeRcFile", () => {
  test("writes formatted JSON without unset keys", async () => {
    const config = { jiraBaseUrl: "https://x.atlassian.net", ticketPattern: "(LEV-\\d+)" };
    await writeRcFile(dir, { ...config, gitProvider: undefined });
    expect(await readFile(join(dir, RC_FILE), "utf8")).toBe(`${JSON.stringify(config, null, 2)}\n`);
  });

  test("does not overwrite an existing file", async () => {
    await writeFile(join(dir, RC_FILE), "{}");
    await expect(writeRcFile(dir, { jiraBaseUrl: "https://x" })).rejects.toThrow();
    expect(await readFile(join(dir, RC_FILE), "utf8")).toBe("{}");
  });
});

describe("appendLines", () => {
  test("creates a missing file", async () => {
    await appendLines(join(dir, ".env"), ["A=1", "B=2"]);
    expect(await readFile(join(dir, ".env"), "utf8")).toBe("A=1\nB=2\n");
  });

  test("starts on a new line when the file has no trailing newline", async () => {
    await writeFile(join(dir, ".env"), "FOO=bar");
    await appendLines(join(dir, ".env"), ["A=1"]);
    expect(await readFile(join(dir, ".env"), "utf8")).toBe("FOO=bar\nA=1\n");
  });

  test("keeps a file that ends with a newline", async () => {
    await writeFile(join(dir, ".env"), "FOO=bar\n");
    await appendLines(join(dir, ".env"), ["A=1"]);
    expect(await readFile(join(dir, ".env"), "utf8")).toBe("FOO=bar\nA=1\n");
  });
});
