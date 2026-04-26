import { describe, expect, it } from "vitest";

import { getFileExtension } from "./file-view-policy";

describe("getFileExtension", () => {
  it("matches path.extname behavior for project-relative file names", () => {
    expect(getFileExtension("package.json")).toBe(".json");
    expect(getFileExtension("raw.v1/sources/demo")).toBe("");
    expect(getFileExtension(".json")).toBe("");
    expect(getFileExtension(".pdf")).toBe("");
    expect(getFileExtension(".config.json")).toBe(".json");
  });
});
