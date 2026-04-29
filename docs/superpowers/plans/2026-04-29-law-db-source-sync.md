# Law Database Source Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Web-side manual sync flow that reads MySQL `law` records through Drizzle and writes them as incremental Markdown source files under each project.

**Architecture:** The Web server owns the whole first version: a dedicated Drizzle MySQL read layer loads `law` rows, a focused sync service materializes them into `raw/sources/database/law/*.md` plus `.sync-state.json`, and a Next API route exposes a manual sync action. The Web UI adds a small Project Info card that calls the route and reports created, updated, skipped, and failed counts. Desktop code stays untouched.

**Tech Stack:** Next.js App Router, TypeScript, Drizzle ORM with `mysql2`, Node `fs/promises`, Vitest, React client components.

---

## File Structure

- Modify: `web/package.json` and `web/package-lock.json`  
  Add the runtime dependency `mysql2`.
- Modify: `web/.env.example`  
  Add blank `LAW_DB_*` variables with no real host, user, or password.
- Modify: `web/src/lib/types.ts`  
  Add shared response types for the law database sync API.
- Modify: `web/src/lib/client/api.ts`  
  Add `syncLawDatabaseSources(projectId, signal)` for browser code.
- Create: `web/src/lib/server/law-db/schema.ts`  
  Define the external MySQL `law` table with Drizzle `mysqlTable`.
- Create: `web/src/lib/server/law-db/config.ts`  
  Read and validate `LAW_DB_*` env vars without exposing secrets.
- Create: `web/src/lib/server/law-db/client.ts`  
  Lazily read `LAW_DB_*` env vars and create a MySQL Drizzle database.
- Create: `web/src/lib/server/law-db/repo.ts`  
  Query `content` non-empty law rows and map DB values to stable source records.
- Create: `web/src/lib/server/__tests__/law-db-repo.test.ts`  
  Verify filtering, mapping, and safe configuration errors without real MySQL.
- Create: `web/src/lib/server/law-source-sync.ts`  
  Sanitize titles, generate Markdown, compute hashes, read/write state, and materialize changed files.
- Create: `web/src/lib/server/__tests__/law-source-sync.test.ts`  
  Verify filename collision, incremental updates, state, and no `sourceHtml` output.
- Create: `web/src/app/api/projects/[projectId]/sources/law-db/sync/route.ts`  
  Resolve project, enforce write access, call repo and sync service, return stats.
- Create: `web/src/app/api/projects/[projectId]/sources/law-db/sync/__tests__/route.test.ts`  
  Verify success, unknown project, read-only access, and safe DB config errors.
- Create: `web/src/components/workbench/law-database-sync-card.tsx`  
  Client UI button and result/error display.
- Create: `web/src/components/workbench/law-database-sync-card.test.tsx`  
  Verify loading, success stats, and error state.
- Modify: `web/src/components/workbench/project-workbench.tsx`  
  Render the sync card inside Project Info.
- Modify: `web/README.md`  
  Document the Web-side law database sync flow and env vars without real credentials.

---

### Task 1: Add MySQL Runtime Dependency

**Files:**
- Modify: `web/package.json`
- Modify: `web/package-lock.json`

- [ ] **Step 1: Install `mysql2`**

Run:

```powershell
cd web
npm install mysql2
cd ..
```

Expected: `web/package.json` includes `"mysql2"` in `dependencies`, and `web/package-lock.json` is updated.

- [ ] **Step 2: Verify package metadata changed only for dependency installation**

Run:

```powershell
git diff -- web/package.json web/package-lock.json
```

Expected: the diff adds `mysql2` and its lockfile entries, with no unrelated script or formatting changes.

- [ ] **Step 3: Commit dependency change**

Run:

```powershell
git add web/package.json web/package-lock.json
git commit -m "chore(web): add mysql client dependency"
```

Expected: one commit containing only package metadata changes.

---

### Task 2: Add Shared Sync Types and Browser Client

**Files:**
- Modify: `web/src/lib/types.ts`
- Modify: `web/src/lib/client/api.ts`

- [ ] **Step 1: Add shared response types**

In `web/src/lib/types.ts`, add these interfaces near the other API response types:

```ts
export interface LawDatabaseSyncSummary {
  read: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}

export interface LawDatabaseSyncFailure {
  myId: string | null;
  title: string | null;
  message: string;
}

export interface LawDatabaseSyncResponse {
  ok: true;
  summary: LawDatabaseSyncSummary;
  changedFiles: string[];
  failures: LawDatabaseSyncFailure[];
}
```

- [ ] **Step 2: Add client API function**

In `web/src/lib/client/api.ts`, import `LawDatabaseSyncResponse` from `@/lib/types`, then add:

