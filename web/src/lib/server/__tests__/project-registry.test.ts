import fs from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ProjectDetail } from "@/lib/types";
import type {
  ProjectSnapshotInsert,
  ProjectSyncRunInsert,
} from "@/lib/db/project-snapshot-repo";
import { createFixtureProject } from "@/test-utils/project-fixture";

import { AppError } from "../app-error";
import { getDatabaseUrlFromEnv, getProjectRootsFromEnv } from "../env";
import { resolveProjectById, scanProjectRoots } from "../project-registry";

interface MockRepoCallState {
  snapshots: ProjectSnapshotInsert[];
  syncRuns: ProjectSyncRunInsert[];
}

function createMockRepo(): {
  calls: MockRepoCallState;
  repo: {
    upsertProjectSnapshot: (snapshot: ProjectSnapshotInsert) => Promise<void>;
    insertSyncRun: (input: ProjectSyncRunInsert) => Promise<void>;
  };
} {
  const calls: MockRepoCallState = {
    snapshots: [],
    syncRuns: [],
  };

  return {
    calls,
    repo: {
      async upsertProjectSnapshot(snapshot) {
        calls.snapshots.push(snapshot);
      },
      async insertSyncRun(input) {
        calls.syncRuns.push(input);
      },
    },
  };
}

const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanupTasks.length > 0) {
    const cleanup = cleanupTasks.pop();

    if (cleanup) {
      await cleanup();
    }
  }
});

describe("env helpers", () => {
  it("reads roots and database url from environment", () => {
    expect(
      getProjectRootsFromEnv({
        LLM_WIKI_PROJECT_ROOTS: "/srv/llm-wiki-projects,/data/wiki-labs",
      }),
    ).toEqual(["/srv/llm-wiki-projects", "/data/wiki-labs"]);

    expect(
      getDatabaseUrlFromEnv({
        DATABASE_URL: "postgres://postgres:postgres@localhost:5432/llm_wiki",
      }),
    ).toBe("postgres://postgres:postgres@localhost:5432/llm_wiki");
  });

  it("throws AppError when required environment variables are missing", () => {
    expect(() => getProjectRootsFromEnv({})).toThrow(
      expect.objectContaining({
        publicMessage: "服务器还没有配置项目根目录白名单。",
      }),
    );
    expect(() => getDatabaseUrlFromEnv({})).toThrow(
      expect.objectContaining({
        publicMessage: "服务器还没有配置数据库连接。",
      }),
    );
  });
});

