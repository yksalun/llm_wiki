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
let originalProjectAccessMode: string | undefined;

beforeEach(() => {
  originalProjectAccessMode = process.env.LLM_WIKI_PROJECT_ACCESS_MODE;
  delete process.env.LLM_WIKI_PROJECT_ACCESS_MODE;
  repoMocks.upsertProjectSnapshot.mockClear();
  repoMocks.insertSyncRun.mockClear();
  repoMocks.findProjectSnapshotById.mockClear();
  repoMocks.findProjectSnapshotByRootPath.mockClear();
});

afterEach(async () => {
  delete process.env.LLM_WIKI_PROJECT_ROOTS;
  if (originalProjectAccessMode === undefined) {
    delete process.env.LLM_WIKI_PROJECT_ACCESS_MODE;
  } else {
    process.env.LLM_WIKI_PROJECT_ACCESS_MODE = originalProjectAccessMode;
  }
  vi.resetModules();

  while (cleanupTasks.length > 0) {
    const cleanup = cleanupTasks.pop();

    if (cleanup) {
      await cleanup();
    }
  }
});

describe("/api/projects routes", () => {
  it("GET /api/projects returns projects and warnings from configured roots", async () => {
    const fixture = await createFixtureProject("alpha");
    cleanupTasks.push(fixture.cleanup);

    const missingRoot = path.join(path.dirname(fixture.rootDir), "missing-root");
    process.env.LLM_WIKI_PROJECT_ROOTS = `${missingRoot},${path.dirname(fixture.rootDir)}`;

    const { GET, runtime } = await import("../route");
    const response = await GET();
    const payload = (await response.json()) as {
      projects: Array<{ name: string; rootPathHint?: string | null }>;
      warnings: string[];
    };

    expect(runtime).toBe("nodejs");
    expect(response.status).toBe(200);
    expect(payload.projects).toHaveLength(1);
    expect(payload.projects[0]).toMatchObject({
      name: "alpha",
    });
    expect(repoMocks.upsertProjectSnapshot).toHaveBeenCalledTimes(1);
    expect(repoMocks.insertSyncRun).toHaveBeenCalledTimes(2);
    expect(payload.warnings).toHaveLength(1);
    expect(payload.warnings[0]).toBe("无法扫描已配置的项目根目录。");
    expect(payload.warnings[0]).not.toContain(missingRoot);
    expect(payload.warnings[0]).not.toContain(path.dirname(fixture.rootDir));
  });

  it("GET /api/projects/[projectId] returns project detail with hidden rootPathHint", async () => {
    const fixture = await createFixtureProject("detail-project");
    cleanupTasks.push(fixture.cleanup);

    process.env.LLM_WIKI_PROJECT_ROOTS = path.dirname(fixture.rootDir);

    const { GET: listProjects } = await import("../route");
    const listResponse = await listProjects();
    const listPayload = (await listResponse.json()) as {
      projects: Array<{ id: string }>;
    };

    const projectId = listPayload.projects[0]?.id;

    expect(projectId).toBeTruthy();

    const { GET, runtime } = await import("../[projectId]/route");
    const response = await GET(
      new Request(`http://localhost/api/projects/${projectId}`),
      {
        params: Promise.resolve({ projectId: projectId! }),
      },
    );
    const payload = (await response.json()) as {
      id: string;
      name: string;
      access: {
        mode: "read-write";
        canRead: true;
        canWrite: true;
      };
      runtime: {
        activeEngine: "node";
        bridgeStatus: "not-configured";
        heavyTasks: Array<{
          task: "project-search" | "project-insights";
          engine: "node";
          bridgeStatus: "not-configured";
        }>;
      };
      rootPathHint: string | null;
      sections: string[];
    };

    expect(runtime).toBe("nodejs");
    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      id: projectId,
      name: "detail-project",
      access: {
        mode: "read-write",
        canRead: true,
        canWrite: true,
      },
      runtime: {
        activeEngine: "node",
        bridgeStatus: "not-configured",
        heavyTasks: [
          { task: "project-search", engine: "node", bridgeStatus: "not-configured" },
          { task: "project-insights", engine: "node", bridgeStatus: "not-configured" },
        ],
      },
      rootPathHint: null,
      sections: ["Overview", "Ask", "Insights", "Files", "Purpose", "Schema", "Project Info"],
    });
    expect(payload).not.toHaveProperty("rootDir");
  });

  it("GET /api/projects/[projectId] returns env-derived read-only access", async () => {
    const fixture = await createFixtureProject("detail-read-only-project");
    cleanupTasks.push(fixture.cleanup);

    process.env.LLM_WIKI_PROJECT_ROOTS = path.dirname(fixture.rootDir);
    process.env.LLM_WIKI_PROJECT_ACCESS_MODE = "read-only";

    const { GET: listProjects } = await import("../route");
    const listResponse = await listProjects();
    const listPayload = (await listResponse.json()) as {
      projects: Array<{ id: string }>;
    };

    const projectId = listPayload.projects[0]?.id;

    expect(projectId).toBeTruthy();

    const { GET } = await import("../[projectId]/route");
    const response = await GET(
      new Request(`http://localhost/api/projects/${projectId}`),
      {
        params: Promise.resolve({ projectId: projectId! }),
      },
    );
    const payload = (await response.json()) as {
      access: {
        mode: "read-only";
        canRead: true;
        canWrite: false;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.access).toEqual({
      mode: "read-only",
      canRead: true,
      canWrite: false,
    });
  });

  it("GET /api/projects/[projectId]/tree returns the project tree", async () => {
    const fixture = await createFixtureProject("tree-project");
    cleanupTasks.push(fixture.cleanup);

    process.env.LLM_WIKI_PROJECT_ROOTS = path.dirname(fixture.rootDir);

    const { GET: listProjects } = await import("../route");
    const listResponse = await listProjects();
    const listPayload = (await listResponse.json()) as {
      projects: Array<{ id: string }>;
    };

    const projectId = listPayload.projects[0]?.id;

    expect(projectId).toBeTruthy();

    const { GET, runtime } = await import("../[projectId]/tree/route");
    const response = await GET(
      new Request(`http://localhost/api/projects/${projectId}/tree`),
      {
        params: Promise.resolve({ projectId: projectId! }),
      },
    );
    const payload = (await response.json()) as Array<{ relativePath: string }>;

    expect(runtime).toBe("nodejs");
    expect(response.status).toBe(200);
    expect(payload.map((node) => node.relativePath)).toEqual(["raw", "wiki", "purpose.md", "schema.md"]);
  });

  it("GET /api/projects returns a 500 infrastructure error when snapshot persistence fails", async () => {
    const fixture = await createFixtureProject("db-error-project");
    cleanupTasks.push(fixture.cleanup);

    process.env.LLM_WIKI_PROJECT_ROOTS = path.dirname(fixture.rootDir);
    repoMocks.upsertProjectSnapshot.mockImplementationOnce(async () => {
      throw new Error("database unavailable");
    });

    const { GET } = await import("../route");
    const response = await GET();
    const payload = (await response.json()) as {
      error: {
        code: string;
        message: string;
      };
    };

    expect(response.status).toBe(500);
    expect(payload.error.code).toBe("INTERNAL_ERROR");
    expect(payload.error.message).toBeTruthy();
  });
});