```ts
export async function syncLawDatabaseSources(
  projectId: string,
  signal?: AbortSignal,
): Promise<LawDatabaseSyncResponse> {
  return requestJson<LawDatabaseSyncResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/sources/law-db/sync`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      signal,
    },
  );
}
```

- [ ] **Step 3: Run typecheck for early type errors**

Run:

```powershell
cd web
npm run typecheck
cd ..
```

Expected: TypeScript either passes or fails only on later missing implementation files that have not been created yet. Since this step only adds types and a fetch wrapper, it should pass after dependencies are installed.

- [ ] **Step 4: Commit shared client surface**

Run:

```powershell
git add web/src/lib/types.ts web/src/lib/client/api.ts
git commit -m "feat(web): add law sync API client types"
```

Expected: one commit with type and browser API additions.

---

### Task 3: Implement Drizzle MySQL Law DB Reader

**Files:**
- Create: `web/src/lib/server/law-db/schema.ts`
- Create: `web/src/lib/server/law-db/config.ts`
- Create: `web/src/lib/server/law-db/client.ts`
- Create: `web/src/lib/server/law-db/repo.ts`
- Create: `web/src/lib/server/__tests__/law-db-repo.test.ts`

- [ ] **Step 1: Write failing repo tests**

Create `web/src/lib/server/__tests__/law-db-repo.test.ts` with:

```ts
import { describe, expect, it, vi } from "vitest";

import {
  listLawSourceRecords,
  mapLawRowToSourceRecord,
} from "../law-db/repo";
import { createLawDbConfigFromEnv } from "../law-db/config";