describe("scanProjectRoots", () => {
  it("lists only valid first-level projects, creates project ids, and syncs snapshots", async () => {
    const fixture = await createFixtureProject("alpha");
    cleanupTasks.push(fixture.cleanup);

    const rootDir = path.dirname(fixture.rootDir);
    const ignoredDir = path.join(rootDir, "notes");
    const nestedContainer = path.join(rootDir, "nested");
    const nestedProject = path.join(nestedContainer, "deep-project");

    await fs.mkdir(ignoredDir, { recursive: true });
    await fs.writeFile(path.join(ignoredDir, "schema.md"), "# Schema\n", "utf8");

    await fs.mkdir(path.join(nestedProject, "wiki"), { recursive: true });
    await fs.writeFile(path.join(nestedProject, "schema.md"), "# Schema\n", "utf8");

    const mockRepo = createMockRepo();
    const now = new Date("2026-04-24T12:00:00.000Z");

    const result = await scanProjectRoots([rootDir], {
      now: () => now,
      repo: mockRepo.repo,
    });

    expect(result.warnings).toEqual([]);
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]).toMatchObject({
      name: "alpha",
      status: "ready",
      hasPurpose: true,
      hasSchema: true,
      hasWikiDirectory: true,
      hasRawSourcesDirectory: true,
      updatedAt: now.toISOString(),
    });

    const registryPath = path.join(fixture.rootDir, ".llm-wiki", "project.json");
    const registry = JSON.parse(await fs.readFile(registryPath, "utf8")) as {
      id: string;
      name: string;
      createdAt: string;
      updatedAt: string;
    };

    expect(registry.id).toBe(result.projects[0].id);
    expect(registry.name).toBe("alpha");
    expect(registry.createdAt).toBe(now.toISOString());
    expect(registry.updatedAt).toBe(now.toISOString());

    expect(mockRepo.calls.snapshots).toHaveLength(1);
    expect(mockRepo.calls.snapshots[0]).toMatchObject({
      projectId: registry.id,
      rootPath: fixture.rootDir,
      name: "alpha",
      status: "ready",
    });
    expect(mockRepo.calls.syncRuns).toHaveLength(1);
    expect(mockRepo.calls.syncRuns[0]?.status).toBe("success");
  });

  it("rebuilds a corrupted project registry file during scan", async () => {
    const fixture = await createFixtureProject("broken-project");
    cleanupTasks.push(fixture.cleanup);

    const registryDir = path.join(fixture.rootDir, ".llm-wiki");
    await fs.mkdir(registryDir, { recursive: true });
    await fs.writeFile(path.join(registryDir, "project.json"), "{not-json", "utf8");

    const result = await scanProjectRoots([path.dirname(fixture.rootDir)], {
      now: () => new Date("2026-04-24T12:30:00.000Z"),
      repo: createMockRepo().repo,
    });

    const registry = JSON.parse(
      await fs.readFile(path.join(registryDir, "project.json"), "utf8"),
    ) as {
      id: string;
      name: string;
      createdAt: string;
      updatedAt: string;
    };

    expect(result.projects[0]?.id).toBe(registry.id);
    expect(registry.name).toBe("broken-project");
    expect(registry.createdAt).toBe("2026-04-24T12:30:00.000Z");
    expect(registry.updatedAt).toBe("2026-04-24T12:30:00.000Z");
  });

  it("rebuilds a registry when timestamp fields are invalid strings", async () => {
    const fixture = await createFixtureProject("invalid-timestamps");
    cleanupTasks.push(fixture.cleanup);

    const registryDir = path.join(fixture.rootDir, ".llm-wiki");
    await fs.mkdir(registryDir, { recursive: true });
    await fs.writeFile(
      path.join(registryDir, "project.json"),
      `${JSON.stringify(
        {
          id: "broken-project-id",
          name: "invalid-timestamps",
          createdAt: "not-a-timestamp",
          updatedAt: "still-not-a-timestamp",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const now = new Date("2026-04-24T12:35:00.000Z");
    const result = await scanProjectRoots([path.dirname(fixture.rootDir)], {
      now: () => now,
      repo: createMockRepo().repo,
    });

    const registry = JSON.parse(
      await fs.readFile(path.join(registryDir, "project.json"), "utf8"),
    ) as {
      id: string;
      name: string;
      createdAt: string;
      updatedAt: string;
    };

    expect(registry.id).not.toBe("broken-project-id");
    expect(registry.createdAt).toBe(now.toISOString());
    expect(registry.updatedAt).toBe(now.toISOString());
    expect(result.projects[0]?.id).toBe(registry.id);
  });

  it("reuses an existing project id even when the project directory name changes", async () => {
    const fixture = await createFixtureProject("stable-id");
    cleanupTasks.push(fixture.cleanup);

    const originalRootDir = fixture.rootDir;
    const renamedRootDir = path.join(path.dirname(originalRootDir), "renamed-project");
    const originalRegistryDir = path.join(originalRootDir, ".llm-wiki");
    const originalRegistry = {
      id: "project-stable-123",
      name: "stable-id",
      createdAt: "2026-04-24T12:45:00.000Z",
      updatedAt: "2026-04-24T12:45:00.000Z",
    };

    await fs.mkdir(originalRegistryDir, { recursive: true });
    await fs.writeFile(
      path.join(originalRegistryDir, "project.json"),
      `${JSON.stringify(originalRegistry, null, 2)}\n`,
      "utf8",
    );
    await fs.rename(originalRootDir, renamedRootDir);

    const result = await scanProjectRoots([path.dirname(renamedRootDir)], {
      now: () => new Date("2026-04-24T12:50:00.000Z"),
      repo: createMockRepo().repo,
    });

    const registry = JSON.parse(
      await fs.readFile(path.join(renamedRootDir, ".llm-wiki", "project.json"), "utf8"),
    ) as {
      id: string;
      name: string;
      createdAt: string;
      updatedAt: string;
    };

    expect(result.projects[0]?.id).toBe("project-stable-123");
    expect(registry).toEqual(originalRegistry);
  });

  it("returns warnings for missing roots without blocking other roots", async () => {
    const fixture = await createFixtureProject("survives");
    cleanupTasks.push(fixture.cleanup);

    const missingRoot = path.join(path.dirname(fixture.rootDir), "missing-root");
    const mockRepo = createMockRepo();

    const result = await scanProjectRoots([missingRoot, path.dirname(fixture.rootDir)], {
      now: () => new Date("2026-04-24T13:00:00.000Z"),
      repo: mockRepo.repo,
    });

    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]?.name).toBe("survives");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(missingRoot);
    expect(mockRepo.calls.syncRuns).toHaveLength(2);
    expect(mockRepo.calls.syncRuns.map((run) => run.status)).toEqual(["warning", "success"]);
  });

  it("marks a project as ready when purpose exists even if raw sources are missing", async () => {
    const fixture = await createFixtureProject("no-raw-sources");
    cleanupTasks.push(fixture.cleanup);

    await fs.rm(path.join(fixture.rootDir, "raw"), { recursive: true, force: true });

    const result = await scanProjectRoots([path.dirname(fixture.rootDir)], {
      now: () => new Date("2026-04-24T13:30:00.000Z"),
      repo: createMockRepo().repo,
    });

    expect(result.projects[0]).toMatchObject({
      name: "no-raw-sources",
      status: "ready",
      hasPurpose: true,
      hasRawSourcesDirectory: false,
    });
  });
});

describe("resolveProjectById", () => {
  it("resolves a project id back to its project detail and root directory", async () => {
    const fixture = await createFixtureProject("detail-project");
    cleanupTasks.push(fixture.cleanup);

    const scanned = await scanProjectRoots([path.dirname(fixture.rootDir)], {
      now: () => new Date("2026-04-24T14:00:00.000Z"),
      repo: createMockRepo().repo,
    });
    const projectId = scanned.projects[0]?.id;

    expect(projectId).toBeTruthy();

    const resolved = (await resolveProjectById([path.dirname(fixture.rootDir)], projectId!)) as
      ProjectDetail & { rootDir: string };

    expect(resolved).toMatchObject({
      id: projectId,
      name: "detail-project",
      status: "ready",
      hasPurpose: true,
      hasSchema: true,
      hasWikiDirectory: true,
      hasRawSourcesDirectory: true,
      rootDir: fixture.rootDir,
      rootPathHint: fixture.rootDir,
      sections: ["Overview", "Files", "Purpose", "Schema", "Project Info"],
    });
  });

  it("does not create registry files for unrelated projects while resolving by id", async () => {
    const targetFixture = await createFixtureProject("target-project");
    const unrelatedFixture = await createFixtureProject("unrelated-project");
    cleanupTasks.push(targetFixture.cleanup);
    cleanupTasks.push(unrelatedFixture.cleanup);

    const targetRegistryPath = path.join(targetFixture.rootDir, ".llm-wiki", "project.json");
    const unrelatedRegistryPath = path.join(unrelatedFixture.rootDir, ".llm-wiki", "project.json");
    const targetRegistry = {
      id: "target-project-id",
      name: "target-project",
      createdAt: "2026-04-24T14:05:00.000Z",
      updatedAt: "2026-04-24T14:05:00.000Z",
    };

    await fs.mkdir(path.dirname(targetRegistryPath), { recursive: true });
    await fs.writeFile(
      targetRegistryPath,
      `${JSON.stringify(targetRegistry, null, 2)}\n`,
      "utf8",
    );
    await fs.rm(unrelatedRegistryPath, { force: true });

    const resolved = await resolveProjectById(
      [path.dirname(targetFixture.rootDir), path.dirname(unrelatedFixture.rootDir)],
      "target-project-id",
    );

    expect(resolved.id).toBe("target-project-id");
    await expect(fs.access(unrelatedRegistryPath)).rejects.toBeTruthy();
  });

  it("throws a 404 AppError when the project id does not exist", async () => {
    const fixture = await createFixtureProject("missing-id");
    cleanupTasks.push(fixture.cleanup);

    await expect(
      resolveProjectById([path.dirname(fixture.rootDir)], "missing-project-id"),
    ).rejects.toMatchObject({
      code: "PROJECT_NOT_FOUND",
      status: 404,
    });
  });

  it("skips inaccessible roots and still returns a 404 when the project cannot be found", async () => {
    const fixture = await createFixtureProject("missing-after-skip");
    cleanupTasks.push(fixture.cleanup);

    const missingRoot = path.join(path.dirname(fixture.rootDir), "missing-root");

    await expect(
      resolveProjectById([missingRoot, path.dirname(fixture.rootDir)], "missing-project-id"),
    ).rejects.toMatchObject({
      code: "PROJECT_NOT_FOUND",
      status: 404,
    });
  });
});
