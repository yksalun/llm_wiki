import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { LawSourceRecord } from "../law-db/repo";
import {
  buildLawMarkdown,
  sanitizeLawFileBaseName,
  syncLawSources,
} from "../law-source-sync";

const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanupTasks.length > 0) {
    const cleanup = cleanupTasks.pop();
    if (cleanup) await cleanup();
  }
});

describe("law source sync", () => {
  it("sanitizes unsafe file names and falls back for empty titles", () => {
    expect(sanitizeLawFileBaseName(" 中华/人民:统计*法? ")).toBe("中华-人民-统计-法");
    expect(sanitizeLawFileBaseName("")).toBe("");
  });

  it("builds markdown from content without sourceHtml", () => {
    const markdown = buildLawMarkdown(
      record({ myId: "abc123", title: "统计法", content: "正文" }),
      "sha256:test",
    );

    expect(markdown).toContain('sourceType: "mysql-law"');
    expect(markdown).toContain('myId: "abc123"');
    expect(markdown).toContain("# 统计法");
    expect(markdown).toContain("正文");
    expect(markdown).not.toContain("sourceHtml");
  });

  it("creates files, resolves title collisions, and writes sync state", async () => {
    const projectRoot = await makeProjectRoot();

    const result = await syncLawSources(projectRoot, [
      record({ myId: "abc123456789", title: "统计法", content: "正文 A" }),
      record({ myId: "def987654321", title: "统计法", content: "正文 B" }),
      record({ myId: "empty-title", title: "", content: "正文 C" }),
    ]);

    expect(result.summary).toMatchObject({
      read: 3,
      created: 3,
      updated: 0,
      skipped: 0,
      failed: 0,
    });
    expect(result.changedFiles).toEqual([
      "raw/sources/database/law/law-empty-ti.md",
      "raw/sources/database/law/统计法.md",
      "raw/sources/database/law/统计法-def98765.md",
    ]);
    await expect(readProjectFile(projectRoot, "raw/sources/database/law/统计法.md")).resolves.toContain("正文 A");
    await expect(readProjectFile(projectRoot, "raw/sources/database/law/.sync-state.json")).resolves.toContain("abc123456789");
  });

  it("skips unchanged records and updates changed records by myId", async () => {
    const projectRoot = await makeProjectRoot();

    await syncLawSources(projectRoot, [
      record({ myId: "abc123456789", title: "统计法", content: "正文 A" }),
    ]);
    const second = await syncLawSources(projectRoot, [
      record({ myId: "abc123456789", title: "统计法", content: "正文 A" }),
    ]);
    const third = await syncLawSources(projectRoot, [
      record({ myId: "abc123456789", title: "统计法", content: "正文 A updated" }),
    ]);

    expect(second.summary).toMatchObject({
      read: 1,
      created: 0,
      updated: 0,
      skipped: 1,
      failed: 0,
    });
    expect(third.summary).toMatchObject({
      read: 1,
      created: 0,
      updated: 1,
      skipped: 0,
      failed: 0,
    });
    await expect(readProjectFile(projectRoot, "raw/sources/database/law/统计法.md")).resolves.toContain("正文 A updated");
  });
});

function record(overrides: Partial<LawSourceRecord>): LawSourceRecord {
  return {
    myId: "abc123",
    title: "统计法",
    content: "正文",
    url: "http://example.test/law",
    lawTime: "2024-09-13",
    insertTime: "2026-04-24 10:37:52",
    type: "law",
    ...overrides,
  };
}

async function makeProjectRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "law-sync-"));
  cleanupTasks.push(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function readProjectFile(projectRoot: string, relativePath: string): Promise<string> {
  return fs.readFile(path.join(projectRoot, relativePath), "utf8");
}
