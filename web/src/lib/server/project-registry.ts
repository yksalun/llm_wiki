import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import type { ProjectDetail, ProjectsListResponse, ProjectSummary } from "@/lib/types";
import type {
  ProjectSnapshotRecord,
  ProjectSnapshotInsert,
  ProjectSyncRunInsert,
} from "@/lib/db/project-snapshot-repo";
import {
  findProjectSnapshotById,
  findProjectSnapshotByRootPath,
  insertSyncRun,
  upsertProjectSnapshot,
} from "@/lib/db/project-snapshot-repo";

import { AppError } from "./app-error";
import { ensureProjectRegistry, readProjectRegistry } from "./project-id";

export interface ResolvedProject extends ProjectDetail {
  rootDir: string;
}

export interface ProjectRegistryRepo {
  upsertProjectSnapshot: (snapshot: ProjectSnapshotInsert) => Promise<void>;
  insertSyncRun: (input: ProjectSyncRunInsert) => Promise<void>;
  findProjectSnapshotById: (projectId: string) => Promise<ProjectSnapshotRecord | null>;
  findProjectSnapshotByRootPath: (rootPath: string) => Promise<ProjectSnapshotRecord | null>;
}

interface ProjectScanResult {
  summary: ProjectSummary;
  rootDir: string;
}

interface ProjectRegistryOptions {
  now?: () => Date;
  repo?: ProjectRegistryRepo;
}

const PROJECT_SECTIONS: ProjectDetail["sections"] = [
  "Overview",
  "Ask",
  "Insights",
  "Files",
  "Purpose",
  "Schema",
  "Project Info",
];

const defaultRepo: ProjectRegistryRepo = {
  upsertProjectSnapshot,
  insertSyncRun,
  findProjectSnapshotById,
  findProjectSnapshotByRootPath,
};

function getProjectStatus(input: {
  hasPurpose: boolean;
  hasSchema: boolean;
  hasWikiDirectory: boolean;
  hasRawSourcesDirectory: boolean;
}): ProjectSummary["status"] {
  return input.hasPurpose && input.hasSchema ? "ready" : "incomplete";
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(targetPath);
    return stats.isFile();
  } catch {
    return false;
  }
}

