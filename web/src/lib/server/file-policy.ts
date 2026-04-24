import path from "node:path";

import { normalizeRelativePath } from "./path-safety";

export const FILE_VIEW_SIZE_LIMIT_BYTES = 1024 * 1024;

export type FileViewClass = "editable" | "preview" | "metadata" | "unsupported";

const PREVIEW_EXTENSIONS = new Set([".md", ".txt", ".json", ".yaml", ".yml"]);
const METADATA_EXTENSIONS = new Set([".pdf", ".docx", ".pptx", ".xlsx"]);

export function isWritableProjectFile(relativePath: string): boolean {
  const normalized = normalizeRelativePath(relativePath);

  return (
    normalized === "purpose.md" ||
    normalized === "schema.md" ||
    (normalized.startsWith("wiki/") && normalized.endsWith(".md"))
  );
}

export function classifyFileView(
  relativePath: string,
  options: { sizeBytes?: number } = {},
): FileViewClass {
  const normalized = normalizeRelativePath(relativePath);
  const extension = path.extname(normalized).toLowerCase();

  if (options.sizeBytes !== undefined && options.sizeBytes > FILE_VIEW_SIZE_LIMIT_BYTES) {
    return "unsupported";
  }

  if (isWritableProjectFile(normalized)) {
    return "editable";
  }

  if (METADATA_EXTENSIONS.has(extension)) {
    return "metadata";
  }

  if (PREVIEW_EXTENSIONS.has(extension)) {
    return "preview";
  }

  return "unsupported";
}
