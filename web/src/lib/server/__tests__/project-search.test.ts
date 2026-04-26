import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FILE_VIEW_SIZE_LIMIT_BYTES } from "../file-policy";
import { MAX_PROJECT_SEARCH_RESULTS, searchProjectFiles } from "../project-search";

const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanupTasks.length > 0) {
    const cleanup = cleanupTasks.pop();

    if (cleanup) {
      await cleanup();
    }
  }
});

describe("searchProjectFiles", () => {
  it("finds case-insensitive line matches in searchable text files and prioritizes path matches", async () => {
    const projectRoot = await createProject("finds-matches");
    await writeProjectFile(projectRoot, "notes.md", "# Notes\nAlpha target line\n");
    await writeProjectFile(projectRoot, "docs/config.txt", "plain TARGET text\n");
    await writeProjectFile(projectRoot, "data/settings.json", '{ "name": "target" }\n');
    await writeProjectFile(projectRoot, "plans/target-log.yaml", "title: target path priority\n");
    await writeProjectFile(projectRoot, ".llm-wiki/hidden.md", "target hidden\n");

    const response = await searchProjectFiles(projectRoot, " target ");

    expect(response.query).toBe("target");
    expect(response.results.map((result) => result.relativePath)).toEqual([
      "plans/target-log.yaml",
      "data/settings.json",
      "docs/config.txt",
      "notes.md",
    ]);
    expect(response.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relativePath: "notes.md",
          lineNumber: 2,
          lineText: "Alpha target line",
          matchStart: 6,
          matchEnd: 12,
        }),
        expect.objectContaining({
          relativePath: "docs/config.txt",
          lineNumber: 1,
          lineText: "plain TARGET text",
          matchStart: 6,
          matchEnd: 12,
        }),
      ]),
    );
    expect(response.results.find((result) => result.relativePath === "notes.md")?.preview).toContain(
      "target",
    );
    expect(response.summary).toEqual({
      scannedFiles: 4,
      skippedFiles: 0,
      matchedFiles: 4,
      totalMatches: 4,
      truncated: false,
    });
  });

  it("returns an empty zero summary for short trimmed queries without scanning", async () => {
    const projectRoot = await createProject("short-query");
    await writeProjectFile(projectRoot, "target.md", "target\n");

    const response = await searchProjectFiles(projectRoot, " t ");

    expect(response).toEqual({
      query: "t",
      results: [],
      summary: {
        scannedFiles: 0,
        skippedFiles: 0,
        matchedFiles: 0,
        totalMatches: 0,
        truncated: false,
      },
    });
  });

  it("skips metadata, unsupported, oversized, and invalid UTF-8 files", async () => {
    const projectRoot = await createProject("skips-files");
    await writeProjectFile(projectRoot, "valid.md", "target\n");
    await writeProjectFile(projectRoot, "raw/source.pdf", "target\n");
    await writeProjectFile(projectRoot, "image.png", "target\n");
    await fs.writeFile(
      path.join(projectRoot, "big.md"),
      Buffer.alloc(FILE_VIEW_SIZE_LIMIT_BYTES + 1, "target"),
    );
    await fs.writeFile(path.join(projectRoot, "broken.txt"), Buffer.from([0xc3, 0x28]));

    const response = await searchProjectFiles(projectRoot, "target");

    expect(response.results.map((result) => result.relativePath)).toEqual(["valid.md"]);
    expect(response.summary).toEqual({
      scannedFiles: 1,
      skippedFiles: 4,
      matchedFiles: 1,
      totalMatches: 1,
      truncated: false,
    });
  });

  it("truncates large result sets using the exported max result limit", async () => {
    const projectRoot = await createProject("truncates-results");

    for (let fileIndex = 0; fileIndex < 12; fileIndex += 1) {
      await writeProjectFile(
        projectRoot,
        `file-${fileIndex.toString().padStart(2, "0")}.md`,
        Array.from({ length: 6 }, (_, lineIndex) => `target ${fileIndex}-${lineIndex}`).join("\n"),
      );
    }

    const response = await searchProjectFiles(projectRoot, "target");

    expect(response.results).toHaveLength(MAX_PROJECT_SEARCH_RESULTS);
    expect(response.summary).toEqual({
      scannedFiles: 12,
      skippedFiles: 0,
      matchedFiles: 12,
      totalMatches: 72,
      truncated: true,
    });
  });

  it("marks truncated and counts all matches when one file exceeds the per-file result cap", async () => {
    const projectRoot = await createProject("per-file-cap");
    await writeProjectFile(
      projectRoot,
      "many.md",
      Array.from({ length: 6 }, (_, lineIndex) => `target line ${lineIndex + 1}`).join("\n"),
    );

    const response = await searchProjectFiles(projectRoot, "target");

    expect(response.results).toHaveLength(5);
    expect(response.results.map((result) => result.lineNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(response.summary).toEqual({
      scannedFiles: 1,
      skippedFiles: 0,
      matchedFiles: 1,
      totalMatches: 6,
      truncated: true,
    });
  });

  it("sorts by line number before relative path after path match priority", async () => {
    const projectRoot = await createProject("sorts-by-line");
    await writeProjectFile(projectRoot, "alpha.md", "intro\nsecond target\n");
    await writeProjectFile(projectRoot, "zeta.md", "first target\n");

    const response = await searchProjectFiles(projectRoot, "target");

    expect(response.results.map((result) => `${result.relativePath}:${result.lineNumber}`)).toEqual([
      "zeta.md:1",
      "alpha.md:2",
    ]);
  });
});

async function createProject(name: string): Promise<string> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "llm-wiki-web-search-"));
  const projectRoot = path.join(tempRoot, name);

  await fs.mkdir(projectRoot, { recursive: true });
  cleanupTasks.push(() => fs.rm(tempRoot, { recursive: true, force: true }));

  return projectRoot;
}

async function writeProjectFile(projectRoot: string, relativePath: string, content: string): Promise<void> {
  const filePath = path.join(projectRoot, relativePath);

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}
