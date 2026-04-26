import fs from "node:fs/promises";
import path from "node:path";
import type { Dirent } from "node:fs";
import { TextDecoder } from "node:util";

import { getFileExtension, isSearchableTextFileExtension } from "@/lib/file-view-policy";

import { FILE_VIEW_SIZE_LIMIT_BYTES } from "./file-policy";

const TEXT_SCAN_READ_LIMIT_BYTES = FILE_VIEW_SIZE_LIMIT_BYTES + 1;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export type ProjectTextFile = {
  relativePath: string;
  content: string;
  size: number;
  extension: string;
};

export type ProjectTextScanStats = {
  skippedFiles: number;
};

export type ProjectTextScanResult = {
  files: AsyncGenerator<ProjectTextFile>;
  stats: ProjectTextScanStats;
};

export function scanProjectTextFiles(projectRoot: string): ProjectTextScanResult {
  const rootDir = path.resolve(projectRoot);
  const stats: ProjectTextScanStats = {
    skippedFiles: 0,
  };

  return {
    files: scanTextFiles(rootDir, stats),
    stats,
  };
}

async function* scanTextFiles(
  rootDir: string,
  stats: ProjectTextScanStats,
): AsyncGenerator<ProjectTextFile> {
  for await (const relativePath of walkProjectFiles(rootDir, "")) {
    const extension = getFileExtension(relativePath);

    if (!isSearchableTextFileExtension(extension)) {
      stats.skippedFiles += 1;
      continue;
    }

    const absolutePath = path.join(rootDir, relativePath);
    const file = await readTextFile(absolutePath, relativePath, extension);

    if (!file) {
      stats.skippedFiles += 1;
      continue;
    }

    yield file;
  }
}

async function* walkProjectFiles(
  rootDir: string,
  relativeDir: string,
): AsyncGenerator<string> {
  const directoryPath = relativeDir === "" ? rootDir : path.join(rootDir, relativeDir);
  let entries: Dirent[];

  try {
    entries = await fs.readdir(directoryPath, { withFileTypes: true });
  } catch {
    return;
  }

  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    if (relativeDir === "" && entry.name === ".llm-wiki") {
      continue;
    }

    const relativePath = relativeDir === "" ? entry.name : path.posix.join(relativeDir, entry.name);

    if (entry.isDirectory()) {
      yield* walkProjectFiles(rootDir, relativePath);
      continue;
    }

    if (entry.isFile()) {
      yield relativePath;
    }
  }
}

async function readTextFile(
  absolutePath: string,
  relativePath: string,
  extension: string,
): Promise<ProjectTextFile | null> {
  const stats = await safeStatFile(absolutePath);

  if (!stats || stats.size > FILE_VIEW_SIZE_LIMIT_BYTES) {
    return null;
  }

  const content = await safeReadUtf8(absolutePath);

  if (content === null) {
    return null;
  }

  return {
    relativePath,
    content,
    size: stats.size,
    extension,
  };
}

async function safeStatFile(filePath: string): Promise<{ size: number } | null> {
  try {
    const stats = await fs.stat(filePath);

    if (!stats.isFile()) {
      return null;
    }

    return { size: stats.size };
  } catch {
    return null;
  }
}

async function safeReadUtf8(filePath: string): Promise<string | null> {
  let fileHandle: Awaited<ReturnType<typeof fs.open>> | null = null;

  try {
    fileHandle = await fs.open(filePath, "r");
    const buffer = Buffer.allocUnsafe(TEXT_SCAN_READ_LIMIT_BYTES);
    const { bytesRead } = await fileHandle.read(buffer, 0, buffer.byteLength, 0);

    if (bytesRead > FILE_VIEW_SIZE_LIMIT_BYTES) {
      return null;
    }

    return utf8Decoder.decode(buffer.subarray(0, bytesRead));
  } catch {
    return null;
  } finally {
    await fileHandle?.close().catch(() => undefined);
  }
}
