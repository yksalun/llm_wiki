import { desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";

import type { ProjectSummary } from "@/lib/types";

import { db } from "./client";
import { projectSnapshots, projectSyncRuns } from "./schema";
import * as schema from "./schema";

export type ProjectSnapshotRecord = InferSelectModel<typeof projectSnapshots>;
export type ProjectSnapshotInsert = InferInsertModel<typeof projectSnapshots>;
export type ProjectSyncRunInsert = InferInsertModel<typeof projectSyncRuns>;
export type ProjectSnapshotDatabase = NodePgDatabase<typeof schema>;

export function mapProjectSnapshotToSummary(row: ProjectSnapshotRecord): ProjectSummary {
  return {
    id: row.projectId,
    name: row.name,
    status: row.status,
    hasPurpose: row.hasPurpose,
    hasSchema: row.hasSchema,
    hasWikiDirectory: row.hasWikiDirectory,
    hasRawSourcesDirectory: row.hasRawSourcesDirectory,
    updatedAt: row.lastKnownUpdatedAt?.toISOString() ?? null,
  };
}

export function createProjectSnapshotRepo(database: ProjectSnapshotDatabase = db) {
  return {
    async upsertProjectSnapshot(snapshot: ProjectSnapshotInsert) {
      await database
        .insert(projectSnapshots)
        .values(snapshot)
        .onConflictDoUpdate({
          target: projectSnapshots.projectId,
          set: {
            rootPath: snapshot.rootPath,
            name: snapshot.name,
            status: snapshot.status,
            hasPurpose: snapshot.hasPurpose,
            hasSchema: snapshot.hasSchema,
            hasWikiDirectory: snapshot.hasWikiDirectory,
            hasRawSourcesDirectory: snapshot.hasRawSourcesDirectory,
            lastKnownUpdatedAt: snapshot.lastKnownUpdatedAt,
            lastScannedAt: snapshot.lastScannedAt,
          },
        });
    },

    async insertSyncRun(input: ProjectSyncRunInsert) {
      await database.insert(projectSyncRuns).values(input);
    },

    async findProjectSummaryById(projectId: string): Promise<ProjectSummary | null> {
      const row = await database.query.projectSnapshots.findFirst({
        where: eq(projectSnapshots.projectId, projectId),
      });

      return row ? mapProjectSnapshotToSummary(row) : null;
    },

    async listProjectSnapshots(): Promise<ProjectSummary[]> {
      const rows = await database.query.projectSnapshots.findMany({
        orderBy: [desc(projectSnapshots.lastScannedAt)],
      });

      return rows.map(mapProjectSnapshotToSummary);
    },
  };
}

const projectSnapshotRepo = createProjectSnapshotRepo();

export const upsertProjectSnapshot = projectSnapshotRepo.upsertProjectSnapshot;
export const insertSyncRun = projectSnapshotRepo.insertSyncRun;
export const findProjectSummaryById = projectSnapshotRepo.findProjectSummaryById;
export const listProjectSnapshots = projectSnapshotRepo.listProjectSnapshots;
