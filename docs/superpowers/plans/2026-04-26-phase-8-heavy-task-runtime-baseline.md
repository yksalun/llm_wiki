# 阶段 8 重任务能力基线与适配层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为搜索、问答和 Insights 建立重任务边界、共享文本扫描层和 runtime capabilities，同时保持当前 active engine 为 `node`，不引入真实 Rust bridge。

**Architecture:** 新增 `heavy-task-runtime` 暴露保守的 Node runtime capabilities 和执行元数据工具；新增 `project-text-scan` 作为项目文本扫描边界；`project-search` 复用扫描层并提供多 query 单次扫描；`project-question-answer` 复用多 query 搜索；`project-insights` 复用扫描层；project detail/Search/Insights routes 与 Project Info 展示诊断信息。

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, Node fs/path, existing AppError / route helpers / workbench components.

---

## 文件结构

- Modify: `web/src/lib/types.ts`
  新增重任务 runtime/execution 类型，`ProjectDetail.runtime`，`ProjectSearchResponse.execution?`，`ProjectInsightsResponse.execution?`。
- Create: `web/src/lib/server/heavy-task-runtime.ts`
  返回 Node runtime capabilities，生成执行元数据。
- Create: `web/src/lib/server/__tests__/heavy-task-runtime.test.ts`
  覆盖默认 runtime、task metadata、duration 非负。
- Create: `web/src/lib/server/project-text-scan.ts`
  共享项目文本扫描 async generator。
- Create: `web/src/lib/server/__tests__/project-text-scan.test.ts`
  覆盖扩展名过滤、`.llm-wiki`、超大文件、无效 UTF-8、有界读取关闭句柄。
- Modify: `web/src/lib/server/project-registry.ts`
  `ResolvedProject` 增加 runtime。
- Modify: `web/src/app/api/projects/[projectId]/route.ts`
  project detail 响应返回 runtime。
- Modify: `web/src/app/api/projects/__tests__/route.test.ts`
  断言 detail runtime。
- Modify: `web/src/components/workbench/project-workbench.tsx`
  Project Info 展示重任务 runtime。
- Modify: `web/src/components/workbench/project-workbench.test.tsx`
  更新 fixtures，覆盖 runtime 展示。
- Modify: `web/src/components/workbench/project-overview.test.tsx`
  更新 `ProjectDetail` fixture。
- Modify: `web/src/lib/server/project-search.ts`
  复用扫描层并新增 `searchProjectFilesForQueries()`。
- Modify: `web/src/lib/server/__tests__/project-search.test.ts`
  覆盖多 query 单次扫描和无效 query。
- Modify: `web/src/lib/server/project-question-answer.ts`
  改用多 query 搜索。
- Modify: `web/src/lib/server/__tests__/project-question-answer.test.ts`
  覆盖问答只调用一次多 query 检索。
- Modify: `web/src/lib/server/project-insights.ts`
  复用扫描层。
- Modify: `web/src/lib/server/__tests__/project-insights.test.ts`
  保持 skip target 不误报，并覆盖扫描层复用后的行为。
- Modify: `web/src/app/api/projects/[projectId]/search/route.ts`
  附加 search execution metadata。
- Modify: `web/src/app/api/projects/[projectId]/search/__tests__/route.test.ts`
  断言 execution。
- Modify: `web/src/app/api/projects/[projectId]/insights/route.ts`
  附加 insights execution metadata。
- Modify: `web/src/app/api/projects/[projectId]/insights/__tests__/route.test.ts`
  断言 execution。
- Modify: `web/docs/web-roadmap-next-phases.md`
  阶段完成后标记 Phase 8 前置基线完成。

---

### Task 1: Runtime capabilities 类型与服务

**Files:**
- Modify: `web/src/lib/types.ts`
- Create: `web/src/lib/server/heavy-task-runtime.ts`
- Create: `web/src/lib/server/__tests__/heavy-task-runtime.test.ts`
- Modify: `web/src/lib/server/project-registry.ts`
- Modify: `web/src/lib/server/__tests__/project-registry.test.ts`
- Modify: `web/src/components/workbench/project-overview.test.tsx`
- Modify: `web/src/components/workbench/project-workbench.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `web/src/lib/server/__tests__/heavy-task-runtime.test.ts`：

```ts
import { describe, expect, it } from "vitest";

import {
  createHeavyTaskExecutionMetadata,
  getProjectRuntimeCapabilities,
} from "../heavy-task-runtime";

