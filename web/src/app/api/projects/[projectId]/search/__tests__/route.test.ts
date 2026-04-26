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
  it("GET searches the resolved project files", async () => {
    const { fixture, projectId } = await createProjectContext("search-success");
    await fs.writeFile(path.join(fixture.rootDir, "wiki", "topic.md"), "Alpha route match.\n", "utf8");

    const { GET, runtime } = await import("../route");
    const response = await GET(
      new Request(`http://localhost/api/projects/${projectId}/search?q=alpha`),
      {
        params: Promise.resolve({ projectId }),
      },
    );
    const payload = (await response.json()) as {
      query: string;
      results: Array<{ relativePath: string }>;
      summary: { totalMatches: number };
      execution: {
        task: "project-search";
        engine: "node";
        durationMs: number;
      };
    };

    expect(runtime).toBe("nodejs");
    expect(response.status).toBe(200);
    expect(payload.query).toBe("alpha");
    expect(payload.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relativePath: "wiki/topic.md",
        }),
      ]),
    );
    expect(payload.summary.totalMatches).toBeGreaterThan(0);
    expect(payload.execution.task).toBe("project-search");
    expect(payload.execution.engine).toBe("node");
    expect(payload.execution.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("GET returns an empty response for short queries without scanning", async () => {
    const { projectId } = await createProjectContext("search-short-query");

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

  it("GET returns 404 for an unknown project", async () => {
    await createProjectContext("search-unknown-project");

    const { GET } = await import("../route");
    const response = await GET(
      new Request("http://localhost/api/projects/missing-project/search?q=alpha"),
      {
        params: Promise.resolve({ projectId: "missing-project" }),
      },
    );
    const payload = (await response.json()) as {
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(404);
    expect(payload.error.code).toBe("PROJECT_NOT_FOUND");
  });

  it("GET decodes the query from the request URL", async () => {
    const { fixture, projectId } = await createProjectContext("search-decode-query");
    await fs.writeFile(
      path.join(fixture.rootDir, "wiki", "encoded.md"),
      "Alpha route special match.\n",
      "utf8",
    );

    const { GET } = await import("../route");
    const response = await GET(
      new Request(`http://localhost/api/projects/${projectId}/search?q=Alpha%20route`),
      {
        params: Promise.resolve({ projectId }),
      },
    );
    const payload = (await response.json()) as {
      query: string;
      results: Array<{ relativePath: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload.query).toBe("Alpha route");
    expect(payload.results.map((result) => result.relativePath)).toContain("wiki/encoded.md");
  });
});
