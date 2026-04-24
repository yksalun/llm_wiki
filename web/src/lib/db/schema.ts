import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import type { ProjectStatus } from "@/lib/types";

export type ProjectSyncRunStatus = "success" | "warning" | "failure";

export const projectSnapshots = pgTable("project_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: text("project_id").notNull().unique(),
  rootPath: text("root_path").notNull(),
  name: text("name").notNull(),
  status: text("status").$type<ProjectStatus>().notNull(),
  hasPurpose: boolean("has_purpose").notNull(),
  hasSchema: boolean("has_schema").notNull(),
  hasWikiDirectory: boolean("has_wiki_directory").notNull(),
  hasRawSourcesDirectory: boolean("has_raw_sources_directory").notNull(),
  lastKnownUpdatedAt: timestamp("last_known_updated_at", { withTimezone: true }),
  lastScannedAt: timestamp("last_scanned_at", { withTimezone: true }).notNull(),
});

export const projectSyncRuns = pgTable("project_sync_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  rootPath: text("root_path").notNull(),
  status: text("status").$type<ProjectSyncRunStatus>().notNull(),
  warningMessage: text("warning_message"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
});
