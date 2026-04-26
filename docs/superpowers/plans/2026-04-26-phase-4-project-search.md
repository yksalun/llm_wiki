# 阶段 4 项目内检索基础 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Web 工作台内增加当前项目范围的轻量关键词搜索，返回可解释的文件/行级结果，并能点击打开对应文件。

**Architecture:** 服务端新增按需搜索 service 和 `/api/projects/[projectId]/search` 路由，每次查询扫描当前项目内可读文本文件，不持久化索引。前端新增 `ProjectSearch` 面板，调用客户端 API，展示 loading/empty/error/results 状态，并复用 `ProjectWorkbench.requestOpenRelativePath` 打开结果文件。

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, Node fs/path, existing `AppError`/`route-helpers`, existing shadcn/base-ui components, lucide-react.

---

## 文件结构

- Modify: `web/src/lib/types.ts`  
  增加 `ProjectSearchResult`、`ProjectSearchResponse` 类型。
- Modify: `web/src/lib/file-view-policy.ts`  
  增加 `isSearchableTextFileExtension()`，复用现有 Markdown/preview 扩展名规则。
- Create: `web/src/lib/server/project-search.ts`  
  实现按需扫描、读取、匹配、排序和摘要统计。
- Create: `web/src/lib/server/__tests__/project-search.test.ts`  
  覆盖搜索 service 的范围、匹配、跳过和截断。
- Create: `web/src/app/api/projects/[projectId]/search/route.ts`  
  新增搜索 API。
- Create: `web/src/app/api/projects/[projectId]/search/__tests__/route.test.ts`  
  覆盖搜索 API 的成功、短查询和 404。
- Modify: `web/src/lib/client/api.ts`  
  增加 `searchProject()`。
- Create: `web/src/components/workbench/project-search.tsx`  
  新增前端搜索面板。
- Create: `web/src/components/workbench/project-search.test.tsx`  
  覆盖查询过短、结果渲染、点击打开、loading/empty/error。
- Modify: `web/src/components/workbench/project-workbench.tsx`  
  接入搜索面板，并将结果点击交给 `requestOpenRelativePath(relativePath, "Files")`。
- Modify: `web/docs/web-roadmap-next-phases.md`  
  阶段完成后标记阶段 4 已完成。

---

### Task 1: 搜索共享类型与扩展名策略

**Files:**
- Modify: `web/src/lib/types.ts`
- Modify: `web/src/lib/file-view-policy.ts`
- Test: `web/src/lib/file-view-policy.test.ts`

- [ ] **Step 1: 扩展 file-view-policy 测试**

在 `web/src/lib/file-view-policy.test.ts` 中增加测试：

```ts
import {
  getFileExtension,
  isSearchableTextFileExtension,
} from "./file-view-policy";

describe("isSearchableTextFileExtension", () => {
  it("marks markdown and preview text extensions as searchable", () => {
    expect(isSearchableTextFileExtension(getFileExtension("purpose.md"))).toBe(true);
    expect(isSearchableTextFileExtension(getFileExtension("wiki/index.md"))).toBe(true);
    expect(isSearchableTextFileExtension(getFileExtension("notes.txt"))).toBe(true);
    expect(isSearchableTextFileExtension(getFileExtension("data.json"))).toBe(true);
    expect(isSearchableTextFileExtension(getFileExtension("config.yaml"))).toBe(true);
    expect(isSearchableTextFileExtension(getFileExtension("config.yml"))).toBe(true);
  });

  it("does not mark metadata, unsupported, or basename dotfiles as searchable", () => {
    expect(isSearchableTextFileExtension(getFileExtension("raw/sources/demo.pdf"))).toBe(false);
    expect(isSearchableTextFileExtension(getFileExtension("assets/logo.png"))).toBe(false);
    expect(isSearchableTextFileExtension(getFileExtension(".json"))).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm run test -- src/lib/file-view-policy.test.ts
```

Expected: 测试失败，因为 `isSearchableTextFileExtension` 尚未导出。

- [ ] **Step 3: 实现共享 helper**

在 `web/src/lib/file-view-policy.ts` 增加：

```ts
export function isSearchableTextFileExtension(extension: string): boolean {
  return isMarkdownFileExtension(extension) || isPreviewFileExtension(extension);
}
```

