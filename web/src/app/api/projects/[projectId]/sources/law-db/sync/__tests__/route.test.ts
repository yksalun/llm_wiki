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
    const rows = [{ myId: "abc", title: "统计法", content: "正文" }];
    lawMocks.listLawSourceRecords.mockResolvedValue(rows);
    lawMocks.syncLawSources.mockResolvedValue({
      ok: true,
      summary: { read: 1, created: 1, updated: 0, skipped: 0, failed: 0 },
      changedFiles: ["raw/sources/database/law/统计法.md"],
      failures: [],
    });

    const { POST, runtime } = await import("../route");
    const response = await POST(
      new Request(`http://localhost/api/projects/${projectId}/sources/law-db/sync`, { method: "POST" }),
      {
        params: Promise.resolve({ projectId }),
      },
    );
    const payload = await response.json();

    expect(runtime).toBe("nodejs");
    expect(response.status).toBe(200);
    expect(payload.summary.created).toBe(1);
    expect(lawMocks.syncLawSources).toHaveBeenCalledWith(fixture.rootDir, rows);
  });

  it("returns read-only access errors before reading MySQL", async () => {
    process.env.LLM_WIKI_PROJECT_ACCESS_MODE = "read-only";
    const { projectId } = await createProjectContext("law-sync-read-only");

    const { POST } = await import("../route");
    const response = await POST(
      new Request(`http://localhost/api/projects/${projectId}/sources/law-db/sync`, { method: "POST" }),
      {
        params: Promise.resolve({ projectId }),
      },
    );
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
