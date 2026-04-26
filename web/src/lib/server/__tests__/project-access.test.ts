import { describe, expect, it } from "vitest";

import type { FileReadResult } from "../../types";
import {
  applyProjectAccessToFile,
  getProjectAccessPolicyFromEnv,
  requireProjectWriteAccess,
} from "../project-access";

describe("getProjectAccessPolicyFromEnv", () => {
  it("defaults to read-write access when the environment value is unset or empty", () => {
    expect(getProjectAccessPolicyFromEnv({})).toEqual({
      mode: "read-write",
      canRead: true,
      canWrite: true,
    });
    expect(getProjectAccessPolicyFromEnv({ LLM_WIKI_PROJECT_ACCESS_MODE: "" })).toEqual({
      mode: "read-write",
      canRead: true,
      canWrite: true,
    });
  });

  it("returns read-only access when configured by environment", () => {
    expect(getProjectAccessPolicyFromEnv({ LLM_WIKI_PROJECT_ACCESS_MODE: "read-only" })).toEqual({
      mode: "read-only",
      canRead: true,
      canWrite: false,
    });
  });

  it("rejects invalid project access modes", () => {
    expect(() =>
      getProjectAccessPolicyFromEnv({ LLM_WIKI_PROJECT_ACCESS_MODE: "preview-only" }),
    ).toThrow("Server project access mode must be read-write or read-only.");
    expect(catchError(() =>
      getProjectAccessPolicyFromEnv({ LLM_WIKI_PROJECT_ACCESS_MODE: "preview-only" }),
    )).toMatchObject({
      code: "PROJECT_ACCESS_MODE_INVALID",
      status: 500,
      publicMessage: "Server project access mode must be read-write or read-only.",
    });
  });
});

describe("requireProjectWriteAccess", () => {
  it("rejects writes when the project is read-only", () => {
    expect(() =>
      requireProjectWriteAccess({
        mode: "read-only",
        canRead: true,
        canWrite: false,
      }),
    ).toThrow("This project is currently opened in read-only mode.");
    expect(catchError(() =>
      requireProjectWriteAccess({
        mode: "read-only",
        canRead: true,
        canWrite: false,
      }),
    )).toMatchObject({
      code: "PROJECT_ACCESS_READ_ONLY",
      status: 403,
      publicMessage: "This project is currently opened in read-only mode.",
    });
  });
});

function catchError(action: () => void): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }

  throw new Error("Expected action to throw.");
}

describe("applyProjectAccessToFile", () => {
  it("leaves editable files unchanged when writes are enabled", () => {
    const file: FileReadResult = {
      relativePath: "wiki/index.md",
      mode: "editable",
      content: "# Wiki\n",
      editable: true,
      size: 7,
      lastModified: "2026-04-26T00:00:00.000Z",
      metadata: {
        existing: true,
      },
    };

    expect(
      applyProjectAccessToFile(file, {
        mode: "read-write",
        canRead: true,
        canWrite: true,
      }),
    ).toBe(file);
  });

  it("converts editable files to preview files when writes are disabled", () => {
    const file: FileReadResult = {
      relativePath: "wiki/index.md",
      mode: "editable",
      content: "# Wiki\n",
      editable: true,
      size: 7,
      lastModified: "2026-04-26T00:00:00.000Z",
      metadata: {
        existing: true,
      },
    };

    expect(
      applyProjectAccessToFile(file, {
        mode: "read-only",
        canRead: true,
        canWrite: false,
      }),
    ).toEqual({
      ...file,
      mode: "preview",
      editable: false,
      metadata: {
        existing: true,
        accessMode: "read-only",
      },
    });
  });

  it("leaves non-editable files unchanged when writes are disabled", () => {
    const file: FileReadResult = {
      relativePath: "raw/sources/demo.pdf",
      mode: "metadata",
      content: null,
      editable: false,
      size: 42,
      lastModified: null,
      metadata: {
        reason: "metadata_only",
      },
    };

    expect(
      applyProjectAccessToFile(file, {
        mode: "read-only",
        canRead: true,
        canWrite: false,
      }),
    ).toBe(file);
  });
});