说明：当前 `isPreviewFileExtension()` 包含 Markdown，这是为了与服务端 `classifyFileView()` 保持兼容。`isSearchableTextFileExtension()` 显式表达搜索意图，即 Markdown 和可预览文本都可搜索。

- [ ] **Step 4: 增加搜索响应类型**

在 `web/src/lib/types.ts` 末尾增加：

```ts
export interface ProjectSearchResult {
  relativePath: string;
  lineNumber: number;
  lineText: string;
  preview: string;
  matchStart: number;
  matchEnd: number;
}

export interface ProjectSearchResponse {
  query: string;
  results: ProjectSearchResult[];
  summary: {
    scannedFiles: number;
    skippedFiles: number;
    matchedFiles: number;
    totalMatches: number;
    truncated: boolean;
  };
}
```

- [ ] **Step 5: 验证**

Run:

```bash
npm run test -- src/lib/file-view-policy.test.ts
npm run typecheck
```

Expected: 测试和 typecheck 通过。

- [ ] **Step 6: 提交**

Run:

```bash
git add web/src/lib/types.ts web/src/lib/file-view-policy.ts web/src/lib/file-view-policy.test.ts
git commit -m "feat: add project search types"
```

Expected: commit 成功。

---

### Task 2: 服务端项目搜索 service

**Files:**
- Create: `web/src/lib/server/project-search.ts`
- Create: `web/src/lib/server/__tests__/project-search.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `web/src/lib/server/__tests__/project-search.test.ts`：

```ts
import fs from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createFixtureProject } from "@/test-utils/project-fixture";

