import { normalizeRelativePath } from "./path-safety";

export const FILE_VIEW_SIZE_LIMIT_BYTES = 1024 * 1024;

export type FileViewClass = "editable" | "preview" | "metadata" | "unsupported";

const METADATA_FILES = new Set([
  ".env.example",
  "drizzle.config.ts",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "package.json",
  "tsconfig.json",
]);

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

  if (options.sizeBytes !== undefined && options.sizeBytes > FILE_VIEW_SIZE_LIMIT_BYTES) {
    return "unsupported";
  }

  if (normalized === "purpose.md" || normalized === "schema.md") {
    return "editable";
  }

  if (normalized.startsWith("wiki/") && normalized.endsWith(".md")) {
    return "preview";
  }

  if (METADATA_FILES.has(normalized)) {
    return "metadata";
  }

  if (normalized.endsWith(".md")) {
    return "preview";
  }

  return "unsupported";
}
