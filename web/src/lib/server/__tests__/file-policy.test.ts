import { describe, expect, it } from "vitest";

import {
  FILE_VIEW_SIZE_LIMIT_BYTES,
  classifyFileView,
  isWritableProjectFile,
} from "../file-policy";

describe("isWritableProjectFile", () => {
  it("only allows purpose, schema, and wiki markdown files", () => {
    expect(isWritableProjectFile("purpose.md")).toBe(true);
    expect(isWritableProjectFile("schema.md")).toBe(true);
    expect(isWritableProjectFile("wiki/intro.md")).toBe(true);
    expect(isWritableProjectFile("wiki/nested/intro.md")).toBe(true);
    expect(isWritableProjectFile("wiki/intro.txt")).toBe(false);
    expect(isWritableProjectFile("docs/intro.md")).toBe(false);
  });
});

describe("classifyFileView", () => {
  it("classifies editable, preview, metadata, and unsupported files", () => {
    expect(classifyFileView("purpose.md")).toBe("editable");
    expect(classifyFileView("wiki/intro.md")).toBe("preview");
    expect(classifyFileView("package.json")).toBe("metadata");
    expect(classifyFileView("assets/logo.png")).toBe("unsupported");
  });

  it("treats oversized files as unsupported", () => {
    expect(classifyFileView("wiki/intro.md", { sizeBytes: FILE_VIEW_SIZE_LIMIT_BYTES + 1 })).toBe(
      "unsupported",
    );
  });
});
