import fs from "node:fs/promises";
import path from "node:path";
import type { Stats } from "node:fs";
import { TextDecoder } from "node:util";

import type { FileReadResult } from "@/lib/types";

import { AppError } from "./app-error";
import { FILE_VIEW_SIZE_LIMIT_BYTES, classifyFileView } from "./file-policy";
import { normalizeRelativePath, resolvePathInsideRoot } from "./path-safety";

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export async function readProjectFile(
  projectRoot: string,
  relativePath: string,
): Promise<FileReadResult> {
  const normalizedPath = safeNormalizeRelativePath(relativePath);
  const absolutePath = safeResolvePathInsideRoot(projectRoot, normalizedPath);
  const stats = await statProjectFile(absolutePath);
  const mode = classifyFileView(normalizedPath, { sizeBytes: stats.size });
  const lastModified = stats.mtime.toISOString();

  if (mode === "metadata") {
    return {
      relativePath: normalizedPath,
      mode,
      content: null,
      editable: false,
      size: stats.size,
      lastModified,
      metadata: {
        reason: "metadata_only",
        extension: path.extname(normalizedPath).toLowerCase(),
      },
    };
  }

  if (mode === "unsupported") {
    return {
      relativePath: normalizedPath,
      mode,
      content: null,
      editable: false,
      size: stats.size,
      lastModified,
      metadata: {
        reason:
          stats.size > FILE_VIEW_SIZE_LIMIT_BYTES ? "file_too_large" : "unsupported_file_type",
      },
    };
  }

  const textReadResult = await readUtf8TextFile(absolutePath);

  if (textReadResult.kind === "invalid_utf8") {
    return {
      relativePath: normalizedPath,
      mode: "unsupported",
      content: null,
      editable: false,
      size: stats.size,
      lastModified,
      metadata: {
        reason: "invalid_utf8",
      },
    };
  }

  return {
    relativePath: normalizedPath,
    mode,
    content: textReadResult.content,
    editable: mode === "editable",
    size: stats.size,
    lastModified,
    metadata: {},
  };
}

async function statProjectFile(filePath: string): Promise<Stats> {
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
      throw new AppError("FILE_NOT_FOUND", 404, "Requested file was not found.", { cause: error });
    }

    throw error;
  }
}

async function readUtf8TextFile(
  filePath: string,
): Promise<{ kind: "text"; content: string } | { kind: "invalid_utf8" }> {
  try {
    const buffer = await fs.readFile(filePath);
    return {
      kind: "text",
      content: utf8Decoder.decode(buffer),
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new AppError("FILE_NOT_FOUND", 404, "Requested file was not found.", { cause: error });
    }

    if (error instanceof TypeError) {
      return { kind: "invalid_utf8" };
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