describe("law db repo", () => {
  it("maps law table rows to source records without sourceHtml", () => {
    const result = mapLawRowToSourceRecord({
      myId: "abc123",
      title: "中华人民共和国统计法(2024修正)",
      content: "第一条 为了科学、有效地组织统计工作...",
      url: "http://example.test/law",
      time: "2024-09-13",
      insertTime: new Date("2026-04-24T10:37:52.000Z"),
      type: null,
    });

    expect(result).toEqual({
      myId: "abc123",
      title: "中华人民共和国统计法(2024修正)",
      content: "第一条 为了科学、有效地组织统计工作...",
      url: "http://example.test/law",
      lawTime: "2024-09-13",
      insertTime: "2026-04-24T10:37:52.000Z",
      type: null,
    });
  });

  it("requires all law db connection environment variables except port", () => {
    expect(() =>
      createLawDbConfigFromEnv({
        LAW_DB_HOST: "127.0.0.1",
        LAW_DB_DATABASE: "aifood",
        LAW_DB_USER: "root",
      }),
    ).toThrow("法规数据库配置不完整");
  });

  it("uses a Drizzle-like database to list non-empty content records", async () => {
    const where = vi.fn(async () => [
      {
        myId: "abc123",
        title: "统计法",
        content: "正文",
        url: "http://example.test/a",
        time: "2024-09-13",
        insertTime: "2026-04-24 10:37:52",
        type: "law",
      },
    ]);
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));

    const records = await listLawSourceRecords({
      select,
    });

    expect(select).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(1);
    expect(records).toEqual([
      {
        myId: "abc123",
        title: "统计法",
        content: "正文",
        url: "http://example.test/a",
        lawTime: "2024-09-13",
        insertTime: "2026-04-24 10:37:52",
        type: "law",
      },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
cd web
npm run test -- src/lib/server/__tests__/law-db-repo.test.ts
cd ..
```

Expected: FAIL because `web/src/lib/server/law-db/repo.ts` does not exist.

- [ ] **Step 3: Create Drizzle schema**

Create `web/src/lib/server/law-db/schema.ts`:

```ts
import { datetime, longtext, mysqlTable, text, varchar } from "drizzle-orm/mysql-core";

export const lawTable = mysqlTable("law", {
  myId: varchar("myId", { length: 255 }),
  title: text("title"),
  content: longtext("content"),
  url: varchar("url", { length: 255 }),
  time: text("time"),
  insertTime: datetime("insertTime"),
  type: varchar("type", { length: 255 }),
});
```

- [ ] **Step 4: Create lazy MySQL Drizzle client**

Create `web/src/lib/server/law-db/config.ts`:

```ts
import { AppError } from "../app-error";

export interface LawDbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export function createLawDbConfigFromEnv(env: NodeJS.ProcessEnv): LawDbConfig {
  const host = env.LAW_DB_HOST?.trim();
  const database = env.LAW_DB_DATABASE?.trim();
  const user = env.LAW_DB_USER?.trim();
  const password = env.LAW_DB_PASSWORD;
  const portText = env.LAW_DB_PORT?.trim() || "3306";
  const port = Number.parseInt(portText, 10);

  if (!host || !database || !user || !password || !Number.isFinite(port)) {
    throw new AppError("LAW_DB_CONFIG_MISSING", 500, "法规数据库配置不完整。");
  }

  return { host, port, database, user, password };
}
```

Create `web/src/lib/server/law-db/client.ts`:

```ts
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

import { createLawDbConfigFromEnv, type LawDbConfig } from "./config";
import * as schema from "./schema";

declare global {
  var __llmWikiLawDbPool: mysql.Pool | undefined;
}

export function createLawMysqlPool(config: LawDbConfig): mysql.Pool {
  return mysql.createPool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    waitForConnections: true,
    connectionLimit: 5,
  });
}

export function getLawDb() {
  const config = createLawDbConfigFromEnv(process.env);
  const pool = globalThis.__llmWikiLawDbPool ?? createLawMysqlPool(config);

  if (process.env.NODE_ENV !== "production") {
    globalThis.__llmWikiLawDbPool = pool;
  }

  return drizzle(pool, { schema, mode: "default" });
}
```

- [ ] **Step 5: Create repo implementation**

Create `web/src/lib/server/law-db/repo.ts`:

```ts
import { and, isNotNull, ne } from "drizzle-orm";

import { AppError } from "../app-error";
import { getLawDb } from "./client";
import { lawTable } from "./schema";

export interface LawSourceRecord {
  myId: string;
  title: string | null;
  content: string;
  url: string | null;
  lawTime: string | null;
  insertTime: string | null;
  type: string | null;
}

interface LawRow {
  myId: string | null;
  title: string | null;
  content: string | null;
  url: string | null;
  time: string | null;
  insertTime: Date | string | null;
  type: string | null;
}

interface LawDbLike {
  select: (fields: Record<string, unknown>) => {
    from: (table: unknown) => {
      where: (condition: unknown) => Promise<LawRow[]>;
    };
  };
}

export function createLawDbConfigFromEnv(env: NodeJS.ProcessEnv): LawDbConfig {
  const host = env.LAW_DB_HOST?.trim();
  const database = env.LAW_DB_DATABASE?.trim();
  const user = env.LAW_DB_USER?.trim();
  const password = env.LAW_DB_PASSWORD;
  const portText = env.LAW_DB_PORT?.trim() || "3306";
  const port = Number.parseInt(portText, 10);

  if (!host || !database || !user || !password || !Number.isFinite(port)) {
    throw new AppError("LAW_DB_CONFIG_MISSING", 500, "法规数据库配置不完整。");
  }

  return { host, port, database, user, password };
}

export async function listLawSourceRecords(database: LawDbLike = getLawDb()): Promise<LawSourceRecord[]> {
  try {
    const rows = await database
      .select({
        myId: lawTable.myId,
        title: lawTable.title,
        content: lawTable.content,
        url: lawTable.url,
        time: lawTable.time,
        insertTime: lawTable.insertTime,
        type: lawTable.type,
      })
      .from(lawTable)
      .where(and(isNotNull(lawTable.content), ne(lawTable.content, "")));

    return rows
      .map(mapLawRowToSourceRecord)
      .filter((record): record is LawSourceRecord => record !== null);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError("LAW_DB_QUERY_FAILED", 502, "读取法规数据库失败。", {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

export function mapLawRowToSourceRecord(row: LawRow): LawSourceRecord | null {
  const myId = row.myId?.trim();
  const content = row.content?.trim();

  if (!myId || !content) {
    return null;
  }

  return {
    myId,
    title: normalizeNullableString(row.title),
    content,
    url: normalizeNullableString(row.url),
    lawTime: normalizeNullableString(row.time),
    insertTime: normalizeInsertTime(row.insertTime),
    type: normalizeNullableString(row.type),
  };
}

function normalizeNullableString(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeInsertTime(value: Date | string | null): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return normalizeNullableString(value);
}
```

- [ ] **Step 6: Run repo tests**

Run:

```powershell
cd web
npm run test -- src/lib/server/__tests__/law-db-repo.test.ts
cd ..
```

Expected: PASS.

- [ ] **Step 7: Commit DB reader**

Run:

```powershell
git add web/src/lib/server/law-db web/src/lib/server/__tests__/law-db-repo.test.ts
git commit -m "feat(web): read law records with drizzle mysql"
```

Expected: one commit with DB read layer and tests.

---

### Task 4: Implement Markdown Source Sync Service

**Files:**
- Create: `web/src/lib/server/law-source-sync.ts`
- Create: `web/src/lib/server/__tests__/law-source-sync.test.ts`

- [ ] **Step 1: Write failing sync service tests**

Create `web/src/lib/server/__tests__/law-source-sync.test.ts`:

```ts
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildLawMarkdown,
  sanitizeLawFileBaseName,
  syncLawSources,
} from "../law-source-sync";
import type { LawSourceRecord } from "../law-db/repo";

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
    const markdown = buildLawMarkdown(record({ myId: "abc123", title: "统计法", content: "正文" }), "sha256:test");

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

    expect(result.summary).toMatchObject({ read: 3, created: 3, updated: 0, skipped: 0, failed: 0 });
    expect(result.changedFiles).toEqual([
      "raw/sources/database/law/统计法.md",
      "raw/sources/database/law/统计法-def98765.md",
      "raw/sources/database/law/law-empty-ti.md",
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

    expect(second.summary).toMatchObject({ read: 1, created: 0, updated: 0, skipped: 1, failed: 0 });
    expect(third.summary).toMatchObject({ read: 1, created: 0, updated: 1, skipped: 0, failed: 0 });
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
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
cd web
npm run test -- src/lib/server/__tests__/law-source-sync.test.ts
cd ..
```

Expected: FAIL because `law-source-sync.ts` does not exist.

- [ ] **Step 3: Implement sync service**

Create `web/src/lib/server/law-source-sync.ts` with these exports and behavior:

```ts
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type {
  LawDatabaseSyncFailure,
  LawDatabaseSyncResponse,
  LawDatabaseSyncSummary,
} from "@/lib/types";

import type { LawSourceRecord } from "./law-db/repo";
import { normalizeRelativePath, resolvePathInsideRoot } from "./path-safety";

const SYNC_DIR = "raw/sources/database/law";
const STATE_FILE = `${SYNC_DIR}/.sync-state.json`;
const MAX_BASE_NAME_LENGTH = 120;

interface LawSyncState {
  version: 1;
  records: Record<string, LawSyncStateRecord>;
}

interface LawSyncStateRecord {
  title: string | null;
  filePath: string;
  contentHash: string;
  lawTime: string | null;
  insertTime: string | null;
  syncedAt: string;
}

export async function syncLawSources(
  projectRoot: string,
  records: LawSourceRecord[],
  now: () => Date = () => new Date(),
): Promise<LawDatabaseSyncResponse> {
  const state = await readSyncState(projectRoot);
  const nextState: LawSyncState = { version: 1, records: { ...state.records } };
  const usedPaths = new Map<string, string>();
  const summary: LawDatabaseSyncSummary = {
    read: records.length,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
  };
  const changedFiles: string[] = [];
  const failures: LawDatabaseSyncFailure[] = [];
  const sortedRecords = [...records].sort((left, right) =>
    (left.title ?? "").localeCompare(right.title ?? "") || left.myId.localeCompare(right.myId),
  );

  for (const [myId, existing] of Object.entries(state.records)) {
    usedPaths.set(existing.filePath, myId);
  }

  await fs.mkdir(resolvePathInsideRoot(projectRoot, SYNC_DIR), { recursive: true });

  for (const record of sortedRecords) {
    try {
      const contentHash = hashLawRecord(record);
      const previous = state.records[record.myId];
      const filePath = allocateLawFilePath(record, previous, usedPaths);
      const absolutePath = resolvePathInsideRoot(projectRoot, filePath);
      const fileExists = await exists(absolutePath);

      if (previous?.contentHash === contentHash && previous.filePath === filePath && fileExists) {
        summary.skipped += 1;
        nextState.records[record.myId] = previous;
        continue;
      }

      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, buildLawMarkdown(record, contentHash), "utf8");

      if (previous?.filePath && previous.filePath !== filePath) {
        await fs.rm(resolvePathInsideRoot(projectRoot, previous.filePath), { force: true }).catch(() => undefined);
      }

      nextState.records[record.myId] = {
        title: record.title,
        filePath,
        contentHash,
        lawTime: record.lawTime,
        insertTime: record.insertTime,
        syncedAt: now().toISOString(),
      };

      if (previous) summary.updated += 1;
      else summary.created += 1;

      changedFiles.push(filePath);
    } catch (error) {
      summary.failed += 1;
      failures.push({
        myId: record.myId || null,
        title: record.title,
        message: error instanceof Error ? error.message : "写入法规资料源失败。",
      });
    }
  }

  await writeSyncState(projectRoot, nextState);

  return { ok: true, summary, changedFiles, failures };
}

export function sanitizeLawFileBaseName(title: string): string {
  return title
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .replace(/^\.+$/, "")
    .replace(/^[.\s-]+|[.\s-]+$/g, "")
    .slice(0, MAX_BASE_NAME_LENGTH);
}

export function buildLawMarkdown(record: LawSourceRecord, contentHash: string): string {
  const title = record.title?.trim() || `law-${record.myId.slice(0, 8)}`;
  const frontmatter = [
    "---",
    'sourceType: "mysql-law"',
    `myId: ${JSON.stringify(record.myId)}`,
    `title: ${JSON.stringify(title)}`,
    `url: ${JSON.stringify(record.url ?? "")}`,
    `lawTime: ${JSON.stringify(record.lawTime ?? "")}`,
    `insertTime: ${JSON.stringify(record.insertTime ?? "")}`,
    `type: ${JSON.stringify(record.type ?? "")}`,
    `contentHash: ${JSON.stringify(contentHash)}`,
    "---",
  ].join("\n");

  return `${frontmatter}\n\n# ${title}\n\n${record.content.trim()}\n`;
}

export function hashLawRecord(record: LawSourceRecord): string {
  const value = JSON.stringify({
    myId: record.myId,
    title: record.title,
    content: record.content,
    url: record.url,
    lawTime: record.lawTime,
    insertTime: record.insertTime,
    type: record.type,
  });

  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function allocateLawFilePath(
  record: LawSourceRecord,
  previous: LawSyncStateRecord | undefined,
  usedPaths: Map<string, string>,
): string {
  const base = sanitizeLawFileBaseName(record.title ?? "") || `law-${record.myId.slice(0, 8)}`;
  const primary = normalizeRelativePath(`${SYNC_DIR}/${base}.md`);
  const previousTitleMatches = previous?.title === record.title;

  if (previous && previousTitleMatches) {
    usedPaths.set(previous.filePath, record.myId);
    return previous.filePath;
  }

  const currentOwner = usedPaths.get(primary);
  if (!currentOwner || currentOwner === record.myId) {
    usedPaths.set(primary, record.myId);
    return primary;
  }

  const fallback = normalizeRelativePath(`${SYNC_DIR}/${base}-${record.myId.slice(0, 8)}.md`);
  usedPaths.set(fallback, record.myId);
  return fallback;
}

async function readSyncState(projectRoot: string): Promise<LawSyncState> {
  const statePath = resolvePathInsideRoot(projectRoot, STATE_FILE);

  try {
    const raw = await fs.readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<LawSyncState>;

    if (parsed.version !== 1 || !parsed.records || typeof parsed.records !== "object") {
      throw new Error("Invalid sync state");
    }

    return { version: 1, records: parsed.records as Record<string, LawSyncStateRecord> };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { version: 1, records: {} };
    }

    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.rename(statePath, `${statePath}.corrupt-${Date.now()}`).catch(() => undefined);
    return { version: 1, records: {} };
  }
}

async function writeSyncState(projectRoot: string, state: LawSyncState): Promise<void> {
  const statePath = resolvePathInsideRoot(projectRoot, STATE_FILE);
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
```

- [ ] **Step 4: Run sync service tests**

Run:

```powershell
cd web
npm run test -- src/lib/server/__tests__/law-source-sync.test.ts
cd ..
```

Expected: PASS.

- [ ] **Step 5: Commit sync service**

Run:

```powershell
git add web/src/lib/server/law-source-sync.ts web/src/lib/server/__tests__/law-source-sync.test.ts
git commit -m "feat(web): sync law records into source files"
```

Expected: one commit with sync service and tests.

---

### Task 5: Add Law Sync API Route

**Files:**
- Create: `web/src/app/api/projects/[projectId]/sources/law-db/sync/route.ts`
- Create: `web/src/app/api/projects/[projectId]/sources/law-db/sync/__tests__/route.test.ts`

- [ ] **Step 1: Write failing route tests**

Create `web/src/app/api/projects/[projectId]/sources/law-db/sync/__tests__/route.test.ts`:

```ts
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFixtureProject } from "@/test-utils/project-fixture";

const repoMocks = vi.hoisted(() => ({
  upsertProjectSnapshot: vi.fn(async () => {}),
  insertSyncRun: vi.fn(async () => {}),
  findProjectSnapshotById: vi.fn(async () => null),
  findProjectSnapshotByRootPath: vi.fn(async () => null),
}));

const lawMocks = vi.hoisted(() => ({
  listLawSourceRecords: vi.fn(),
  syncLawSources: vi.fn(),
}));

vi.mock("@/lib/db/project-snapshot-repo", () => repoMocks);
vi.mock("@/lib/server/law-db/repo", () => ({
  listLawSourceRecords: lawMocks.listLawSourceRecords,
}));
vi.mock("@/lib/server/law-source-sync", () => ({
  syncLawSources: lawMocks.syncLawSources,
}));

const cleanupTasks: Array<() => Promise<void>> = [];
let originalAccessMode: string | undefined;

beforeEach(() => {
  originalAccessMode = process.env.LLM_WIKI_PROJECT_ACCESS_MODE;
  delete process.env.LLM_WIKI_PROJECT_ACCESS_MODE;
  for (const mock of Object.values(repoMocks)) mock.mockClear();
  lawMocks.listLawSourceRecords.mockReset();
  lawMocks.syncLawSources.mockReset();
});

afterEach(async () => {
  delete process.env.LLM_WIKI_PROJECT_ROOTS;
  if (originalAccessMode === undefined) delete process.env.LLM_WIKI_PROJECT_ACCESS_MODE;
  else process.env.LLM_WIKI_PROJECT_ACCESS_MODE = originalAccessMode;
  vi.resetModules();
  while (cleanupTasks.length > 0) {
    const cleanup = cleanupTasks.pop();
    if (cleanup) await cleanup();
  }
});

describe("/api/projects/[projectId]/sources/law-db/sync route", () => {
  it("syncs law rows into the resolved project root", async () => {
    const { fixture, projectId } = await createProjectContext("law-sync-route");
    lawMocks.listLawSourceRecords.mockResolvedValue([{ myId: "abc", title: "统计法", content: "正文" }]);
    lawMocks.syncLawSources.mockResolvedValue({
      ok: true,
      summary: { read: 1, created: 1, updated: 0, skipped: 0, failed: 0 },
      changedFiles: ["raw/sources/database/law/统计法.md"],
      failures: [],
    });

    const { POST, runtime } = await import("../route");
    const response = await POST(new Request(`http://localhost/api/projects/${projectId}/sources/law-db/sync`, { method: "POST" }), {
      params: Promise.resolve({ projectId }),
    });
    const payload = await response.json();

    expect(runtime).toBe("nodejs");
    expect(response.status).toBe(200);
    expect(payload.summary.created).toBe(1);
    expect(lawMocks.syncLawSources).toHaveBeenCalledWith(fixture.rootDir, [{ myId: "abc", title: "统计法", content: "正文" }]);
  });

  it("returns read-only access errors before reading MySQL", async () => {
    process.env.LLM_WIKI_PROJECT_ACCESS_MODE = "read-only";
    const { projectId } = await createProjectContext("law-sync-read-only");

    const { POST } = await import("../route");
    const response = await POST(new Request(`http://localhost/api/projects/${projectId}/sources/law-db/sync`, { method: "POST" }), {
      params: Promise.resolve({ projectId }),
    });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error.code).toBe("PROJECT_ACCESS_READ_ONLY");
    expect(lawMocks.listLawSourceRecords).not.toHaveBeenCalled();
  });
});

async function createProjectContext(projectName: string) {
  const fixture = await createFixtureProject(projectName);
  cleanupTasks.push(fixture.cleanup);
  process.env.LLM_WIKI_PROJECT_ROOTS = path.dirname(fixture.rootDir);

  const { GET: listProjects } = await import("../../../../../route");
  const response = await listProjects();
  const payload = (await response.json()) as { projects: Array<{ id: string }> };
  const projectId = payload.projects[0]?.id;
  expect(projectId).toBeTruthy();
  return { fixture, projectId: projectId! };
}
```

- [ ] **Step 2: Run route tests to verify failure**

Run:

```powershell
cd web
npm run test -- "src/app/api/projects/[projectId]/sources/law-db/sync/__tests__/route.test.ts"
cd ..
```

Expected: FAIL because the route file does not exist.

- [ ] **Step 3: Create API route**

Create `web/src/app/api/projects/[projectId]/sources/law-db/sync/route.ts`:

```ts
import { getProjectRootsFromEnv } from "@/lib/server/env";
import {
  getProjectAccessPolicyFromEnv,
  requireProjectWriteAccess,
} from "@/lib/server/project-access";
import { resolveProjectById } from "@/lib/server/project-registry";
import { listLawSourceRecords } from "@/lib/server/law-db/repo";
import { syncLawSources } from "@/lib/server/law-source-sync";
import { errorJson, okJson } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

export async function POST(_request: Request, context: ProjectRouteContext) {
  try {
    const { projectId } = await context.params;
    const project = await resolveProjectById(getProjectRootsFromEnv(), projectId);
    const policy = getProjectAccessPolicyFromEnv();

    requireProjectWriteAccess(policy);

    const records = await listLawSourceRecords();
    const response = await syncLawSources(project.rootDir, records);

    return okJson(response);
  } catch (error) {
    return errorJson(error);
  }
}
```

- [ ] **Step 4: Run route tests**

Run:

```powershell
cd web
npm run test -- "src/app/api/projects/[projectId]/sources/law-db/sync/__tests__/route.test.ts"
cd ..
```

Expected: PASS.

- [ ] **Step 5: Commit API route**

Run:

```powershell
git add "web/src/app/api/projects/[projectId]/sources/law-db/sync"
git commit -m "feat(web): expose law source sync route"
```

Expected: one commit with the route and tests.

---

### Task 6: Add Project Info Sync UI

**Files:**
- Create: `web/src/components/workbench/law-database-sync-card.tsx`
- Create: `web/src/components/workbench/law-database-sync-card.test.tsx`
- Modify: `web/src/components/workbench/project-workbench.tsx`

- [ ] **Step 1: Write failing UI tests**

Create `web/src/components/workbench/law-database-sync-card.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { syncLawDatabaseSources } from "@/lib/client/api";

import { LawDatabaseSyncCard } from "./law-database-sync-card";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/client/api", () => ({
  syncLawDatabaseSources: vi.fn(),
}));

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
  vi.clearAllMocks();
});