import {
  MAX_PROJECT_SEARCH_RESULTS,
  searchProjectFiles,
} from "../project-search";

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
  it("finds case-insensitive line matches in searchable text files", async () => {
    const fixture = await createFixtureProject("search-basic");
    cleanupTasks.push(fixture.cleanup);

    await fs.writeFile(path.join(fixture.rootDir, "wiki", "notes.txt"), "Alpha topic\nBeta topic\n", "utf8");
    await fs.writeFile(path.join(fixture.rootDir, "wiki", "data.json"), "{\n  \"topic\": \"alpha\"\n}\n", "utf8");

    const response = await searchProjectFiles(fixture.rootDir, "alpha");

    expect(response.query).toBe("alpha");
    expect(response.summary.scannedFiles).toBeGreaterThanOrEqual(3);
    expect(response.summary.matchedFiles).toBeGreaterThanOrEqual(2);
    expect(response.results.some((result) => result.relativePath === "wiki/notes.txt")).toBe(true);
    expect(response.results.some((result) => result.relativePath === "wiki/data.json")).toBe(true);
    expect(response.results[0]).toMatchObject({
      lineNumber: expect.any(Number),
      lineText: expect.any(String),
      preview: expect.any(String),
      matchStart: expect.any(Number),
      matchEnd: expect.any(Number),
    });
  });

  it("returns an empty summary for short queries", async () => {
    const fixture = await createFixtureProject("search-short");
    cleanupTasks.push(fixture.cleanup);

    const response = await searchProjectFiles(fixture.rootDir, "a");

    expect(response.results).toEqual([]);
    expect(response.summary).toEqual({
      scannedFiles: 0,
      skippedFiles: 0,
      matchedFiles: 0,
      totalMatches: 0,
      truncated: false,
    });
  });

  it("skips metadata, unsupported, oversized, and invalid UTF-8 files", async () => {
    const fixture = await createFixtureProject("search-skip");
    cleanupTasks.push(fixture.cleanup);

    await fs.writeFile(path.join(fixture.rootDir, "wiki", "broken.txt"), Buffer.from([0xc3, 0x28]));
    await fs.writeFile(path.join(fixture.rootDir, "wiki", "large.txt"), `${"x".repeat(1024 * 1024 + 1)}alpha`, "utf8");
    await fs.writeFile(path.join(fixture.rootDir, "raw", "sources", "notes.png"), "alpha", "utf8");

    const response = await searchProjectFiles(fixture.rootDir, "alpha");

    expect(response.results.map((result) => result.relativePath)).not.toContain("wiki/broken.txt");
    expect(response.results.map((result) => result.relativePath)).not.toContain("wiki/large.txt");
    expect(response.results.map((result) => result.relativePath)).not.toContain("raw/sources/demo.pdf");
    expect(response.results.map((result) => result.relativePath)).not.toContain("raw/sources/notes.png");
    expect(response.summary.skippedFiles).toBeGreaterThanOrEqual(4);
  });

  it("truncates large result sets", async () => {
    const fixture = await createFixtureProject("search-truncate");
    cleanupTasks.push(fixture.cleanup);

    for (let index = 0; index < MAX_PROJECT_SEARCH_RESULTS + 5; index += 1) {
      await fs.writeFile(path.join(fixture.rootDir, "wiki", `match-${index}.md`), "needle\n", "utf8");
    }

    const response = await searchProjectFiles(fixture.rootDir, "needle");

    expect(response.results).toHaveLength(MAX_PROJECT_SEARCH_RESULTS);
    expect(response.summary.totalMatches).toBeGreaterThan(MAX_PROJECT_SEARCH_RESULTS);
    expect(response.summary.truncated).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm run test -- src/lib/server/__tests__/project-search.test.ts
```

Expected: 测试失败，因为 `project-search.ts` 尚不存在。

- [ ] **Step 3: 实现 search service**

创建 `web/src/lib/server/project-search.ts`：

```ts
import fs from "node:fs/promises";
import path from "node:path";
import type { Dirent } from "node:fs";
import { TextDecoder } from "node:util";

import { getFileExtension, isSearchableTextFileExtension } from "@/lib/file-view-policy";
import type { ProjectSearchResponse, ProjectSearchResult } from "@/lib/types";

import { FILE_VIEW_SIZE_LIMIT_BYTES } from "./file-policy";

export const MIN_PROJECT_SEARCH_QUERY_LENGTH = 2;
export const MAX_PROJECT_SEARCH_RESULTS = 50;
const MAX_MATCHES_PER_FILE = 5;
const PREVIEW_RADIUS = 72;

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

interface SearchDocument {
  relativePath: string;
  absolutePath: string;
}

export async function searchProjectFiles(
  projectRoot: string,
  query: string,
): Promise<ProjectSearchResponse> {
  const normalizedQuery = query.trim();
  const emptySummary = {
    scannedFiles: 0,
    skippedFiles: 0,
    matchedFiles: 0,
    totalMatches: 0,
    truncated: false,
  };

  if (normalizedQuery.length < MIN_PROJECT_SEARCH_QUERY_LENGTH) {
    return { query: normalizedQuery, results: [], summary: emptySummary };
  }

  const documents = await collectSearchDocuments(projectRoot);
  const lowerQuery = normalizedQuery.toLowerCase();
  const results: ProjectSearchResult[] = [];
  const matchedPaths = new Set<string>();
  let scannedFiles = 0;
  let skippedFiles = 0;
  let totalMatches = 0;

  for (const document of documents) {
    const stats = await safeStatFile(document.absolutePath);

    if (!stats || stats.size > FILE_VIEW_SIZE_LIMIT_BYTES) {
      skippedFiles += 1;
      continue;
    }

    const content = await safeReadUtf8(document.absolutePath);

    if (content === null) {
      skippedFiles += 1;
      continue;
    }

    scannedFiles += 1;

    const fileMatches = collectLineMatches(document.relativePath, content, lowerQuery);

    if (fileMatches.length === 0) {
      continue;
    }

    matchedPaths.add(document.relativePath);
    totalMatches += fileMatches.length;
    results.push(...fileMatches.slice(0, MAX_MATCHES_PER_FILE));
  }

  const sortedResults = results.sort((left, right) => compareResults(left, right, lowerQuery));
  const truncated = sortedResults.length > MAX_PROJECT_SEARCH_RESULTS || totalMatches > MAX_PROJECT_SEARCH_RESULTS;

  return {
    query: normalizedQuery,
    results: sortedResults.slice(0, MAX_PROJECT_SEARCH_RESULTS),
    summary: {
      scannedFiles,
      skippedFiles,
      matchedFiles: matchedPaths.size,
      totalMatches,
      truncated,
    },
  };
}

async function collectSearchDocuments(projectRoot: string): Promise<SearchDocument[]> {
  const rootDir = path.resolve(projectRoot);
  const documents: SearchDocument[] = [];

  await walkDirectory(rootDir, "", documents);

  return documents.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function walkDirectory(rootDir: string, relativeDir: string, documents: SearchDocument[]) {
  const directoryPath = relativeDir === "" ? rootDir : path.join(rootDir, relativeDir);
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });

  entries.sort(compareEntries);

  for (const entry of entries) {
    if (relativeDir === "" && entry.name === ".llm-wiki") {
      continue;
    }

    const relativePath = relativeDir === "" ? entry.name : path.posix.join(relativeDir, entry.name);

    if (entry.isDirectory()) {
      await walkDirectory(rootDir, relativePath, documents);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!isSearchableTextFileExtension(getFileExtension(relativePath))) {
      continue;
    }

    documents.push({
      relativePath,
      absolutePath: path.join(rootDir, relativePath),
    });
  }
}

function collectLineMatches(
  relativePath: string,
  content: string,
  lowerQuery: string,
): ProjectSearchResult[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const matches: ProjectSearchResult[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const lineText = lines[index] ?? "";
    const matchStart = lineText.toLowerCase().indexOf(lowerQuery);

    if (matchStart === -1) {
      continue;
    }

    matches.push({
      relativePath,
      lineNumber: index + 1,
      lineText,
      preview: buildPreview(lineText, matchStart, lowerQuery.length),
      matchStart,
      matchEnd: matchStart + lowerQuery.length,
    });
  }

  return matches;
}

function buildPreview(lineText: string, matchStart: number, queryLength: number) {
  const start = Math.max(0, matchStart - PREVIEW_RADIUS);
  const end = Math.min(lineText.length, matchStart + queryLength + PREVIEW_RADIUS);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < lineText.length ? "..." : "";

  return `${prefix}${lineText.slice(start, end)}${suffix}`;
}

function compareResults(left: ProjectSearchResult, right: ProjectSearchResult, lowerQuery: string) {
  const leftPathMatch = left.relativePath.toLowerCase().includes(lowerQuery) ? 0 : 1;
  const rightPathMatch = right.relativePath.toLowerCase().includes(lowerQuery) ? 0 : 1;

  if (leftPathMatch !== rightPathMatch) {
    return leftPathMatch - rightPathMatch;
  }

  const pathComparison = left.relativePath.localeCompare(right.relativePath);

  if (pathComparison !== 0) {
    return pathComparison;
  }

  return left.lineNumber - right.lineNumber;
}

async function safeStatFile(filePath: string) {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile() ? stats : null;
  } catch {
    return null;
  }
}

