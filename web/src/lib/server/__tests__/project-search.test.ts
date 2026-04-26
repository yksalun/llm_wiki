import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { FILE_VIEW_SIZE_LIMIT_BYTES } from "../file-policy";
import {
  MAX_PROJECT_SEARCH_LINE_TEXT_LENGTH,
  MAX_PROJECT_SEARCH_QUERY_LENGTH,
  MAX_PROJECT_SEARCH_RESULTS,
  searchProjectFiles,
  searchProjectFilesForQueries,
} from "../project-search";
import type { ProjectTextScanResult } from "../project-text-scan";

const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  vi.restoreAllMocks();

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

  it("keeps match offsets in the original line when earlier Unicode lowercasing expands", async () => {
    const projectRoot = await createProject("unicode-offsets");
    await writeProjectFile(projectRoot, "unicode.md", "İ target\n");

    const response = await searchProjectFiles(projectRoot, "target");
    const result = response.results[0];

    expect(result).toEqual(
      expect.objectContaining({
        relativePath: "unicode.md",
        lineNumber: 1,
        lineText: "İ target",
        matchStart: 2,
        matchEnd: 8,
      }),
    );
    expect(result.lineText.slice(result.matchStart, result.matchEnd)).toBe("target");
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

  it("returns an empty zero summary for overlong trimmed queries without scanning", async () => {
    const projectRoot = await createProject("long-query");
    await writeProjectFile(projectRoot, "target.md", "target\n");
    const readdirSpy = vi.spyOn(fs, "readdir");
    expect(MAX_PROJECT_SEARCH_QUERY_LENGTH).toBeGreaterThan(1);
    expect(MAX_PROJECT_SEARCH_QUERY_LENGTH).toBeLessThan(MAX_PROJECT_SEARCH_LINE_TEXT_LENGTH);
    const query = "a".repeat(MAX_PROJECT_SEARCH_QUERY_LENGTH + 1);

    const response = await searchProjectFiles(projectRoot, query);

    expect(readdirSpy).not.toHaveBeenCalled();
    expect(response).toEqual({
      query,
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

  it("returns the top sorted results while counting every match across many files", async () => {
    const projectRoot = await createProject("many-files");

    for (let fileIndex = 0; fileIndex < MAX_PROJECT_SEARCH_RESULTS + 10; fileIndex += 1) {
      await writeProjectFile(
        projectRoot,
        `result-${fileIndex.toString().padStart(2, "0")}.md`,
        `target ${fileIndex}\n`,
      );
    }

    const response = await searchProjectFiles(projectRoot, "target");

    expect(response.results).toHaveLength(MAX_PROJECT_SEARCH_RESULTS);
    expect(response.results.at(0)?.relativePath).toBe("result-00.md");
    expect(response.results.at(-1)?.relativePath).toBe("result-49.md");
    expect(response.summary).toEqual({
      scannedFiles: MAX_PROJECT_SEARCH_RESULTS + 10,
      skippedFiles: 0,
      matchedFiles: MAX_PROJECT_SEARCH_RESULTS + 10,
      totalMatches: MAX_PROJECT_SEARCH_RESULTS + 10,
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

  it("bounds returned line text and keeps match offsets coherent within the cropped line", async () => {
    const projectRoot = await createProject("long-line");
    await writeProjectFile(projectRoot, "long.json", `${"a".repeat(220)}target${"b".repeat(220)}\n`);

    const response = await searchProjectFiles(projectRoot, "target");
    const result = response.results[0];

    expect(result.lineText.length).toBeLessThanOrEqual(MAX_PROJECT_SEARCH_LINE_TEXT_LENGTH);
    expect(result.lineText.startsWith("...")).toBe(true);
    expect(result.lineText.endsWith("...")).toBe(true);
    expect(result.matchStart).toBeGreaterThanOrEqual(0);
    expect(result.matchEnd).toBeLessThanOrEqual(result.lineText.length);
    expect(result.lineText.slice(result.matchStart, result.matchEnd)).toBe("target");
    expect(result.preview).toBe(result.lineText);
  });

  it("hard-bounds line text for a max-length query near the start of a long line", async () => {
    const projectRoot = await createProject("max-query-start");
    const query = "a".repeat(MAX_PROJECT_SEARCH_QUERY_LENGTH);
    await writeProjectFile(projectRoot, "start.md", `${query}${"b".repeat(43)}\n`);

    const response = await searchProjectFiles(projectRoot, query);
    const result = response.results[0];

    expect(result.lineText.length).toBeLessThanOrEqual(MAX_PROJECT_SEARCH_LINE_TEXT_LENGTH);
    expect(result.matchStart).toBeGreaterThanOrEqual(0);
    expect(result.matchEnd).toBeLessThanOrEqual(result.lineText.length);
    expect(result.lineText.slice(result.matchStart, result.matchEnd)).toBe(query);
  });

  it("hard-bounds line text for a max-length query near the end of a long line", async () => {
    const projectRoot = await createProject("max-query-end");
    const query = "z".repeat(MAX_PROJECT_SEARCH_QUERY_LENGTH);
    await writeProjectFile(projectRoot, "end.md", `${"b".repeat(43)}${query}\n`);

    const response = await searchProjectFiles(projectRoot, query);
    const result = response.results[0];

    expect(result.lineText.length).toBeLessThanOrEqual(MAX_PROJECT_SEARCH_LINE_TEXT_LENGTH);
    expect(result.matchStart).toBeGreaterThanOrEqual(0);
    expect(result.matchEnd).toBeLessThanOrEqual(result.lineText.length);
    expect(result.lineText.slice(result.matchStart, result.matchEnd)).toBe(query);
  });

  it("skips files that become oversized after the initial stat guard", async () => {
    const projectRoot = await createProject("post-read-size");
    const relativePath = "race.md";
    await writeProjectFile(projectRoot, relativePath, "target\n");
    vi.spyOn(fs, "open").mockResolvedValue({
      read: vi.fn(async (buffer: Buffer) => ({
        bytesRead: buffer.byteLength,
        buffer,
      })),
      close: vi.fn(async () => undefined),
    } as unknown as Awaited<ReturnType<typeof fs.open>>);

    const response = await searchProjectFiles(projectRoot, "target");

    expect(response.results).toEqual([]);
    expect(response.summary).toEqual({
      scannedFiles: 0,
      skippedFiles: 1,
      matchedFiles: 0,
      totalMatches: 0,
      truncated: false,
    });
  });

  it("reads searchable files with a bounded read buffer and closes the file handle", async () => {
    const projectRoot = await createProject("bounded-read");
    const relativePath = "bounded.md";
    await writeProjectFile(projectRoot, relativePath, "target\n");
    const content = Buffer.from("target\n", "utf8");
    const read = vi.fn(async (buffer: Buffer) => {
      content.copy(buffer);

      return { bytesRead: content.byteLength, buffer };
    });
    const close = vi.fn(async () => undefined);
    const openSpy = vi.spyOn(fs, "open").mockResolvedValue({
      read,
      close,
    } as unknown as Awaited<ReturnType<typeof fs.open>>);
    const readFileSpy = vi.spyOn(fs, "readFile");

    const response = await searchProjectFiles(projectRoot, "target");

    expect(response.results).toHaveLength(1);
    expect(openSpy).toHaveBeenCalledWith(path.join(projectRoot, relativePath), "r");
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0][0]).toBeInstanceOf(Buffer);
    expect(read.mock.calls[0][0].byteLength).toBe(FILE_VIEW_SIZE_LIMIT_BYTES + 1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(readFileSpy).not.toHaveBeenCalled();
  });

  it("searches multiple valid queries from one scan while keeping independent summaries", async () => {
    const projectRoot = await createProject("multi-query-one-scan");
    const yieldedScans: string[] = [];
    const scanTextFiles = vi.fn((): ProjectTextScanResult => ({
      files: scanInjectedFiles([
        { relativePath: "alpha.md", content: "alpha target\nbeta only\n" },
        { relativePath: "beta.md", content: "beta target\nbeta again\n" },
      ], yieldedScans),
      stats: { skippedFiles: 1 },
    }));

    const responses = await searchProjectFilesForQueries(projectRoot, ["alpha", "beta"], {
      scanTextFiles,
    });

    expect(scanTextFiles).toHaveBeenCalledTimes(1);
    expect(scanTextFiles).toHaveBeenCalledWith(projectRoot);
    expect(yieldedScans).toEqual(["alpha.md", "beta.md"]);
    expect(responses.map((response) => response.query)).toEqual(["alpha", "beta"]);
    expect(responses[0].results.map((result) => result.relativePath)).toEqual(["alpha.md"]);
    expect(responses[0].summary).toEqual({
      scannedFiles: 2,
      skippedFiles: 1,
      matchedFiles: 1,
      totalMatches: 1,
      truncated: false,
    });
    expect(responses[1].results.map((result) => `${result.relativePath}:${result.lineNumber}`)).toEqual([
      "beta.md:1",
      "beta.md:2",
      "alpha.md:2",
    ]);
    expect(responses[1].summary).toEqual({
      scannedFiles: 2,
      skippedFiles: 1,
      matchedFiles: 2,
      totalMatches: 3,
      truncated: false,
    });
  });

  it("does not scan for invalid multi-query entries and keeps valid results independent", async () => {
    const projectRoot = await createProject("multi-query-invalid");
    const scanTextFiles = vi.fn((): ProjectTextScanResult => ({
      files: scanInjectedFiles([{ relativePath: "valid.md", content: "target\n" }]),
      stats: { skippedFiles: 0 },
    }));

    const responses = await searchProjectFilesForQueries(
      projectRoot,
      [" t ", " target ", "a".repeat(MAX_PROJECT_SEARCH_QUERY_LENGTH + 1)],
      { scanTextFiles },
    );

    expect(scanTextFiles).toHaveBeenCalledTimes(1);
    expect(responses[0]).toEqual({
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
    expect(responses[1].results.map((result) => result.relativePath)).toEqual(["valid.md"]);
    expect(responses[1].summary).toEqual({
      scannedFiles: 1,
      skippedFiles: 0,
      matchedFiles: 1,
      totalMatches: 1,
      truncated: false,
    });
    expect(responses[2]).toEqual({
      query: "a".repeat(MAX_PROJECT_SEARCH_QUERY_LENGTH + 1),
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

async function* scanInjectedFiles(
  files: Array<{ relativePath: string; content: string }>,
  yieldedPaths: string[] = [],
): ProjectTextScanResult["files"] {
  for (const file of files) {
    yieldedPaths.push(file.relativePath);
    yield {
      relativePath: file.relativePath,
      content: file.content,
      size: Buffer.byteLength(file.content),
      extension: path.extname(file.relativePath).slice(1),
    };
  }
}