async function directoryExists(targetPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(targetPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

async function inspectProjectDirectory(
  rootDir: string,
  now: Date,
  preferredProjectId?: string,
  preferredProjectName?: string,
): Promise<ProjectScanResult | null> {
  const state = await readProjectState(rootDir);
  const { hasPurpose, hasSchema, hasWikiDirectory, hasRawSourcesDirectory } = state;

  if (!hasSchema || !hasWikiDirectory) {
    return null;
  }

  const registry = await ensureProjectRegistry(rootDir, {
    now: () => now,
    preferredId: preferredProjectId,
    preferredName: preferredProjectName,
  });
  const updatedAt = new Date(registry.updatedAt);
  const summary: ProjectSummary = {
    id: registry.id,
    name: registry.name,
    status: getProjectStatus({
      hasPurpose,
      hasSchema,
      hasWikiDirectory,
      hasRawSourcesDirectory,
    }),
    hasPurpose,
    hasSchema,
    hasWikiDirectory,
    hasRawSourcesDirectory,
    updatedAt: Number.isNaN(updatedAt.valueOf()) ? null : updatedAt.toISOString(),
  };
  return {
    summary,
    rootDir,
  };
}

async function readProjectDirectoryWithoutSideEffects(rootDir: string): Promise<ProjectScanResult | null> {
  const state = await readProjectState(rootDir);
  const { hasPurpose, hasSchema, hasWikiDirectory, hasRawSourcesDirectory } = state;

  if (!hasSchema || !hasWikiDirectory) {
    return null;
  }

  const registry = await readProjectRegistry(rootDir);

  if (!registry) {
    return null;
  }

  const updatedAt = new Date(registry.updatedAt);

  return {
    summary: {
      id: registry.id,
      name: registry.name,
      status: getProjectStatus({
        hasPurpose,
        hasSchema,
        hasWikiDirectory,
        hasRawSourcesDirectory,
      }),
      hasPurpose,
      hasSchema,
      hasWikiDirectory,
      hasRawSourcesDirectory,
      updatedAt: Number.isNaN(updatedAt.valueOf()) ? null : updatedAt.toISOString(),
    },
    rootDir,
  };
}

async function scanSingleRoot(
  rootDir: string,
  now: Date,
  repo: ProjectRegistryRepo,
): Promise<{ projects: ProjectScanResult[]; warnings: string[] }> {
  const startedAt = now;
  let entries: Dirent[];

  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch (error) {
    const warning =
      error instanceof Error
        ? `Failed to scan project root ${rootDir}: ${error.message}`
        : `Failed to scan project root ${rootDir}`;

    await repo.insertSyncRun({
      rootPath: rootDir,
      status: "warning",
      warningMessage: warning,
      startedAt,
      finishedAt: now,
    });

    return {
      projects: [],
      warnings: [warning],
    };
  }

  const projects: ProjectScanResult[] = [];
  const warnings: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const projectRootDir = path.join(rootDir, entry.name);
    const knownSnapshot = await repo.findProjectSnapshotByRootPath(projectRootDir);
    let project: ProjectScanResult | null = null;

    try {
      project = await inspectProjectDirectory(
        projectRootDir,
        now,
        knownSnapshot?.projectId,
        knownSnapshot?.name,
      );
    } catch (error) {
      warnings.push(
        error instanceof Error
          ? `Failed to inspect project directory ${projectRootDir}: ${error.message}`
          : `Failed to inspect project directory ${projectRootDir}`,
      );
      continue;
    }

    if (!project) {
      continue;
    }

    projects.push(project);

    await repo.upsertProjectSnapshot({
      projectId: project.summary.id,
      rootPath: project.rootDir,
      name: project.summary.name,
      status: project.summary.status,
      hasPurpose: project.summary.hasPurpose,
      hasSchema: project.summary.hasSchema,
      hasWikiDirectory: project.summary.hasWikiDirectory,
      hasRawSourcesDirectory: project.summary.hasRawSourcesDirectory,
      lastKnownUpdatedAt: project.summary.updatedAt ? new Date(project.summary.updatedAt) : null,
      lastScannedAt: now,
    });
  }

  await repo.insertSyncRun({
    rootPath: rootDir,
    status: warnings.length > 0 ? "warning" : "success",
    warningMessage: warnings.length > 0 ? warnings.join("\n") : null,
    startedAt,
    finishedAt: now,
  });

  return { projects, warnings };
}

async function listProjectsFromRoots(
  roots: string[],
  options: ProjectRegistryOptions = {},
): Promise<ProjectScanResult[]> {
  const now = (options.now ?? (() => new Date()))();
  const projects: ProjectScanResult[] = [];
  const repo =
    options.repo ??
    ({
      async upsertProjectSnapshot() {},
      async insertSyncRun() {},
      async findProjectSnapshotById() {
        return null;
      },
      async findProjectSnapshotByRootPath() {
        return null;
      },
    } satisfies ProjectRegistryRepo);

  for (const rootDir of roots) {
    let entries: Dirent[];

    try {
      entries = await fs.readdir(rootDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      let project: ProjectScanResult | null = null;

      try {
        project = await readProjectDirectoryWithoutSideEffects(path.join(rootDir, entry.name));
      } catch {
        continue;
      }

      if (project) {
        projects.push(project);
      }
    }
  }

  return projects;
}

export async function scanProjectRoots(
  roots: string[],
  options: ProjectRegistryOptions = {},
): Promise<ProjectsListResponse> {
  const now = (options.now ?? (() => new Date()))();
  const repo = options.repo ?? defaultRepo;
  const projects: ProjectSummary[] = [];
  const warnings: string[] = [];

  for (const rootDir of roots) {
    const result = await scanSingleRoot(rootDir, now, repo);
    projects.push(...result.projects.map((project) => project.summary));
    warnings.push(...result.warnings);
  }

  return {
    projects,
    warnings,
  };
}

export async function resolveProjectById(
  roots: string[],
  projectId: string,
  options: { repo?: ProjectRegistryRepo } = {},
): Promise<ResolvedProject> {
  const repo = options.repo ?? defaultRepo;
  const projects = await listProjectsFromRoots(roots, { repo });
  const resolved = projects.find((project) => project.summary.id === projectId);

  if (resolved) {
    return toResolvedProject(resolved);
  }

  const snapshot = await repo.findProjectSnapshotById(projectId);

  if (snapshot && isPathInsideRoots(snapshot.rootPath, roots)) {
    const fallback = await resolveKnownProjectRoot(snapshot);

    if (fallback) {
      return toResolvedProject(fallback);
    }
  }

  throw new AppError("PROJECT_NOT_FOUND", 404, "Project not found");
}

async function readProjectState(rootDir: string): Promise<{
  hasPurpose: boolean;
  hasSchema: boolean;
  hasWikiDirectory: boolean;
  hasRawSourcesDirectory: boolean;
}> {
  return {
    hasPurpose: await fileExists(path.join(rootDir, "purpose.md")),
    hasSchema: await fileExists(path.join(rootDir, "schema.md")),
    hasWikiDirectory: await directoryExists(path.join(rootDir, "wiki")),
    hasRawSourcesDirectory: await directoryExists(path.join(rootDir, "raw", "sources")),
  };
}

async function resolveKnownProjectRoot(snapshot: ProjectSnapshotRecord): Promise<ProjectScanResult | null> {
  if (!(await directoryExists(snapshot.rootPath))) {
    return null;
  }

  const state = await readProjectState(snapshot.rootPath);

  if (!state.hasWikiDirectory) {
    return null;
  }

  const registry = await ensureProjectRegistry(snapshot.rootPath, {
    preferredId: snapshot.projectId,
    preferredName: snapshot.name,
  });
  const updatedAt = new Date(registry.updatedAt);

  return {
    summary: {
      id: registry.id,
      name: registry.name,
      status: getProjectStatus(state),
      hasPurpose: state.hasPurpose,
      hasSchema: state.hasSchema,
      hasWikiDirectory: state.hasWikiDirectory,
      hasRawSourcesDirectory: state.hasRawSourcesDirectory,
      updatedAt: Number.isNaN(updatedAt.valueOf()) ? null : updatedAt.toISOString(),
    },
    rootDir: snapshot.rootPath,
  };
}

function isPathInsideRoots(targetPath: string, roots: string[]): boolean {
  const resolvedTargetPath = path.resolve(targetPath);

  return roots.some((rootDir) => {
    const resolvedRootDir = path.resolve(rootDir);
    const relativePath = path.relative(resolvedRootDir, resolvedTargetPath);

    return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
  });
}

function toResolvedProject(project: ProjectScanResult): ResolvedProject {
  return {
    ...project.summary,
    sections: PROJECT_SECTIONS,
    rootPathHint: project.rootDir,
    access: {
      mode: "read-write",
      canRead: true,
      canWrite: true,
    },
    rootDir: project.rootDir,
  };
}