describe("heavy task runtime", () => {
  it("reports the current Node runtime capabilities without enabling a bridge", () => {
    expect(getProjectRuntimeCapabilities()).toEqual({
      activeEngine: "node",
      bridgeStatus: "not-configured",
      heavyTasks: [
        {
          task: "project-search",
          engine: "node",
          bridgeStatus: "not-configured",
        },
        {
          task: "project-insights",
          engine: "node",
          bridgeStatus: "not-configured",
        },
      ],
    });
  });

  it("creates non-negative execution metadata for a tracked task", () => {
    expect(
      createHeavyTaskExecutionMetadata("project-search", 20, () => 45.5),
    ).toEqual({
      task: "project-search",
      engine: "node",
      durationMs: 25.5,
    });
  });

  it("clamps clock drift to zero duration", () => {
    expect(createHeavyTaskExecutionMetadata("project-insights", 20, () => 10)).toEqual({
      task: "project-insights",
      engine: "node",
      durationMs: 0,
    });
  });
});
```

在 `project-registry.test.ts` 的 detail/resolve 相关断言中加入：

```ts
runtime: {
  activeEngine: "node",
  bridgeStatus: "not-configured",
  heavyTasks: [
    { task: "project-search", engine: "node", bridgeStatus: "not-configured" },
    { task: "project-insights", engine: "node", bridgeStatus: "not-configured" },
  ],
},
```

在 `project-overview.test.tsx` 和 `project-workbench.test.tsx` 的 `ProjectDetail` fixtures 中也加入同样的 `runtime` 字段。

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm run test -- src/lib/server/__tests__/heavy-task-runtime.test.ts src/lib/server/__tests__/project-registry.test.ts src/components/workbench/project-overview.test.tsx src/components/workbench/project-workbench.test.tsx
```

Expected: 失败，原因是 `heavy-task-runtime` 模块和 `ProjectDetail.runtime` 尚不存在。

- [ ] **Step 3: 增加共享类型**

在 `web/src/lib/types.ts` 的 project 类型附近加入：

```ts
export type HeavyTaskEngine = "node";
export type HeavyTaskBridgeStatus = "not-configured";
export type HeavyTaskName = "project-search" | "project-insights";

export interface HeavyTaskCapability {
  task: HeavyTaskName;
  engine: HeavyTaskEngine;
  bridgeStatus: HeavyTaskBridgeStatus;
}

export interface ProjectRuntimeCapabilities {
  activeEngine: HeavyTaskEngine;
  bridgeStatus: HeavyTaskBridgeStatus;
  heavyTasks: HeavyTaskCapability[];
}

export interface HeavyTaskExecutionMetadata {
  task: HeavyTaskName;
  engine: HeavyTaskEngine;
  durationMs: number;
}
```

把 `ProjectDetail` 改为：

```ts
export interface ProjectDetail extends ProjectSummary {
  sections: WorkbenchSection[];
  rootPathHint: string | null;
  access: ProjectAccessPolicy;
  runtime: ProjectRuntimeCapabilities;
}
```

把 `ProjectSearchResponse` 和 `ProjectInsightsResponse` 加上可选字段：

```ts
execution?: HeavyTaskExecutionMetadata;
```

- [ ] **Step 4: 实现 runtime 服务**

创建 `web/src/lib/server/heavy-task-runtime.ts`：

```ts
import type {
  HeavyTaskExecutionMetadata,
  HeavyTaskName,
  ProjectRuntimeCapabilities,
} from "@/lib/types";

const NODE_RUNTIME_CAPABILITIES: ProjectRuntimeCapabilities = {
  activeEngine: "node",
  bridgeStatus: "not-configured",
  heavyTasks: [
    { task: "project-search", engine: "node", bridgeStatus: "not-configured" },
    { task: "project-insights", engine: "node", bridgeStatus: "not-configured" },
  ],
};

export function getProjectRuntimeCapabilities(): ProjectRuntimeCapabilities {
  return {
    ...NODE_RUNTIME_CAPABILITIES,
    heavyTasks: NODE_RUNTIME_CAPABILITIES.heavyTasks.map((task) => ({ ...task })),
  };
}

export function getHeavyTaskNowMs(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

export function createHeavyTaskExecutionMetadata(
  task: HeavyTaskName,
  startedAtMs: number,
  now: () => number = getHeavyTaskNowMs,
): HeavyTaskExecutionMetadata {
  return {
    task,
    engine: "node",
    durationMs: Math.max(0, now() - startedAtMs),
  };
}
```

- [ ] **Step 5: 给 registry 和 fixtures 补 runtime**

在 `web/src/lib/server/project-registry.ts` import：

```ts
import { getProjectRuntimeCapabilities } from "./heavy-task-runtime";
```

在 `toResolvedProject()` 返回值中加入：

```ts
runtime: getProjectRuntimeCapabilities(),
```

更新所有直接构造 `ProjectDetail` 的测试 fixture，使用同一结构：

```ts
runtime: {
  activeEngine: "node",
  bridgeStatus: "not-configured",
  heavyTasks: [
    { task: "project-search", engine: "node", bridgeStatus: "not-configured" },
    { task: "project-insights", engine: "node", bridgeStatus: "not-configured" },
  ],
},
```

- [ ] **Step 6: 验证并提交**

Run:

```bash
npm run test -- src/lib/server/__tests__/heavy-task-runtime.test.ts src/lib/server/__tests__/project-registry.test.ts src/components/workbench/project-overview.test.tsx src/components/workbench/project-workbench.test.tsx
npm run typecheck
```

Commit:

```bash
git add web/src/lib/types.ts web/src/lib/server/heavy-task-runtime.ts web/src/lib/server/__tests__/heavy-task-runtime.test.ts web/src/lib/server/project-registry.ts web/src/lib/server/__tests__/project-registry.test.ts web/src/components/workbench/project-overview.test.tsx web/src/components/workbench/project-workbench.test.tsx
git commit -m "feat: add heavy task runtime capabilities"
```

---

### Task 2: 共享项目文本扫描层

**Files:**
- Create: `web/src/lib/server/project-text-scan.ts`
- Create: `web/src/lib/server/__tests__/project-text-scan.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `web/src/lib/server/__tests__/project-text-scan.test.ts`：

```ts
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { FILE_VIEW_SIZE_LIMIT_BYTES } from "../file-policy";
import { scanProjectTextFiles } from "../project-text-scan";

const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  vi.restoreAllMocks();

  while (cleanupTasks.length > 0) {
    const cleanup = cleanupTasks.pop();
    if (cleanup) await cleanup();
  }
});

describe("scanProjectTextFiles", () => {
  it("yields searchable UTF-8 files in stable path order and counts skipped files", async () => {
    const projectRoot = await createProject("scan-basic");
    await writeProjectFile(projectRoot, "z.md", "# Z\n");
    await writeProjectFile(projectRoot, "a.txt", "alpha\n");
    await writeProjectFile(projectRoot, "image.png", "not text");

    const scan = scanProjectTextFiles(projectRoot);
    const files = await collect(scan.files);

    expect(files.map((file) => file.relativePath)).toEqual(["a.txt", "z.md"]);
    expect(files.map((file) => file.content)).toEqual(["alpha\n", "# Z\n"]);
    expect(scan.stats.skippedFiles).toBe(1);
  });

  it("skips root .llm-wiki metadata files", async () => {
    const projectRoot = await createProject("scan-metadata");
    await writeProjectFile(projectRoot, ".llm-wiki/hidden.md", "# Hidden\n");
    await writeProjectFile(projectRoot, "README.md", "# Visible\n");

    const scan = scanProjectTextFiles(projectRoot);
    const files = await collect(scan.files);

    expect(files.map((file) => file.relativePath)).toEqual(["README.md"]);
    expect(scan.stats.skippedFiles).toBe(0);
  });

  it("skips oversized and invalid UTF-8 files", async () => {
    const projectRoot = await createProject("scan-skips");
    await writeProjectFile(projectRoot, "README.md", "# Visible\n");
    await writeProjectFile(projectRoot, "big.md", "a".repeat(FILE_VIEW_SIZE_LIMIT_BYTES + 1));
    await writeProjectBytes(projectRoot, "bad.md", Buffer.from([0xff, 0xfe, 0xfd]));

    const scan = scanProjectTextFiles(projectRoot);
    const files = await collect(scan.files);

    expect(files.map((file) => file.relativePath)).toEqual(["README.md"]);
    expect(scan.stats.skippedFiles).toBe(2);
  });

  it("closes file handles after bounded reads", async () => {
    const projectRoot = await createProject("scan-close");
    await writeProjectFile(projectRoot, "README.md", "# Visible\n");
    const realOpen = fs.open;
    const close = vi.fn(async () => undefined);
    const open = vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await realOpen(...args);
      const originalClose = handle.close.bind(handle);
      return Object.assign(handle, {
        close: vi.fn(async () => {
          await originalClose();
          await close();
        }),
      });
    });

    const scan = scanProjectTextFiles(projectRoot);
    await collect(scan.files);

    expect(open).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });
});

async function collect<T>(generator: AsyncGenerator<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of generator) values.push(value);
  return values;
}

async function createProject(name: string): Promise<string> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "llm-wiki-web-scan-"));
  const projectRoot = path.join(tempRoot, name);
  await fs.mkdir(projectRoot, { recursive: true });
  cleanupTasks.push(() => fs.rm(tempRoot, { recursive: true, force: true }));
  return projectRoot;
}

async function writeProjectFile(projectRoot: string, relativePath: string, content: string): Promise<void> {
  await writeProjectBytes(projectRoot, relativePath, Buffer.from(content, "utf8"));
}

