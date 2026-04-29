import { and, isNotNull, ne } from "drizzle-orm";

import { AppError } from "../app-error";
import { getLawDb } from "./client";
import { lawTable } from "./schema";

export interface LawSourceRecord {
  myId: string;
  title: string | null;
  content: string;
  url: string | null;
  lawTime: string | null;
  insertTime: string | null;
  type: string | null;
}

export interface LawRow {
  myId: string | null;
  title: string | null;
  content: string | null;
  url: string | null;
  time: string | null;
  insertTime: Date | string | null;
  type: string | null;
}

interface LawDbLike {
  select: (fields: Record<string, unknown>) => {
    from: (table: unknown) => {
      where: (condition: unknown) => Promise<LawRow[]>;
    };
  };
}

export async function listLawSourceRecords(
  database: LawDbLike = getLawDb() as unknown as LawDbLike,
): Promise<LawSourceRecord[]> {
  try {
    const rows = await database
      .select({
        myId: lawTable.myId,
        title: lawTable.title,
        content: lawTable.content,
        url: lawTable.url,
        time: lawTable.time,
        insertTime: lawTable.insertTime,
        type: lawTable.type,
      })
      .from(lawTable)
      .where(and(isNotNull(lawTable.content), ne(lawTable.content, "")));

    return rows
      .map(mapLawRowToSourceRecord)
      .filter((record): record is LawSourceRecord => record !== null);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError("LAW_DB_QUERY_FAILED", 502, "读取法规数据库失败。", {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

export function mapLawRowToSourceRecord(row: LawRow): LawSourceRecord | null {
  const myId = row.myId?.trim();
  const content = row.content?.trim();

  if (!myId || !content) {
    return null;
  }

  return {
    myId,
    title: normalizeNullableString(row.title),
    content,
    url: normalizeNullableString(row.url),
    lawTime: normalizeNullableString(row.time),
    insertTime: normalizeInsertTime(row.insertTime),
    type: normalizeNullableString(row.type),
  };
}

function normalizeNullableString(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeInsertTime(value: Date | string | null): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return normalizeNullableString(value);
}
