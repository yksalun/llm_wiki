import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type {
  LawDatabaseSyncFailure,
  LawDatabaseSyncResponse,
  LawDatabaseSyncSummary,
} from "@/lib/types";

import type { LawSourceRecord } from "./law-db/repo";
import { normalizeRelativePath, resolvePathInsideRoot } from "./path-safety";

const SYNC_DIR = "raw/sources/database/law";
const STATE_FILE = `${SYNC_DIR}/.sync-state.json`;
const MAX_BASE_NAME_LENGTH = 120;

interface LawSyncState {
  version: 1;
  records: Record<string, LawSyncStateRecord>;
}

interface LawSyncStateRecord {
  title: string | null;
  filePath: string;
  contentHash: string;
  lawTime: string | null;
  insertTime: string | null;
  syncedAt: string;
}

export async function syncLawSources(
  projectRoot: string,
  records: LawSourceRecord[],
  now: () => Date = () => new Date(),
): Promise<LawDatabaseSyncResponse> {
  const state = await readSyncState(projectRoot);
  const nextState: LawSyncState = { version: 1, records: { ...state.records } };
  const usedPaths = new Map<string, string>();
  const summary: LawDatabaseSyncSummary = {
    read: records.length,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
  };
  const changedFiles: string[] = [];
  const failures: LawDatabaseSyncFailure[] = [];
  const sortedRecords = [...records].sort(
    (left, right) =>
      (left.title ?? "").localeCompare(right.title ?? "") ||
      left.myId.localeCompare(right.myId),
  );

  for (const [myId, existing] of Object.entries(state.records)) {
    usedPaths.set(existing.filePath, myId);
  }

  await fs.mkdir(resolvePathInsideRoot(projectRoot, SYNC_DIR), { recursive: true });

  for (const record of sortedRecords) {
    try {
      const contentHash = hashLawRecord(record);
      const previous = state.records[record.myId];
      const filePath = allocateLawFilePath(record, previous, usedPaths);
      const absolutePath = resolvePathInsideRoot(projectRoot, filePath);
      const fileExists = await exists(absolutePath);

      if (previous?.contentHash === contentHash && previous.filePath === filePath && fileExists) {
        summary.skipped += 1;
        nextState.records[record.myId] = previous;
        continue;
      }

      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, buildLawMarkdown(record, contentHash), "utf8");

      if (previous?.filePath && previous.filePath !== filePath) {
        await fs
          .rm(resolvePathInsideRoot(projectRoot, previous.filePath), { force: true })
          .catch(() => undefined);
      }

      nextState.records[record.myId] = {
        title: record.title,
        filePath,
        contentHash,
        lawTime: record.lawTime,
        insertTime: record.insertTime,
        syncedAt: now().toISOString(),
      };

      if (previous) {
        summary.updated += 1;
      } else {
        summary.created += 1;
      }

      changedFiles.push(filePath);
    } catch (error) {
      summary.failed += 1;
      failures.push({
        myId: record.myId || null,
        title: record.title,
        message: error instanceof Error ? error.message : "写入法规资料源失败。",
      });
    }
  }

  await writeSyncState(projectRoot, nextState);

  return { ok: true, summary, changedFiles, failures };
}

export function sanitizeLawFileBaseName(title: string): string {
  return title
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .replace(/^\.+$/, "")
    .replace(/^[.\s-]+|[.\s-]+$/g, "")
    .slice(0, MAX_BASE_NAME_LENGTH);
}

export function buildLawMarkdown(record: LawSourceRecord, contentHash: string): string {
  const title = record.title?.trim() || `law-${record.myId.slice(0, 8)}`;
  const frontmatter = [
    "---",
    'sourceType: "mysql-law"',
    `myId: ${JSON.stringify(record.myId)}`,
    `title: ${JSON.stringify(title)}`,
    `url: ${JSON.stringify(record.url ?? "")}`,
    `lawTime: ${JSON.stringify(record.lawTime ?? "")}`,
    `insertTime: ${JSON.stringify(record.insertTime ?? "")}`,
    `type: ${JSON.stringify(record.type ?? "")}`,
    `contentHash: ${JSON.stringify(contentHash)}`,
    "---",
  ].join("\n");

  return `${frontmatter}\n\n# ${title}\n\n${record.content.trim()}\n`;
}

export function hashLawRecord(record: LawSourceRecord): string {
  const value = JSON.stringify({
    myId: record.myId,
    title: record.title,
    content: record.content,
    url: record.url,
    lawTime: record.lawTime,
    insertTime: record.insertTime,
    type: record.type,
  });

  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function allocateLawFilePath(
  record: LawSourceRecord,
  previous: LawSyncStateRecord | undefined,
  usedPaths: Map<string, string>,
): string {
  const base = sanitizeLawFileBaseName(record.title ?? "") || `law-${record.myId.slice(0, 8)}`;
  const primary = normalizeRelativePath(`${SYNC_DIR}/${base}.md`);
  const previousTitleMatches = previous?.title === record.title;

  if (previous && previousTitleMatches) {
    usedPaths.set(previous.filePath, record.myId);
    return previous.filePath;
  }

  const currentOwner = usedPaths.get(primary);
  if (!currentOwner || currentOwner === record.myId) {
    usedPaths.set(primary, record.myId);
    return primary;
  }

  const fallback = normalizeRelativePath(`${SYNC_DIR}/${base}-${record.myId.slice(0, 8)}.md`);
  usedPaths.set(fallback, record.myId);
  return fallback;
}

async function readSyncState(projectRoot: string): Promise<LawSyncState> {
  const statePath = resolvePathInsideRoot(projectRoot, STATE_FILE);

  try {
    const raw = await fs.readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<LawSyncState>;

    if (parsed.version !== 1 || !parsed.records || typeof parsed.records !== "object") {
      throw new Error("Invalid sync state");
    }

    return { version: 1, records: parsed.records as Record<string, LawSyncStateRecord> };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { version: 1, records: {} };
    }

    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.rename(statePath, `${statePath}.corrupt-${Date.now()}`).catch(() => undefined);
    return { version: 1, records: {} };
  }
}

async function writeSyncState(projectRoot: string, state: LawSyncState): Promise<void> {
  const statePath = resolvePathInsideRoot(projectRoot, STATE_FILE);
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