describe("LawDatabaseSyncCard", () => {
  it("syncs and renders summary counts", async () => {
    vi.mocked(syncLawDatabaseSources).mockResolvedValue({
      ok: true,
      summary: { read: 3, created: 1, updated: 1, skipped: 1, failed: 0 },
      changedFiles: ["raw/sources/database/law/统计法.md"],
      failures: [],
    });

    renderCard();
    await clickButton("同步法规数据库");

    expect(container?.textContent).toContain("读取 3");
    expect(container?.textContent).toContain("新增 1");
    expect(container?.textContent).toContain("更新 1");
    expect(container?.textContent).toContain("跳过 1");
    expect(container?.textContent).toContain("raw/sources/database/law/统计法.md");
  });

  it("renders safe error messages", async () => {
    vi.mocked(syncLawDatabaseSources).mockRejectedValue(new Error("法规数据库配置不完整。"));

    renderCard();
    await clickButton("同步法规数据库");

    expect(container?.textContent).toContain("法规数据库配置不完整。");
  });
});

function renderCard() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(<LawDatabaseSyncCard projectId="project-1" />);
  });
}

async function clickButton(name: string) {
  const button = Array.from(container?.querySelectorAll("button") ?? []).find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${name}`);
  }
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
}
```

- [ ] **Step 2: Run UI tests to verify failure**

Run:

```powershell
cd web
npm run test -- src/components/workbench/law-database-sync-card.test.tsx
cd ..
```

Expected: FAIL because the card component does not exist.

- [ ] **Step 3: Implement sync card**

Create `web/src/components/workbench/law-database-sync-card.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";
import { Database, RefreshCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { syncLawDatabaseSources } from "@/lib/client/api";
import type { LawDatabaseSyncResponse } from "@/lib/types";

interface LawDatabaseSyncCardProps {
  projectId: string;
}

type SyncState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "success"; result: LawDatabaseSyncResponse }
  | { status: "error"; message: string };

export function LawDatabaseSyncCard({ projectId }: LawDatabaseSyncCardProps) {
  const [state, setState] = useState<SyncState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  async function handleSync() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ status: "running" });

    try {
      const result = await syncLawDatabaseSources(projectId, controller.signal);
      setState({ status: "success", result });
    } catch (error) {
      if (!controller.signal.aborted) {
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "同步法规数据库失败。",
        });
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }

  return (
    <div className="rounded-[20px] border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)]/55 p-4 md:col-span-2 xl:col-span-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <div className="rounded-full border border-[color:var(--paper-border)] bg-[color:var(--paper-accent)]/20 p-2 text-[color:var(--ink-soft)]">
            <Database className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[color:var(--ink-strong)]">法规数据库资料源</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              从 Web 服务端配置的 MySQL law 表生成本地 source 文件；不会自动生成 wiki 页面。
            </p>
          </div>
        </div>
        <Button onClick={() => void handleSync()} disabled={state.status === "running"}>
          <RefreshCcw className="size-4" />
          {state.status === "running" ? "正在同步..." : "同步法规数据库"}
        </Button>
      </div>

      {state.status === "success" ? <SyncSuccess result={state.result} /> : null}
      {state.status === "error" ? (
        <p className="mt-3 text-sm text-destructive">{state.message}</p>
      ) : null}
    </div>
  );
}

function SyncSuccess({ result }: { result: LawDatabaseSyncResponse }) {
  return (
    <div className="mt-4 space-y-3 text-sm text-[color:var(--ink-strong)]">
      <div className="flex flex-wrap gap-2">
        <SyncPill label="读取" value={result.summary.read} />
        <SyncPill label="新增" value={result.summary.created} />
        <SyncPill label="更新" value={result.summary.updated} />
        <SyncPill label="跳过" value={result.summary.skipped} />
        <SyncPill label="失败" value={result.summary.failed} />
      </div>
      {result.changedFiles.length > 0 ? (
        <div className="rounded-[16px] border border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]/70 p-3">
          <p className="font-medium">变更文件</p>
          <ul className="mt-2 space-y-1 font-mono text-xs text-muted-foreground">
            {result.changedFiles.slice(0, 8).map((file) => (
              <li key={file}>{file}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function SyncPill({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded-full border border-[color:var(--paper-border)] bg-[color:var(--paper-panel)] px-3 py-1">
      {label} {value}
    </span>
  );
}
```

- [ ] **Step 4: Render card in Project Info**

Modify `web/src/components/workbench/project-workbench.tsx`:

1. Add the import:

```ts
import { LawDatabaseSyncCard } from "@/components/workbench/law-database-sync-card";
```

2. In `ProjectInfoPanel`, render the card as the first child of `CardContent`:

```tsx
<LawDatabaseSyncCard projectId={detail.id} />
```

- [ ] **Step 5: Run UI tests**

Run:

```powershell
cd web
npm run test -- src/components/workbench/law-database-sync-card.test.tsx
npm run test -- src/components/workbench/project-workbench.test.tsx
cd ..
```

Expected: PASS.

- [ ] **Step 6: Commit UI**

Run:

```powershell
git add web/src/components/workbench/law-database-sync-card.tsx web/src/components/workbench/law-database-sync-card.test.tsx web/src/components/workbench/project-workbench.tsx
git commit -m "feat(web): add law database sync control"
```

Expected: one commit with the Project Info sync UI.

---

### Task 7: Document Web-Side Configuration

**Files:**
- Modify: `web/.env.example`
- Modify: `web/README.md`

- [ ] **Step 1: Add blank env example values**

Append to `web/.env.example`:

```env

# Optional: Web-side MySQL source sync for law records.
# Values are intentionally blank here; keep real credentials in local or deployment env only.
LAW_DB_HOST=
LAW_DB_PORT=3306
LAW_DB_DATABASE=aifood
LAW_DB_USER=
LAW_DB_PASSWORD=
```

- [ ] **Step 2: Add README section**

In `web/README.md`, add a concise section near the environment variable section:

```md
### 法规数据库资料源同步

Web 端可以手动从外部 MySQL `law` 表同步法规资料源到当前项目目录。同步只生成本地 Markdown source 文件：

```text
raw/sources/database/law/*.md
```

第一版不会自动触发桌面端 ingest，也不会生成 `wiki/*` 页面。同步后需要在桌面端资料源流程中继续摄入这些 Markdown 文件。

需要配置：

```bash
LAW_DB_HOST=
LAW_DB_PORT=3306
LAW_DB_DATABASE=aifood
LAW_DB_USER=
LAW_DB_PASSWORD=
```

不要把真实密码提交到仓库。错误提示也不会返回密码或完整连接串。
```

- [ ] **Step 3: Verify no sensitive values are present**

Run:

```powershell
Select-String -Path web\\.env.example,web\\README.md,docs\\superpowers\\plans\\2026-04-29-law-db-source-sync.md -Pattern '41\\.226|XzGa|330411|1593|Pwd=|Uid=|server=' -CaseSensitive:$false
```

Expected: no matches.

- [ ] **Step 4: Commit docs**

Run:

```powershell
git add web/.env.example web/README.md
git commit -m "docs(web): document law database source sync"
```

Expected: one commit with docs only.

---

### Task 8: Full Verification

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run focused tests**

Run:

```powershell
cd web
npm run test -- src/lib/server/__tests__/law-db-repo.test.ts
npm run test -- src/lib/server/__tests__/law-source-sync.test.ts
npm run test -- "src/app/api/projects/[projectId]/sources/law-db/sync/__tests__/route.test.ts"
npm run test -- src/components/workbench/law-database-sync-card.test.tsx
cd ..
```

Expected: all focused tests pass.

- [ ] **Step 2: Run Web typecheck and full tests**

Run:

```powershell
cd web
npm run typecheck
npm run test
cd ..
```

Expected: typecheck passes and Web test suite passes.

- [ ] **Step 3: Verify desktop code stayed untouched**

Run:

```powershell
git diff --name-only f6caf4c..HEAD
```

Expected: changed files are under `web/` plus docs/plan files; no `src/` or `src-tauri/` files.

- [ ] **Step 4: Verify no credential leakage**

Run:

```powershell
git grep -n -i -E "41\\.226|XzGa|330411|1593|Pwd=|Uid=|server=" HEAD
```

Expected: no matches.

- [ ] **Step 5: Commit any final fixes**

If verification required fixes, run:

```powershell
git add <fixed-files>
git commit -m "fix(web): stabilize law database source sync"
```

Expected: no commit is created if no fixes were necessary.
