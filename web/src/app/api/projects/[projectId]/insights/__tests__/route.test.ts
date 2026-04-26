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
  vi.unstubAllEnvs();
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

  vi.stubEnv("LLM_WIKI_PROJECT_ROOTS", path.dirname(fixture.rootDir));

  const { GET: listProjects } = await import("../../../route");
  const response = await listProjects();
  const payload = (await response.json()) as {
    projects: Array<{ id: string }>;
  };
  const projectId = payload.projects[0]?.id;

  expect(projectId).toBeTruthy();

  return { fixture, projectId: projectId! };
}

describe("/api/projects/[projectId]/insights route", () => {
  it("GET builds graph edges for the resolved project", async () => {
    const { fixture, projectId } = await createProjectContext("insights-success");
    await fs.writeFile(
      path.join(fixture.rootDir, "wiki", "index.md"),
      "# Index\n\nSee [Topic](topic.md).\n",
      "utf8",
    );
    await fs.writeFile(path.join(fixture.rootDir, "wiki", "topic.md"), "# Topic\n", "utf8");

    const { GET, runtime } = await import("../route");
    const response = await GET(
      new Request(`http://localhost/api/projects/${projectId}/insights`),
      {
        params: Promise.resolve({ projectId }),
      },
    );
    const payload = (await response.json()) as {
      graph: {
        edges: Array<{
          sourceId: string;
          targetId: string;
          kind: string;
          label: string;
        }>;
      };
    };

    expect(runtime).toBe("nodejs");
    expect(response.status).toBe(200);
    expect(payload.graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: "file:wiki/index.md",
          targetId: "file:wiki/topic.md",
          kind: "links-to",
          label: "Topic",
        }),
      ]),
    );
  });

  it("GET returns 404 for an unknown project", async () => {
    await createProjectContext("insights-unknown-project");

    const { GET } = await import("../route");
    const response = await GET(
      new Request("http://localhost/api/projects/missing-project/insights"),
      {
        params: Promise.resolve({ projectId: "missing-project" }),
      },
    );
    const payload = (await response.json()) as {
      error: { code: string };
    };

    expect(response.status).toBe(404);
    expect(payload.error.code).toBe("PROJECT_NOT_FOUND");
  });
});