async function writeProjectBytes(projectRoot: string, relativePath: string, content: Buffer): Promise<void> {
  const filePath = path.join(projectRoot, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm run test -- src/lib/server/__tests__/project-text-scan.test.ts
```

Expected: 失败，原因是 `project-text-scan` 模块不存在。

- [ ] **Step 3: 实现扫描层**

创建 `web/src/lib/server/project-text-scan.ts`：

```ts
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

import { getFileExtension, isSearchableTextFileExtension } from "@/lib/file-view-policy";

import { FILE_VIEW_SIZE_LIMIT_BYTES } from "./file-policy";

const TEXT_SCAN_READ_LIMIT_BYTES = FILE_VIEW_SIZE_LIMIT_BYTES + 1;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export interface ProjectTextFile {
  relativePath: string;
  content: string;
  size: number;
  extension: string;
}

export interface ProjectTextScanStats {
  skippedFiles: number;
}

export interface ProjectTextScanResult {
  files: AsyncGenerator<ProjectTextFile>;
  stats: ProjectTextScanStats;
}

export function scanProjectTextFiles(projectRoot: string): ProjectTextScanResult {
  const rootDir = path.resolve(projectRoot);
  const stats: ProjectTextScanStats = { skippedFiles: 0 };

  return {
    files: scanFiles(rootDir, stats),
    stats,
  };
}

async function* scanFiles(
  rootDir: string,
  stats: ProjectTextScanStats,
): AsyncGenerator<ProjectTextFile> {
  for await (const relativePath of walkProjectFiles(rootDir, "")) {
    const extension = getFileExtension(relativePath);

    if (!isSearchableTextFileExtension(extension)) {
      stats.skippedFiles += 1;
      continue;
    }

    const absolutePath = path.join(rootDir, relativePath);
    const fileStats = await safeStatFile(absolutePath);

    if (!fileStats || fileStats.size > FILE_VIEW_SIZE_LIMIT_BYTES) {
      stats.skippedFiles += 1;
      continue;
    }

    const content = await safeReadUtf8(absolutePath);

    if (content === null) {
      stats.skippedFiles += 1;
      continue;
    }

    yield {
      relativePath,
      content,
      size: fileStats.size,
      extension,
    };
  }
}

async function* walkProjectFiles(rootDir: string, relativeDir: string): AsyncGenerator<string> {
  const directoryPath = relativeDir === "" ? rootDir : path.join(rootDir, relativeDir);
  let entries: Dirent[];

  try {
    entries = await fs.readdir(directoryPath, { withFileTypes: true });
  } catch {
    return;
  }

  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    if (relativeDir === "" && entry.name === ".llm-wiki") {
      continue;
    }

    const relativePath = relativeDir === "" ? entry.name : path.posix.join(relativeDir, entry.name);

    if (entry.isDirectory()) {
      yield* walkProjectFiles(rootDir, relativePath);
      continue;
    }

    if (entry.isFile()) {
      yield relativePath;
    }
  }
}

async function safeStatFile(filePath: string): Promise<{ size: number } | null> {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile() ? { size: stats.size } : null;
  } catch {
    return null;
  }
}

async function safeReadUtf8(filePath: string): Promise<string | null> {
  let fileHandle: Awaited<ReturnType<typeof fs.open>> | null = null;

  try {
    fileHandle = await fs.open(filePath, "r");
    const buffer = Buffer.allocUnsafe(TEXT_SCAN_READ_LIMIT_BYTES);
    const { bytesRead } = await fileHandle.read(buffer, 0, buffer.byteLength, 0);

    if (bytesRead > FILE_VIEW_SIZE_LIMIT_BYTES) {
      return null;
    }

    return utf8Decoder.decode(buffer.subarray(0, bytesRead));
  } catch {
    return null;
  } finally {
    await fileHandle?.close().catch(() => undefined);
  }
}
```

- [ ] **Step 4: 验证并提交**

Run:

```bash
npm run test -- src/lib/server/__tests__/project-text-scan.test.ts
npm run typecheck
```

Commit:

```bash
git add web/src/lib/server/project-text-scan.ts web/src/lib/server/__tests__/project-text-scan.test.ts
git commit -m "feat: add project text scan boundary"
```

---

### Task 3: Search 复用扫描层并支持多 query

**Files:**
- Modify: `web/src/lib/server/project-search.ts`
- Modify: `web/src/lib/server/__tests__/project-search.test.ts`

- [ ] **Step 1: 写失败测试**

在 `project-search.test.ts` import 增加：

```ts
import type { ProjectTextScanResult } from "../project-text-scan";
```

新增测试：

```ts
it("searches multiple valid queries with one text scan pass", async () => {
  const scanCalls: string[] = [];
  const scanTextFiles = () =>
    ({
      stats: { skippedFiles: 1 },
      files: (async function* () {
        scanCalls.push("scan");
        yield {
          relativePath: "wiki/schema.md",
          content: "schema defined here\npurpose overview here\n",
          size: 42,
          extension: "md",
        };
      })(),
    }) satisfies ProjectTextScanResult;

  const responses = await searchProjectFilesForQueries(
    "/project",
    ["schema", "purpose"],
    { scanTextFiles },
  );

  expect(scanCalls).toEqual(["scan"]);
  expect(responses.map((response) => response.query)).toEqual(["schema", "purpose"]);
  expect(responses[0]?.summary).toMatchObject({
    scannedFiles: 1,
    skippedFiles: 1,
    matchedFiles: 1,
    totalMatches: 1,
  });
  expect(responses[1]?.results[0]).toMatchObject({
    relativePath: "wiki/schema.md",
    lineNumber: 2,
  });
});

