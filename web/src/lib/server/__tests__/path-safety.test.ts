import path from "node:path";

import { describe, expect, it } from "vitest";

import { normalizeRelativePath, resolvePathInsideRoot } from "../path-safety";

describe("normalizeRelativePath", () => {
  it("normalizes safe relative paths", () => {
    expect(normalizeRelativePath("./wiki/../wiki/intro.md")).toBe("wiki/intro.md");
  });

  it("rejects empty, absolute, escaped, drive-letter, and null-byte paths", () => {
    expect(() => normalizeRelativePath("")).toThrow();
    expect(() => normalizeRelativePath("/etc/passwd")).toThrow();
    expect(() => normalizeRelativePath("C:\\wiki\\intro.md")).toThrow();
    expect(() => normalizeRelativePath("../secret.md")).toThrow();
    expect(() => normalizeRelativePath("wiki/\0intro.md")).toThrow();
  });
});

describe("resolvePathInsideRoot", () => {
  it("resolves safe paths inside the root", () => {
    const rootDir = path.join("F:/projects", "demo");

    expect(resolvePathInsideRoot(rootDir, "wiki/intro.md")).toBe(
      path.join(rootDir, "wiki", "intro.md"),
    );
  });

  it("rejects paths that escape the root", () => {
    const rootDir = path.join("F:/projects", "demo");

    expect(() => resolvePathInsideRoot(rootDir, "../secret.md")).toThrow();
  });
});
