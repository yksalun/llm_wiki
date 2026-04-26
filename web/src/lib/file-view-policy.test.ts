import { describe, expect, it } from "vitest";

import {
  getFileExtension,
  isSearchableTextFileExtension,
} from "./file-view-policy";

describe("getFileExtension", () => {
  it("matches path.extname behavior for project-relative file names", () => {
    expect(getFileExtension("package.json")).toBe(".json");
    expect(getFileExtension("raw.v1/sources/demo")).toBe("");
    expect(getFileExtension(".json")).toBe("");
    expect(getFileExtension(".pdf")).toBe("");
    expect(getFileExtension(".config.json")).toBe(".json");
  });
});

describe("isSearchableTextFileExtension", () => {
  it("returns true for searchable text file extensions", () => {
    expect(isSearchableTextFileExtension(getFileExtension("README.md"))).toBe(
      true,
    );
    expect(isSearchableTextFileExtension(getFileExtension("notes.txt"))).toBe(
      true,
    );
    expect(isSearchableTextFileExtension(getFileExtension("data.json"))).toBe(
      true,
    );
    expect(isSearchableTextFileExtension(getFileExtension("config.yaml"))).toBe(
      true,
    );
    expect(isSearchableTextFileExtension(getFileExtension("config.yml"))).toBe(
      true,
    );
  });

  it("returns false for non-searchable and extensionless dotfile paths", () => {
    expect(isSearchableTextFileExtension(getFileExtension("report.pdf"))).toBe(
      false,
    );
    expect(isSearchableTextFileExtension(getFileExtension("image.png"))).toBe(
      false,
    );
    expect(isSearchableTextFileExtension(getFileExtension(".json"))).toBe(
      false,
    );
  });
});