async function safeReadUtf8(filePath: string) {
  try {
    return utf8Decoder.decode(await fs.readFile(filePath));
  } catch {
    return null;
  }
}

function compareEntries(left: Dirent, right: Dirent): number {
  if (left.isDirectory() && !right.isDirectory()) {
    return -1;
  }

  if (!left.isDirectory() && right.isDirectory()) {
    return 1;
  }

  return left.name.localeCompare(right.name);
}
```

- [ ] **Step 4: 验证**

Run:

```bash
npm run test -- src/lib/server/__tests__/project-search.test.ts
npm run typecheck
```

Expected: 测试和 typecheck 通过。

- [ ] **Step 5: 提交**

Run:

```bash
git add web/src/lib/server/project-search.ts web/src/lib/server/__tests__/project-search.test.ts
git commit -m "feat: add project search service"
```

Expected: commit 成功。

---

### Task 3: 搜索 API 路由

**Files:**
- Create: `web/src/app/api/projects/[projectId]/search/route.ts`
- Create: `web/src/app/api/projects/[projectId]/search/__tests__/route.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `web/src/app/api/projects/[projectId]/search/__tests__/route.test.ts`：

```ts
import fs from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFixtureProject } from "@/test-utils/project-fixture";

const repoMocks = vi.hoisted(() => ({
  upsertProjectSnapshot: vi.fn(async () => {}),
  insertSyncRun: vi.fn(async () => {}),
  findProjectSnapshotById: vi.fn(async () => null),
  findProjectSnapshotByRootPath: vi.fn(async () => null),
}));

vi.mock("@/lib/db/project-snapshot-repo", () => ({
  upsertProjectSnapshot: repoMocks.upsertProjectSnapshot,
  insertSyncRun: repoMocks.insertSyncRun,
  findProjectSnapshotById: repoMocks.findProjectSnapshotById,
  findProjectSnapshotByRootPath: repoMocks.findProjectSnapshotByRootPath,
}));

const cleanupTasks: Array<() => Promise<void>> = [];

beforeEach(() => {
  repoMocks.upsertProjectSnapshot.mockClear();
  repoMocks.insertSyncRun.mockClear();
  repoMocks.findProjectSnapshotById.mockClear();
  repoMocks.findProjectSnapshotByRootPath.mockClear();
});

afterEach(async () => {
  delete process.env.LLM_WIKI_PROJECT_ROOTS;
  vi.resetModules();

  while (cleanupTasks.length > 0) {
    const cleanup = cleanupTasks.pop();

    if (cleanup) {
      await cleanup();
    }
  }
});

async function createProjectContext(projectName: string) {
  const fixture = await createFixtureProject(projectName);
  cleanupTasks.push(fixture.cleanup);

  process.env.LLM_WIKI_PROJECT_ROOTS = path.dirname(fixture.rootDir);

  const { GET: listProjects } = await import("../../../route");
  const response = await listProjects();
  const payload = (await response.json()) as {
    projects: Array<{ id: string }>;
  };
  const projectId = payload.projects[0]?.id;

  expect(projectId).toBeTruthy();

  return { fixture, projectId: projectId! };
}

describe("/api/projects/[projectId]/search route", () => {
  it("returns project search results", async () => {
    const { fixture, projectId } = await createProjectContext("search-route");

    await fs.writeFile(path.join(fixture.rootDir, "wiki", "topic.md"), "# Topic\n\nAlpha route match.\n", "utf8");

    const { GET, runtime } = await import("../route");
    const response = await GET(
      new Request(`http://localhost/api/projects/${projectId}/search?q=alpha`),
      {
        params: Promise.resolve({ projectId }),
      },
    );
    const payload = (await response.json()) as {
      query: string;
      results: Array<{ relativePath: string; lineNumber: number }>;
      summary: { totalMatches: number };
    };

    expect(runtime).toBe("nodejs");
    expect(response.status).toBe(200);
    expect(payload.query).toBe("alpha");
    expect(payload.results.some((result) => result.relativePath === "wiki/topic.md")).toBe(true);
    expect(payload.summary.totalMatches).toBeGreaterThan(0);
  });

  it("returns an empty response for short queries", async () => {
    const { projectId } = await createProjectContext("search-short-route");

    const { GET } = await import("../route");
    const response = await GET(
      new Request(`http://localhost/api/projects/${projectId}/search?q=a`),
      {
        params: Promise.resolve({ projectId }),
      },
    );
    const payload = (await response.json()) as {
      results: unknown[];
      summary: { scannedFiles: number };
    };

    expect(response.status).toBe(200);
    expect(payload.results).toEqual([]);
    expect(payload.summary.scannedFiles).toBe(0);
  });

  it("returns 404 for unknown projects", async () => {
    const fixture = await createFixtureProject("search-missing-project");
    cleanupTasks.push(fixture.cleanup);
    process.env.LLM_WIKI_PROJECT_ROOTS = path.dirname(fixture.rootDir);

    const { GET } = await import("../route");
    const response = await GET(
      new Request("http://localhost/api/projects/missing/search?q=alpha"),
      {
        params: Promise.resolve({ projectId: "missing" }),
      },
    );
    const payload = (await response.json()) as {
      error: { code: string };
    };

    expect(response.status).toBe(404);
    expect(payload.error.code).toBe("PROJECT_NOT_FOUND");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm run test -- src/app/api/projects/[projectId]/search/__tests__/route.test.ts
```

Expected: 测试失败，因为 route 尚不存在。

- [ ] **Step 3: 实现 route**

创建 `web/src/app/api/projects/[projectId]/search/route.ts`：

```ts
import { getProjectRootsFromEnv } from "@/lib/server/env";
import { resolveProjectById } from "@/lib/server/project-registry";
import { searchProjectFiles } from "@/lib/server/project-search";
import { errorJson, okJson } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

interface ProjectRouteContext {
  params: Promise<{
    projectId: string;
  }>;
}

export async function GET(request: Request, context: ProjectRouteContext) {
  try {
    const roots = getProjectRootsFromEnv();
    const { projectId } = await context.params;
    const project = await resolveProjectById(roots, projectId);
    const query = new URL(request.url).searchParams.get("q") ?? "";
    const response = await searchProjectFiles(project.rootDir, query);

    return okJson(response);
  } catch (error) {
    return errorJson(error);
  }
}
```

- [ ] **Step 4: 验证**

Run:

```bash
npm run test -- src/app/api/projects/[projectId]/search/__tests__/route.test.ts src/lib/server/__tests__/project-search.test.ts
npm run typecheck
```

Expected: 测试和 typecheck 通过。

- [ ] **Step 5: 提交**

Run:

```bash
git add web/src/app/api/projects/[projectId]/search/route.ts web/src/app/api/projects/[projectId]/search/__tests__/route.test.ts
git commit -m "feat: add project search route"
```

Expected: commit 成功。

---

### Task 4: 客户端 API 与搜索面板

**Files:**
- Modify: `web/src/lib/client/api.ts`
- Create: `web/src/components/workbench/project-search.tsx`
- Create: `web/src/components/workbench/project-search.test.tsx`

- [ ] **Step 1: 增加客户端 API**

在 `web/src/lib/client/api.ts` 的类型 import 中加入 `ProjectSearchResponse`，并新增：

```ts
export async function searchProject(
  projectId: string,
  query: string,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ q: query });

  return requestJson<ProjectSearchResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/search?${params.toString()}`,
    {
      method: "GET",
      cache: "no-store",
      signal,
    },
  );
}
```

- [ ] **Step 2: 写失败测试**

创建 `web/src/components/workbench/project-search.test.tsx`：

```tsx
// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProjectSearchResponse } from "@/lib/types";

import { ProjectSearch } from "./project-search";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }

  container?.remove();
  container = null;
  root = null;
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("ProjectSearch", () => {
  it("does not search until the query has at least two characters", () => {
    vi.useFakeTimers();
    const searchFn = vi.fn<() => Promise<ProjectSearchResponse>>();

    renderProjectSearch(searchFn);
    updateInput("a");

    act(() => {
      vi.runAllTimers();
    });

    expect(searchFn).not.toHaveBeenCalled();
    expect(container?.textContent).toContain("Type at least 2 characters");
  });

  it("renders results and opens the selected file", async () => {
    vi.useFakeTimers();
    const onOpenFile = vi.fn();
    const searchFn = vi.fn(async () => ({
      query: "alpha",
      results: [
        {
          relativePath: "wiki/index.md",
          lineNumber: 3,
          lineText: "Alpha appears here.",
          preview: "Alpha appears here.",
          matchStart: 0,
          matchEnd: 5,
        },
      ],
      summary: {
        scannedFiles: 2,
        skippedFiles: 0,
        matchedFiles: 1,
        totalMatches: 1,
        truncated: false,
      },
    }));

    renderProjectSearch(searchFn, onOpenFile);
    updateInput("alpha");

    await flushSearchTimers();

    expect(container?.textContent).toContain("wiki/index.md");
    expect(container?.textContent).toContain("Line 3");
    expect(container?.textContent).toContain("Alpha appears here.");

    act(() => {
      buttonNamed("Open result").click();
    });

    expect(onOpenFile).toHaveBeenCalledWith("wiki/index.md");
  });

  it("renders empty and error states", async () => {
    vi.useFakeTimers();
    const searchFn = vi.fn(async () => ({
      query: "missing",
      results: [],
      summary: {
        scannedFiles: 2,
        skippedFiles: 0,
        matchedFiles: 0,
        totalMatches: 0,
        truncated: false,
      },
    }));

    renderProjectSearch(searchFn);
    updateInput("missing");
    await flushSearchTimers();

    expect(container?.textContent).toContain("No results");

    searchFn.mockRejectedValueOnce(new Error("search unavailable"));
    updateInput("error");
    await flushSearchTimers();

    expect(container?.textContent).toContain("search unavailable");
    expect(container?.textContent).toContain("Retry");
  });
});

function renderProjectSearch(
  searchFn: (projectId: string, query: string, signal?: AbortSignal) => Promise<ProjectSearchResponse>,
  onOpenFile = vi.fn(),
) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  act(() => {
    root?.render(
      <ProjectSearch
        projectId="demo"
        onOpenFile={onOpenFile}
        searchFn={searchFn}
        debounceMs={20}
      />,
    );
  });
}

function updateInput(value: string) {
  const input = container?.querySelector("input");

  if (!input) {
    throw new Error("Search input not found.");
  }

  act(() => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function flushSearchTimers() {
  await act(async () => {
    vi.runAllTimers();
    await Promise.resolve();
  });
}

function buttonNamed(name: string) {
  const button = Array.from(container?.querySelectorAll("button") ?? []).find(
    (candidate) => candidate.textContent?.trim() === name,
  );

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button ${name} not found.`);
  }

  return button;
}
```

- [ ] **Step 3: 运行测试确认失败**

Run:

```bash
npm run test -- src/components/workbench/project-search.test.tsx
```

Expected: 测试失败，因为组件尚不存在。

- [ ] **Step 4: 实现 ProjectSearch**

创建 `web/src/components/workbench/project-search.tsx`。核心结构：

```tsx
"use client";

