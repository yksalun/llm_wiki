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

describe("/api/projects/[projectId]/file route", () => {
  it("GET reads purpose.md from the resolved project", async () => {
    const { projectId } = await createProjectContext("read-purpose");

    const { GET, runtime } = await import("../route");
    const response = await GET(
      new Request(`http://localhost/api/projects/${projectId}/file?path=purpose.md`),
      {
        params: Promise.resolve({ projectId }),
      },
    );
    const payload = (await response.json()) as {
      relativePath: string;
      content: string | null;
      mode: string;
      editable: boolean;
    };

    expect(runtime).toBe("nodejs");
    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      relativePath: "purpose.md",
      content: "# Purpose\n\nDemo project.\n",
      mode: "editable",
      editable: true,
    });
  });

  it("PUT writes an allowed file back through the service layer", async () => {
    const { projectId } = await createProjectContext("write-purpose");

    const { GET, PUT, runtime } = await import("../route");
    const readResponse = await GET(
      new Request(`http://localhost/api/projects/${projectId}/file?path=purpose.md`),
      {
        params: Promise.resolve({ projectId }),
      },
    );
    const readPayload = (await readResponse.json()) as {
      lastModified: string | null;
    };

    const writeResponse = await PUT(
      new Request(`http://localhost/api/projects/${projectId}/file`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          relativePath: "purpose.md",
          content: "# Purpose\n\nUpdated via route.\n",
          lastModified: readPayload.lastModified,
        }),
      }),
      {
        params: Promise.resolve({ projectId }),
      },
    );
    const writePayload = (await writeResponse.json()) as {
      relativePath: string;
      lastModified: string;
    };
    const verifyResponse = await GET(
      new Request(`http://localhost/api/projects/${projectId}/file?path=purpose.md`),
      {
        params: Promise.resolve({ projectId }),
      },
    );
    const verifyPayload = (await verifyResponse.json()) as {
      content: string | null;
    };

    expect(runtime).toBe("nodejs");
    expect(writeResponse.status).toBe(200);
    expect(writePayload.relativePath).toBe("purpose.md");
    expect(writePayload.lastModified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(verifyPayload.content).toBe("# Purpose\n\nUpdated via route.\n");
  });

  it("PUT returns 400 when the request body shape is invalid", async () => {
    const { projectId } = await createProjectContext("write-invalid-body");

    const { PUT } = await import("../route");
    const response = await PUT(
      new Request(`http://localhost/api/projects/${projectId}/file`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          relativePath: 123,
          content: "# Purpose\n\nBroken body.\n",
          lastModified: null,
        }),
      }),
      {
        params: Promise.resolve({ projectId }),
      },
    );
    const payload = (await response.json()) as {
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("INVALID_REQUEST_BODY");
  });
});
