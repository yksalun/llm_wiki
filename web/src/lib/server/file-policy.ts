import {
  getFileExtension,
  isMetadataFileExtension,
  isPreviewFileExtension,
} from "@/lib/file-view-policy";

import { normalizeRelativePath } from "./path-safety";

export const FILE_VIEW_SIZE_LIMIT_BYTES = 1024 * 1024;

export type FileViewClass = "editable" | "preview" | "metadata" | "unsupported";

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
  const extension = getFileExtension(normalized);

  if (options.sizeBytes !== undefined && options.sizeBytes > FILE_VIEW_SIZE_LIMIT_BYTES) {
    return "unsupported";
  }

  if (isWritableProjectFile(normalized)) {
    return "editable";
  }

  if (isMetadataFileExtension(extension)) {
    return "metadata";
  }

  if (isPreviewFileExtension(extension)) {
    return "preview";
  }

  return "unsupported";
}