import { Search, LoaderCircle, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { searchProject } from "@/lib/client/api";
import type { ProjectSearchResponse } from "@/lib/types";

type SearchState =
  | { status: "idle" }
  | { status: "short" }
  | { status: "loading"; query: string }
  | { status: "ready"; response: ProjectSearchResponse }
  | { status: "error"; query: string; message: string };

interface ProjectSearchProps {
  projectId: string;
  onOpenFile: (relativePath: string) => void;
  searchFn?: typeof searchProject;
  debounceMs?: number;
}

export function ProjectSearch({
  projectId,
  onOpenFile,
  searchFn = searchProject,
  debounceMs = 220,
}: ProjectSearchProps) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({ status: "idle" });

  const runSearch = useCallback(
    async (nextQuery: string, signal?: AbortSignal) => {
      const trimmed = nextQuery.trim();

      if (trimmed.length < 2) {
        setState(trimmed.length === 0 ? { status: "idle" } : { status: "short" });
        return;
      }

      setState({ status: "loading", query: trimmed });

      try {
        const response = await searchFn(projectId, trimmed, signal);

        if (!signal?.aborted) {
          setState({ status: "ready", response });
        }
      } catch (error) {
        if (!signal?.aborted) {
          setState({
            status: "error",
            query: trimmed,
            message: error instanceof Error ? error.message : "Unable to search this project.",
          });
        }
      }
    },
    [projectId, searchFn],
  );

  useEffect(() => {
    const abortController = new AbortController();
    const timer = window.setTimeout(() => {
      void runSearch(query, abortController.signal);
    }, debounceMs);

    return () => {
      abortController.abort();
      window.clearTimeout(timer);
    };
  }, [debounceMs, query, runSearch]);

  return (
    <section className="rounded-[22px] border border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]/92 p-4 shadow-[0_14px_40px_rgba(61,52,40,0.07)]">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="flex flex-1 items-center gap-2 rounded-[16px] border border-black/10 bg-white/70 px-3">
          <Search className="size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search this project"
            className="h-10 border-0 bg-transparent px-0 focus-visible:ring-0"
            aria-label="Search this project"
          />
        </div>
        {state.status === "loading" ? (
          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            Searching
          </span>
        ) : null}
      </div>

      <div className="mt-3">
        <SearchStateView
          state={state}
          onOpenFile={onOpenFile}
          onRetry={() => {
            void runSearch(query);
          }}
        />
      </div>
    </section>
  );
}
```

在同一文件中实现 `SearchStateView`，必须渲染：

- `Type at least 2 characters`。
- `No results`。
- `Retry` 按钮。
- 每个结果的 `relativePath`、`Line ${lineNumber}`、`preview`。
- 每个结果一个 `Open result` 按钮，点击调用 `onOpenFile(result.relativePath)`。

- [ ] **Step 5: 验证**

Run:

```bash
npm run test -- src/components/workbench/project-search.test.tsx
npm run typecheck
```

Expected: 测试和 typecheck 通过。

- [ ] **Step 6: 提交**

Run:

```bash
git add web/src/lib/client/api.ts web/src/components/workbench/project-search.tsx web/src/components/workbench/project-search.test.tsx
git commit -m "feat: add project search panel"
```

Expected: commit 成功。

---

### Task 5: 工作台集成

**Files:**
- Modify: `web/src/components/workbench/project-workbench.tsx`
- Test: `web/src/components/workbench/project-search.test.tsx`

- [ ] **Step 1: 接入 ProjectSearch**

在 `web/src/components/workbench/project-workbench.tsx` import：

```ts
import { ProjectSearch } from "@/components/workbench/project-search";
```

在 `Tabs` 结束后、section 内容之前加入：

```tsx
          <ProjectSearch
            projectId={projectId}
            onOpenFile={(relativePath) => {
              void requestOpenRelativePath(relativePath, "Files");
            }}
          />