it("does not scan for invalid queries inside a multi-query request", async () => {
  const scanTextFiles = vi.fn(() =>
    ({
      stats: { skippedFiles: 0 },
      files: (async function* () {
        yield {
          relativePath: "wiki/schema.md",
          content: "schema defined here\n",
          size: 20,
          extension: "md",
        };
      })(),
    }) satisfies ProjectTextScanResult,
  );

  const responses = await searchProjectFilesForQueries(
    "/project",
    [" x ", "schema", "z".repeat(MAX_PROJECT_SEARCH_QUERY_LENGTH + 1)],
    { scanTextFiles },
  );

  expect(scanTextFiles).toHaveBeenCalledTimes(1);
  expect(responses[0]?.summary.scannedFiles).toBe(0);
  expect(responses[1]?.summary.scannedFiles).toBe(1);
  expect(responses[2]?.summary.scannedFiles).toBe(0);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm run test -- src/lib/server/__tests__/project-search.test.ts
```

Expected: 失败，原因是 `searchProjectFilesForQueries` 和依赖注入不存在。

- [ ] **Step 3: 改造 search service**

在 `project-search.ts` 中：

- 删除本地 `walkProjectFiles`、`safeStatFile`、`safeReadUtf8` 和 `TextDecoder`。
- import `scanProjectTextFiles`：

```ts
import {
  scanProjectTextFiles,
  type ProjectTextScanResult,
} from "./project-text-scan";
```

新增依赖类型：

```ts
interface SearchProjectFilesDependencies {
  scanTextFiles?: (projectRoot: string) => ProjectTextScanResult;
}
```

把 `searchProjectFiles` 改成委托：

```ts
export async function searchProjectFiles(
  projectRoot: string,
  query: string,
  dependencies: SearchProjectFilesDependencies = {},
): Promise<ProjectSearchResponse> {
  const [response] = await searchProjectFilesForQueries(projectRoot, [query], dependencies);
  return response ?? emptySearchResponse(query.trim());
}
```

新增 `searchProjectFilesForQueries`：

```ts
export async function searchProjectFilesForQueries(
  projectRoot: string,
  queries: string[],
  dependencies: SearchProjectFilesDependencies = {},
): Promise<ProjectSearchResponse[]> {
  const states = queries.map(createSearchState);
  const validStates = states.filter((state) => state.valid);

  if (validStates.length === 0) {
    return states.map(toSearchResponse);
  }

  const scan = (dependencies.scanTextFiles ?? scanProjectTextFiles)(projectRoot);

  for await (const file of scan.files) {
    for (const state of validStates) {
      state.scannedFiles += 1;
      const fileSearchResult = findLineMatches(file.relativePath, file.content, state.query);

      if (fileSearchResult.totalMatches === 0) {
        continue;
      }

      state.matchedFiles += 1;
      state.totalMatches += fileSearchResult.totalMatches;
      state.truncatedByPerFileCap ||= fileSearchResult.truncated;
      state.results.push(...fileSearchResult.results);
      state.truncatedByGlobalCap ||= trimToTopResults(state.results, state.lowerQuery);
    }
  }

  for (const state of validStates) {
    state.skippedFiles = scan.stats.skippedFiles;
  }

  return states.map(toSearchResponse);
}
```

实现本地 state helpers：

```ts
interface SearchState {
  query: string;
  lowerQuery: string;
  valid: boolean;
  results: ProjectSearchResult[];
  scannedFiles: number;
  skippedFiles: number;
  matchedFiles: number;
  totalMatches: number;
  truncatedByPerFileCap: boolean;
  truncatedByGlobalCap: boolean;
}

function createSearchState(query: string): SearchState {
  const trimmedQuery = query.trim();
  const valid =
    trimmedQuery.length >= 2 && trimmedQuery.length <= MAX_PROJECT_SEARCH_QUERY_LENGTH;

  return {
    query: trimmedQuery,
    lowerQuery: trimmedQuery.toLowerCase(),
    valid,
    results: [],
    scannedFiles: 0,
    skippedFiles: 0,
    matchedFiles: 0,
    totalMatches: 0,
    truncatedByPerFileCap: false,
    truncatedByGlobalCap: false,
  };
}

function toSearchResponse(state: SearchState): ProjectSearchResponse {
  if (!state.valid) {
    return emptySearchResponse(state.query);
  }

  const sortedResults = state.results.sort((left, right) =>
    compareSearchResults(left, right, state.lowerQuery),
  );

  return {
    query: state.query,
    results: sortedResults.slice(0, MAX_PROJECT_SEARCH_RESULTS),
    summary: {
      scannedFiles: state.scannedFiles,
      skippedFiles: state.skippedFiles,
      matchedFiles: state.matchedFiles,
      totalMatches: state.totalMatches,
      truncated: state.truncatedByPerFileCap || state.truncatedByGlobalCap,
    },
  };
}
```

- [ ] **Step 4: 验证并提交**

Run:

```bash
npm run test -- src/lib/server/__tests__/project-search.test.ts src/lib/server/__tests__/project-text-scan.test.ts
npm run typecheck
```

Commit:

```bash
git add web/src/lib/server/project-search.ts web/src/lib/server/__tests__/project-search.test.ts
git commit -m "feat: support multi query project search"
```

---

### Task 4: 问答复用多 query 搜索

**Files:**
- Modify: `web/src/lib/server/project-question-answer.ts`
- Modify: `web/src/lib/server/__tests__/project-question-answer.test.ts`

- [ ] **Step 1: 写失败测试**

在 `project-question-answer.test.ts` 新增 import：

```ts
import type { ProjectSearchResponse } from "@/lib/types";
```

新增测试：

```ts
it("retrieves all generated queries through one multi-query search dependency", async () => {
  const projectRoot = await createProject("single-multi-query-pass");
  const searchFilesForQueries = vi.fn(async (_root: string, queries: string[]) =>
    queries.map(
      (query): ProjectSearchResponse => ({
        query,
        results:
          query === "schema"
            ? [
                {
                  relativePath: "wiki/schema.md",
                  lineNumber: 1,
                  lineText: "schema fact",
                  preview: "schema fact",
                  matchStart: 0,
                  matchEnd: 6,
                },
              ]
            : [],
        summary: {
          scannedFiles: query === "schema" ? 1 : 0,
          skippedFiles: 0,
          matchedFiles: query === "schema" ? 1 : 0,
          totalMatches: query === "schema" ? 1 : 0,
          truncated: false,
        },
      }),
    ),
  );
  const getConfig = vi.fn(() => ({
    apiKey: "test-key",
    model: "test-model",
    baseUrl: "https://example.test",
  }));
  const generateAnswer = vi.fn(async () => ({
    answer: "answer [1]",
    model: "test-model",
  }));

  const response = await answerProjectQuestion(
    projectRoot,
    { question: "Where is the schema defined?" },
    { getConfig, generateAnswer, searchFilesForQueries },
  );

  expect(searchFilesForQueries).toHaveBeenCalledTimes(1);
  expect(searchFilesForQueries).toHaveBeenCalledWith(projectRoot, [
    "Where is the schema defined?",
    "where",
    "schema",
    "defined",
  ]);
  expect(response.sources).toEqual([
    {
      id: 1,
      relativePath: "wiki/schema.md",
      lineNumber: 1,
      preview: "schema fact",
    },
  ]);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm run test -- src/lib/server/__tests__/project-question-answer.test.ts
```

Expected: 失败，原因是依赖中没有 `searchFilesForQueries`。

- [ ] **Step 3: 实现问答改造**

在 `project-question-answer.ts` import 改为：

```ts
import { searchProjectFilesForQueries } from "./project-search";
```

扩展 dependencies：

```ts
export interface AnswerProjectQuestionDependencies {
  getConfig?: typeof getProjectQuestionAnswerConfigFromEnv;
  generateAnswer?: typeof generateProjectAnswer;
  searchFilesForQueries?: typeof searchProjectFilesForQueries;
}
```

把逐 query 循环改为：

```ts
const searchFilesForQueriesDependency =
  dependencies.searchFilesForQueries ?? searchProjectFilesForQueries;
const searchResponses = await searchFilesForQueriesDependency(projectRoot, queries);

for (const searchResponse of searchResponses) {
  truncated ||=
    searchResponse.summary.truncated ||
    searchResponse.summary.totalMatches > searchResponse.results.length;

  for (const result of searchResponse.results) {
    const sourceKey = buildSourceKey(result);

    if (seenSources.has(sourceKey)) {
      continue;
    }

    seenSources.add(sourceKey);
    sourceCandidates.push({
      id: sourceCandidates.length + 1,
      relativePath: result.relativePath,
      lineNumber: result.lineNumber,
      preview: result.preview || result.lineText,
    });
  }
}
```

- [ ] **Step 4: 验证并提交**

Run:

```bash
npm run test -- src/lib/server/__tests__/project-question-answer.test.ts src/lib/server/__tests__/project-search.test.ts
npm run typecheck
```

Commit:

```bash
git add web/src/lib/server/project-question-answer.ts web/src/lib/server/__tests__/project-question-answer.test.ts
git commit -m "feat: reuse multi query search for project questions"
```

---

### Task 5: Insights 复用扫描层

**Files:**
- Modify: `web/src/lib/server/project-insights.ts`
- Modify: `web/src/lib/server/__tests__/project-insights.test.ts`

- [ ] **Step 1: 写失败测试**

在 `project-insights.test.ts` 已有大文件跳过测试基础上，新增无效 UTF-8 跳过测试：

```ts
it("skips invalid UTF-8 searchable files without reporting them as broken targets", async () => {
  const projectRoot = await createProject("invalid-utf8-skip");
  await writeProjectFile(projectRoot, "README.md", "# Home\n\nSee [Bad](bad.md).\n");
  const badPath = path.join(projectRoot, "bad.md");
  await fs.writeFile(badPath, Buffer.from([0xff, 0xfe, 0xfd]));

  const response = await buildProjectInsights(projectRoot);

  expect(response.graph.nodes.map((node) => node.relativePath)).toEqual(["README.md"]);
  expect(response.findings.some((finding) => finding.message.includes("bad.md"))).toBe(false);
  expect(response.summary.analyzedFiles).toBe(1);
});
```

- [ ] **Step 2: 运行测试确认当前行为**

Run:

```bash
npm run test -- src/lib/server/__tests__/project-insights.test.ts
```

Expected: 当前可能通过或失败；无论结果如何，下一步都要去掉 insights 内重复扫描实现并复用共享扫描层。

- [ ] **Step 3: 改造 insights service**

在 `project-insights.ts`：

- 删除本地 `walkProjectFiles`、`safeStatFile`、`safeReadUtf8`、`TextDecoder` 和 `FILE_VIEW_SIZE_LIMIT_BYTES` 相关读取逻辑。
- import：

```ts
import { isMarkdownFileExtension } from "@/lib/file-view-policy";
import { scanProjectTextFiles } from "./project-text-scan";
```

把文件收集改为：

```ts
const scan = scanProjectTextFiles(rootDir);
const skippedSearchablePaths = new Set<string>();

for await (const file of scan.files) {
  analyzedFiles.push({
    relativePath: file.relativePath,
    content: file.content,
    isMarkdown: isMarkdownFileExtension(file.extension),
  });
}
```

为了保留“存在但被跳过的目标不误报 broken link”，在判断 target 缺失时新增轻量存在性检查：

```ts
if (!targetPaths.has(targetPath)) {
  if (await projectPathExists(rootDir, targetPath)) {
    skippedSearchablePaths.add(targetPath);
    continue;
  }
  // existing broken link finding path
}
```

新增 helper：

```ts
async function projectPathExists(rootDir: string, relativePath: string): Promise<boolean> {
  if (
    relativePath.startsWith("..") ||
    path.posix.isAbsolute(relativePath) ||
    isWindowsAbsoluteHref(relativePath)
  ) {
    return false;
  }

  try {
    const stats = await fs.stat(path.join(rootDir, relativePath));
    return stats.isFile();
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: 验证并提交**

Run:

```bash
npm run test -- src/lib/server/__tests__/project-insights.test.ts src/lib/server/__tests__/project-text-scan.test.ts
npm run typecheck
```

Commit:

```bash
git add web/src/lib/server/project-insights.ts web/src/lib/server/__tests__/project-insights.test.ts
git commit -m "feat: reuse text scan for project insights"
```

---

### Task 6: API execution metadata 与 Project Info 展示

**Files:**
- Modify: `web/src/app/api/projects/[projectId]/route.ts`
- Modify: `web/src/app/api/projects/__tests__/route.test.ts`
- Modify: `web/src/app/api/projects/[projectId]/search/route.ts`
- Modify: `web/src/app/api/projects/[projectId]/search/__tests__/route.test.ts`
- Modify: `web/src/app/api/projects/[projectId]/insights/route.ts`
- Modify: `web/src/app/api/projects/[projectId]/insights/__tests__/route.test.ts`
- Modify: `web/src/components/workbench/project-workbench.tsx`
- Modify: `web/src/components/workbench/project-workbench.test.tsx`

- [ ] **Step 1: 写失败测试**

在 project detail route test 断言加入：

```ts
runtime: {
  activeEngine: "node",
  bridgeStatus: "not-configured",
  heavyTasks: [
    { task: "project-search", engine: "node", bridgeStatus: "not-configured" },
    { task: "project-insights", engine: "node", bridgeStatus: "not-configured" },
  ],
},
```

在 search route success test 加入：

```ts
expect(payload.execution).toMatchObject({
  task: "project-search",
  engine: "node",
});
expect(payload.execution.durationMs).toBeGreaterThanOrEqual(0);
```

在 insights route success test 加入：

```ts
expect(payload.execution).toMatchObject({
  task: "project-insights",
  engine: "node",
});
expect(payload.execution.durationMs).toBeGreaterThanOrEqual(0);
```

在 `project-workbench.test.tsx` 的 Project Info 测试中加入：

```ts
expect(container?.textContent).toContain("Heavy task engine");
expect(container?.textContent).toContain("node");
expect(container?.textContent).toContain("Bridge status");
expect(container?.textContent).toContain("not-configured");
expect(container?.textContent).toContain("Tracked heavy tasks");
expect(container?.textContent).toContain("project-search, project-insights");
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm run test -- src/app/api/projects/__tests__/route.test.ts "src/app/api/projects/[projectId]/search/__tests__/route.test.ts" "src/app/api/projects/[projectId]/insights/__tests__/route.test.ts" src/components/workbench/project-workbench.test.tsx
```

Expected: 失败，原因是 routes 尚未附加 runtime/execution，Project Info 尚未展示 runtime。

- [ ] **Step 3: 更新 project detail route**

在 `web/src/app/api/projects/[projectId]/route.ts` import：

```ts
import { getProjectRuntimeCapabilities } from "@/lib/server/heavy-task-runtime";
```

在 payload 中加入：

```ts
runtime: getProjectRuntimeCapabilities(),
```

- [ ] **Step 4: 给 search/insights route 附加 execution**

在 search route import：

```ts
import {
  createHeavyTaskExecutionMetadata,
  getHeavyTaskNowMs,
} from "@/lib/server/heavy-task-runtime";
```

包裹 search 调用：

```ts
const startedAtMs = getHeavyTaskNowMs();
const response = await searchProjectFiles(project.rootDir, query);

return okJson({
  ...response,
  execution: createHeavyTaskExecutionMetadata("project-search", startedAtMs),
});
```

在 insights route 使用同样模式：

```ts
const startedAtMs = getHeavyTaskNowMs();
const response = await buildProjectInsights(project.rootDir);

return okJson({
  ...response,
  execution: createHeavyTaskExecutionMetadata("project-insights", startedAtMs),
});
```

- [ ] **Step 5: 更新 Project Info 展示**

在 `ProjectInfoPanel` 中加入：

```tsx
<InfoBlock label="Heavy task engine" value={detail.runtime.activeEngine} />
<InfoBlock label="Bridge status" value={detail.runtime.bridgeStatus} />
<InfoBlock
  label="Tracked heavy tasks"
  value={detail.runtime.heavyTasks.map((task) => task.task).join(", ")}
/>
```

- [ ] **Step 6: 验证并提交**

Run:

```bash
npm run test -- src/app/api/projects/__tests__/route.test.ts "src/app/api/projects/[projectId]/search/__tests__/route.test.ts" "src/app/api/projects/[projectId]/insights/__tests__/route.test.ts" src/components/workbench/project-workbench.test.tsx
npm run typecheck
```

Commit:

```bash
git add "web/src/app/api/projects/[projectId]/route.ts" web/src/app/api/projects/__tests__/route.test.ts "web/src/app/api/projects/[projectId]/search/route.ts" "web/src/app/api/projects/[projectId]/search/__tests__/route.test.ts" "web/src/app/api/projects/[projectId]/insights/route.ts" "web/src/app/api/projects/[projectId]/insights/__tests__/route.test.ts" web/src/components/workbench/project-workbench.tsx web/src/components/workbench/project-workbench.test.tsx
git commit -m "feat: expose heavy task runtime metadata"
```

---

### Task 7: 全量验证与 roadmap 更新

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

- test 全部通过。
- typecheck 通过。
- lint exit 0；允许既有 5 个 warning，但不能新增 error。

- [ ] **Step 2: 更新 roadmap**

在 `web/docs/web-roadmap-next-phases.md` 的 `### 10.4 阶段 8：Rust bridge / 重能力下沉` 下加入：

```md
> 状态：已完成前置基线。阶段 8 已按 [spec](../../docs/superpowers/specs/2026-04-26-phase-8-heavy-task-runtime-baseline-design.md) 和 [implementation plan](../../docs/superpowers/plans/2026-04-26-phase-8-heavy-task-runtime-baseline.md) 落地为“重任务能力基线与适配层”，覆盖共享项目文本扫描边界、多 query 单次扫描、问答检索复用、Insights 扫描复用、结构化 runtime capabilities、Search / Insights 执行元数据、Project Info 诊断展示和关键测试。当前未引入 Rust crate、native bridge、FFI、WASM、后台任务或持久化索引；active engine 仍为 `node`，Rust bridge 仍是瓶颈驱动的后置选项。
```

- [ ] **Step 3: 检查 roadmap**

Run:

```bash
rg -n "阶段 8|phase-8-heavy-task-runtime-baseline|状态：已完成前置基线|active engine" web/docs/web-roadmap-next-phases.md
```

Expected: 输出包含阶段 8 状态、spec 链接、plan 链接和 `active engine` 说明。

- [ ] **Step 4: 提交**

Run:

```bash
git add web/docs/web-roadmap-next-phases.md
git commit -m "docs: mark phase 8 roadmap baseline complete"
```

---

## 执行顺序

1. Task 1 建立 runtime 类型、服务和 ProjectDetail 基线。
2. Task 2 建立共享文本扫描层。
3. Task 3 改造搜索并新增多 query 搜索。
4. Task 4 让问答复用多 query 搜索。
5. Task 5 让 Insights 复用扫描层。
6. Task 6 暴露 API execution metadata 和 Project Info runtime 展示。
7. Task 7 全量验证并更新 roadmap。

## 完成定义

- Phase 8 spec 验收标准全部满足。
- 不引入 Rust、native bridge、FFI、WASM、后台任务或持久化索引。
- 搜索与 Insights 复用共享项目文本扫描层。
- 项目问答多 query 检索只触发一次项目文本扫描。
- `ProjectDetail.runtime` 暴露 `node` / `not-configured` capabilities。
- Search 和 Insights API 返回 execution metadata。
- Project Info 展示 runtime 诊断。
- 现有搜索、问答、Insights 行为不回退。
- `npm run test`、`npm run typecheck`、`npm run lint` 已运行并记录结果。
- roadmap 已标记 Phase 8 前置基线完成，并明确 Rust bridge 仍未落地。
