import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import type { ProjectDetail, ProjectsListResponse, ProjectSummary } from "@/lib/types";
import type {
  ProjectSnapshotInsert,
  ProjectSyncRunInsert,
} from "@/lib/db/project-snapshot-repo";
import {
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
  "Files",
  "Purpose",
  "Schema",
  "Project Info",
];

const defaultRepo: ProjectRegistryRepo = {
  upsertProjectSnapshot,
  insertSyncRun,
};

function getProjectStatus(input: {
  hasPurpose: boolean;
  hasSchema: boolean;
  hasWikiDirectory: boolean;
  hasRawSourcesDirectory: boolean;
}): ProjectSummary["status"] {
  return input.hasPurpose ? "ready" : "incomplete";
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
  repo: ProjectRegistryRepo,
): Promise<ProjectScanResult | null> {
  const hasPurpose = await fileExists(path.join(rootDir, "purpose.md"));
  const hasSchema = await fileExists(path.join(rootDir, "schema.md"));
  const hasWikiDirectory = await directoryExists(path.join(rootDir, "wiki"));
  const hasRawSourcesDirectory = await directoryExists(path.join(rootDir, "raw", "sources"));

  if (!hasSchema || !hasWikiDirectory) {
    return null;
  }

  const registry = await ensureProjectRegistry(rootDir, { now: () => now });
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

  await repo.upsertProjectSnapshot({
    projectId: registry.id,
    rootPath: rootDir,
    name: registry.name,
    status: summary.status,
    hasPurpose,
    hasSchema,
    hasWikiDirectory,
    hasRawSourcesDirectory,
    lastKnownUpdatedAt: summary.updatedAt ? new Date(summary.updatedAt) : null,
    lastScannedAt: now,
  });

  return {
    summary,
    rootDir,
  };
}

async function readProjectDirectoryWithoutSideEffects(rootDir: string): Promise<ProjectScanResult | null> {
  const hasPurpose = await fileExists(path.join(rootDir, "purpose.md"));
  const hasSchema = await fileExists(path.join(rootDir, "schema.md"));
  const hasWikiDirectory = await directoryExists(path.join(rootDir, "wiki"));
  const hasRawSourcesDirectory = await directoryExists(path.join(rootDir, "raw", "sources"));

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

  try {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    const projects: ProjectScanResult[] = [];
    const warnings: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      try {
        const project = await inspectProjectDirectory(path.join(rootDir, entry.name), now, repo);

        if (project) {
          projects.push(project);
        }
      } catch (error) {
        warnings.push(
          error instanceof Error
            ? `Failed to inspect project directory ${path.join(rootDir, entry.name)}: ${error.message}`
            : `Failed to inspect project directory ${path.join(rootDir, entry.name)}`,
        );
      }
    }

    await repo.insertSyncRun({
      rootPath: rootDir,
      status: warnings.length > 0 ? "warning" : "success",
      warningMessage: warnings.length > 0 ? warnings.join("\n") : null,
      startedAt,
      finishedAt: now,
    });

    return { projects, warnings };
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
): Promise<ResolvedProject> {
  const projects = await listProjectsFromRoots(roots);
  const resolved = projects.find((project) => project.summary.id === projectId);

  if (!resolved) {
    throw new AppError("PROJECT_NOT_FOUND", 404, "Project not found");
  }

  return {
    ...resolved.summary,
    sections: PROJECT_SECTIONS,
    rootPathHint: resolved.rootDir,
    rootDir: resolved.rootDir,
  };
}
