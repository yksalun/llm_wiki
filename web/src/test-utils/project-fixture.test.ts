import fs from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createFixtureProject } from "./project-fixture";

const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanupTasks.length > 0) {
    const cleanup = cleanupTasks.pop();
    if (cleanup) {
      await cleanup();
    }
  }
});

describe("createFixtureProject", () => {
  it("creates a minimal llm-wiki project tree for integration tests", async () => {
    const fixture = await createFixtureProject("demo-project");
    cleanupTasks.push(fixture.cleanup);

    expect(await fs.readFile(path.join(fixture.rootDir, "purpose.md"), "utf8")).toContain(
      "# Purpose",
    );
    expect(await fs.readFile(path.join(fixture.rootDir, "schema.md"), "utf8")).toContain(
      "# Schema",
    );
    expect(
      await fs.readFile(path.join(fixture.rootDir, "wiki", "index.md"), "utf8"),
    ).toContain("# Wiki Home");

    await expect(
      fs.readFile(path.join(fixture.rootDir, "raw", "sources", "demo.pdf"), "utf8"),
    ).resolves.toBe("fake-pdf");
  });
});
