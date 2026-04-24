import path from "node:path";

const DRIVE_LETTER_PATH = /^[a-zA-Z]:/;

export function normalizeRelativePath(input: string): string {
  if (input.length === 0) {
    throw new Error("Path must not be empty");
  }

  if (input.includes("\0")) {
    throw new Error("Path must not contain null bytes");
  }

  const normalizedInput = input.replaceAll("\\", "/");

  if (
    path.posix.isAbsolute(normalizedInput) ||
    path.win32.isAbsolute(input) ||
    DRIVE_LETTER_PATH.test(input) ||
    input.startsWith("\\\\")
  ) {
    throw new Error("Path must be relative");
  }

  const normalized = path.posix.normalize(normalizedInput);

  if (normalized === "." || normalized === "" || normalized === ".." || normalized.startsWith("../")) {
    throw new Error("Path must stay relative");
  }

  return normalized;
}

export function resolvePathInsideRoot(rootDir: string, relativePath: string): string {
  const root = path.resolve(rootDir);
  const normalized = normalizeRelativePath(relativePath);
  const resolved = path.resolve(root, normalized);
  const relative = path.relative(root, resolved);

  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path escapes the project root");
  }

  return resolved;
}