```

要求：

- 只在 `loadState.status === "ready"` 的主内容内渲染。
- 保持 `ProjectOverview`、`FileTree`、`FilePanel` 原有流程。
- 点击搜索结果必须走 `requestOpenRelativePath`，不要直接调用 `performOpenRelativePath`，这样才能保留阶段 2 草稿保护。

- [ ] **Step 2: 增加集成断言**

在 `web/src/components/workbench/project-search.test.tsx` 增加一条测试，确认 `ProjectSearch` 的 result click 只透出 `relativePath`，不直接读取文件：

```tsx
it("delegates result opening to the parent workbench", async () => {
  vi.useFakeTimers();
  const onOpenFile = vi.fn();
  const searchFn = vi.fn(async () => ({
    query: "schema",
    results: [
      {
        relativePath: "schema.md",
        lineNumber: 1,
        lineText: "# Schema",
        preview: "# Schema",
        matchStart: 2,
        matchEnd: 8,
      },
    ],
    summary: {
      scannedFiles: 2,
      skippedFiles: 0,
      matchedFiles: 1,
      totalMatches: 1,
      truncated: false,
    },
  }));

  renderProjectSearch(searchFn, onOpenFile);
  updateInput("schema");
  await flushSearchTimers();

  act(() => {
    buttonNamed("Open result").click();
  });

  expect(onOpenFile).toHaveBeenCalledWith("schema.md");
});
```

- [ ] **Step 3: 验证**

Run:

```bash
npm run test -- src/components/workbench/project-search.test.tsx src/components/workbench/draft-guard.test.ts
npm run typecheck
```

Expected: 测试和 typecheck 通过。

- [ ] **Step 4: 提交**

Run:

```bash
git add web/src/components/workbench/project-workbench.tsx web/src/components/workbench/project-search.test.tsx
git commit -m "feat: integrate project search in workbench"
```

Expected: commit 成功。

---

### Task 6: 全量验证与 roadmap 更新

**Files:**
- Modify: `web/docs/web-roadmap-next-phases.md`

- [ ] **Step 1: 全量验证**

Run:

```bash
npm run test
npm run typecheck
npm run lint
```

Expected:

- `npm run test` 全部通过。
- `npm run typecheck` 通过。
- `npm run lint` exit code 0。当前已知可能保留 5 个既有 warning，但不能有 error。

- [ ] **Step 2: 更新 roadmap**

在 `web/docs/web-roadmap-next-phases.md` 的 `## 9. 阶段 4：项目内检索基础` 标题下方加入：

