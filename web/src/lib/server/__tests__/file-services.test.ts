import fs from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createFixtureProject } from "@/test-utils/project-fixture";

import { readProjectFile } from "../file-reader";
import { writeProjectFile } from "../file-writer";
import { listProjectTree } from "../project-tree";

const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanupTasks.length > 0) {
    const cleanup = cleanupTasks.pop();

    if (cleanup) {
      await cleanup();
    }
  }
});

describe("listProjectTree", () => {
  it("returns a stable relative project tree and hides the root .llm-wiki directory", async () => {
    const fixture = await createFixtureProject("tree-project");
    cleanupTasks.push(fixture.cleanup);

    await fs.mkdir(path.join(fixture.rootDir, ".llm-wiki"), { recursive: true });
    await fs.writeFile(path.join(fixture.rootDir, ".llm-wiki", "project.json"), "{}\n", "utf8");

    const tree = await listProjectTree(fixture.rootDir);

    expect(tree).toEqual([
      {
        name: "raw",
        relativePath: "raw",
        nodeType: "directory",
        children: [
          {
            name: "sources",
            relativePath: "raw/sources",
            nodeType: "directory",
            children: [
              {
                name: "demo.pdf",
                relativePath: "raw/sources/demo.pdf",
                nodeType: "file",
              },
            ],
          },
        ],
      },
      {
        name: "wiki",
        relativePath: "wiki",
        nodeType: "directory",
        children: [
          {
            name: "index.md",
            relativePath: "wiki/index.md",
            nodeType: "file",
          },
        ],
      },
      {
        name: "purpose.md",
        relativePath: "purpose.md",
        nodeType: "file",
      },
      {
        name: "schema.md",
        relativePath: "schema.md",
        nodeType: "file",
      },
    ]);

    expect(tree.flatMap(flattenRelativePaths)).not.toContain(".llm-wiki");
    expect(tree.flatMap(flattenRelativePaths).every((relativePath) => !path.isAbsolute(relativePath))).toBe(
      true,
    );
    expect(tree.flatMap(flattenRelativePaths).every((relativePath) => !relativePath.includes(fixture.rootDir))).toBe(
      true,
    );
  });
});

describe("readProjectFile", () => {
  it("reads editable wiki markdown files as UTF-8 text", async () => {
    const fixture = await createFixtureProject("read-editable");
    cleanupTasks.push(fixture.cleanup);

    const result = await readProjectFile(fixture.rootDir, "wiki/index.md");

    expect(result).toMatchObject({
      relativePath: "wiki/index.md",
      mode: "editable",
      content: "# Wiki Home\n",
      editable: true,
      metadata: {},
    });
    expect(result.size).toBeGreaterThan(0);
    expect(result.lastModified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns metadata-only responses for metadata files", async () => {
    const fixture = await createFixtureProject("read-metadata");
    cleanupTasks.push(fixture.cleanup);

    const result = await readProjectFile(fixture.rootDir, "raw/sources/demo.pdf");

    expect(result).toMatchObject({
      relativePath: "raw/sources/demo.pdf",
      mode: "metadata",
      content: null,
      editable: false,
      metadata: {
        reason: "metadata_only",
        extension: ".pdf",
      },
    });
  });

  it("returns unsupported when a text file cannot be decoded as UTF-8", async () => {
    const fixture = await createFixtureProject("read-invalid-utf8");
    cleanupTasks.push(fixture.cleanup);

    await fs.writeFile(path.join(fixture.rootDir, "wiki", "broken.md"), Buffer.from([0xc3, 0x28]));

    const result = await readProjectFile(fixture.rootDir, "wiki/broken.md");

    expect(result).toMatchObject({
      relativePath: "wiki/broken.md",
      mode: "unsupported",
      content: null,
      editable: false,
      metadata: {
        reason: "invalid_utf8",
      },
    });
  });

  it("rejects invalid or escaping file paths with AppError", async () => {
    const fixture = await createFixtureProject("read-invalid");
    cleanupTasks.push(fixture.cleanup);

    await expect(readProjectFile(fixture.rootDir, "../secret.md")).rejects.toMatchObject({
      code: "INVALID_FILE_PATH",
      status: 400,
    });
    await expect(readProjectFile(fixture.rootDir, "")).rejects.toMatchObject({
      code: "INVALID_FILE_PATH",
      status: 400,
    });
  });

  it("returns a 404 AppError when the file does not exist", async () => {
    const fixture = await createFixtureProject("read-missing");
    cleanupTasks.push(fixture.cleanup);

    await expect(readProjectFile(fixture.rootDir, "wiki/missing.md")).rejects.toMatchObject({
      code: "FILE_NOT_FOUND",
      status: 404,
    });
  });
});

describe("writeProjectFile", () => {
  it("writes editable files, updates lastModified, and persists content", async () => {
    const fixture = await createFixtureProject("write-purpose");
    cleanupTasks.push(fixture.cleanup);

    const before = await readProjectFile(fixture.rootDir, "purpose.md");

    const result = await writeProjectFile(fixture.rootDir, {
      relativePath: "purpose.md",
      content: "# Purpose\n\nUpdated project purpose.\n",
      lastModified: before.lastModified,
    });

    const diskContent = await fs.readFile(path.join(fixture.rootDir, "purpose.md"), "utf8");
    const after = await readProjectFile(fixture.rootDir, "purpose.md");

    expect(diskContent).toBe("# Purpose\n\nUpdated project purpose.\n");
    expect(result.relativePath).toBe("purpose.md");
    expect(result.lastModified).not.toBe(before.lastModified);
    expect(result.lastModified).toBe(after.lastModified);
    expect(after.content).toBe("# Purpose\n\nUpdated project purpose.\n");
  });

  it("rejects non-writable files", async () => {
    const fixture = await createFixtureProject("write-reject");
    cleanupTasks.push(fixture.cleanup);

    await expect(
      writeProjectFile(fixture.rootDir, {
        relativePath: "raw/sources/demo.pdf",
        content: "nope",
        lastModified: null,
      }),
    ).rejects.toMatchObject({
      code: "FILE_NOT_WRITABLE",
      status: 400,
    });
  });

  it("rejects stale writes when lastModified does not match", async () => {
    const fixture = await createFixtureProject("write-conflict");
    cleanupTasks.push(fixture.cleanup);

    await expect(
      writeProjectFile(fixture.rootDir, {
        relativePath: "purpose.md",
        content: "# Purpose\n\nConflict write.\n",
        lastModified: "2020-01-01T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({
      code: "FILE_WRITE_CONFLICT",
      status: 409,
    });
  });

  it("rejects invalid or escaping write paths", async () => {
    const fixture = await createFixtureProject("write-invalid");
    cleanupTasks.push(fixture.cleanup);

    await expect(
      writeProjectFile(fixture.rootDir, {
        relativePath: "../purpose.md",
        content: "bad",
        lastModified: null,
      }),
    ).rejects.toMatchObject({
      code: "INVALID_FILE_PATH",
      status: 400,
    });
  });
});

function flattenRelativePaths(node: {
  relativePath: string;
  children?: Array<{ relativePath: string; children?: Array<unknown> }>;
}): string[] {
  return [
    node.relativePath,
    ...(node.children?.flatMap((child) =>
      flattenRelativePaths(child as {
        relativePath: string;
        children?: Array<{ relativePath: string; children?: Array<unknown> }>;
      }),
    ) ?? []),
  ];
}
