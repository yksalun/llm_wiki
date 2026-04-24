import fs from "node:fs/promises";
import path from "node:path";
import type { Stats } from "node:fs";

import type { FileWriteRequest, FileWriteResult } from "@/lib/types";

import { AppError } from "./app-error";
import { isWritableProjectFile } from "./file-policy";
import { normalizeRelativePath, resolvePathInsideRoot } from "./path-safety";

const pendingWrites = new Map<string, Promise<void>>();

export async function writeProjectFile(
  projectRoot: string,
  request: FileWriteRequest,
): Promise<FileWriteResult> {
  const normalizedPath = safeNormalizeRelativePath(request.relativePath);

  if (!isWritableProjectFile(normalizedPath)) {
    throw new AppError("FILE_NOT_WRITABLE", 400, "This file is not writable through the workbench.");
  }

  const absolutePath = safeResolvePathInsideRoot(projectRoot, normalizedPath);

  return withWriteLock(absolutePath, async () => {
    const currentStats = await getExistingFileStats(absolutePath);
    const currentLastModified = currentStats?.mtime.toISOString() ?? null;

    if (request.lastModified !== currentLastModified) {
      throw new AppError("FILE_WRITE_CONFLICT", 409, "File changed since it was last read.");
    }

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, request.content, "utf8");

    const updatedStats = await fs.stat(absolutePath);

    return {
      relativePath: normalizedPath,
      lastModified: updatedStats.mtime.toISOString(),
    };
  });
}

async function getExistingFileStats(filePath: string): Promise<Stats | null> {
  try {
    const stats = await fs.stat(filePath);

    if (!stats.isFile()) {
      throw new AppError("FILE_NOT_FOUND", 404, "Requested file was not found.");
    }

    return stats;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function safeNormalizeRelativePath(relativePath: string): string {
  try {
    return normalizeRelativePath(relativePath);
  } catch (error) {
    throw new AppError("INVALID_FILE_PATH", 400, "File path must be a safe relative path.", {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

function safeResolvePathInsideRoot(projectRoot: string, relativePath: string): string {
  try {
    return resolvePathInsideRoot(projectRoot, relativePath);
  } catch (error) {
    throw new AppError("PATH_OUTSIDE_PROJECT", 400, "File path escapes the project root.", {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

async function withWriteLock<T>(lockKey: string, operation: () => Promise<T>): Promise<T> {
  const previous = pendingWrites.get(lockKey);
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });

  pendingWrites.set(lockKey, current);

  try {
    await previous;
    return await operation();
  } finally {
    releaseCurrent();

    if (pendingWrites.get(lockKey) === current) {
      pendingWrites.delete(lockKey);
    }
  }
}