```md
> 状态：已完成。阶段 4 已按 [spec](../../docs/superpowers/specs/2026-04-26-phase-4-project-search-design.md) 和 [implementation plan](../../docs/superpowers/plans/2026-04-26-phase-4-project-search.md) 落地，覆盖项目内关键词搜索、服务端按需扫描、搜索 API、工作台搜索面板、结果打开联动和关键测试。
```

- [ ] **Step 3: 检查 roadmap 状态**

Run:

```bash
rg -n "阶段 4：项目内检索基础|phase-4-project-search|状态：已完成" web/docs/web-roadmap-next-phases.md
```

Expected: 输出包含阶段 4 完成状态、spec 链接和 plan 链接。

- [ ] **Step 4: 提交**

Run:

```bash
git add web/docs/web-roadmap-next-phases.md
git commit -m "docs: mark phase 4 roadmap complete"
```

Expected: commit 成功。

---

## 执行顺序

1. Task 1 必须先完成，因为后续服务端与前端共享搜索类型和扩展名策略。
2. Task 2 和 Task 3 串行执行：route 依赖 search service。
3. Task 4 可在 Task 2/3 后执行，因为它依赖响应类型和客户端 API。
4. Task 5 依赖 Task 4 的 `ProjectSearch`。
5. Task 6 必须最后执行。

## 完成定义

- 阶段 4 spec 的验收标准全部满足。
- 搜索只扫描当前项目可读文本范围。
- 搜索 API 不引入数据库索引或后台任务。
- 搜索结果可点击打开文件，并保留阶段 2 草稿保护。
- `npm run test`、`npm run typecheck`、`npm run lint` 已运行并记录结果。
- roadmap 已标记阶段 4 完成。
