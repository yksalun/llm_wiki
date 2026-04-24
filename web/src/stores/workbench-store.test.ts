import { describe, expect, it } from "vitest";

import type { FileReadResult } from "@/lib/types";

import { createWorkbenchStore } from "./workbench-store";

function createFile(overrides: Partial<FileReadResult> = {}): FileReadResult {
  return {
    relativePath: "purpose.md",
    mode: "editable",
    content: "# Purpose",
    editable: true,
    size: 10,
    lastModified: "2026-04-25T00:00:00.000Z",
    metadata: {},
    ...overrides,
  };
}

describe("createWorkbenchStore", () => {
  it("tracks section and file editing state", () => {
    const store = createWorkbenchStore();
    const file = createFile();

    store.getState().setSection("Files");
    store.getState().openFile(file);
    store.getState().setDraft("# Updated");
    store.getState().setSaving(true);

    expect(store.getState().section).toBe("Files");
    expect(store.getState().selectedPath).toBe("purpose.md");
    expect(store.getState().file).toEqual(file);
    expect(store.getState().draft).toBe("# Updated");
    expect(store.getState().dirty).toBe(true);
    expect(store.getState().saving).toBe(true);
  });

  it("clears dirty when the draft returns to the original content", () => {
    const store = createWorkbenchStore();
    const file = createFile();

    store.getState().openFile(file);
    store.getState().setDraft("# Updated");
    store.getState().setDraft(file.content ?? "");

    expect(store.getState().draft).toBe("# Purpose");
    expect(store.getState().dirty).toBe(false);
  });

  it("can clear the selection without resetting the active section", () => {
    const store = createWorkbenchStore();

    store.getState().setSection("Schema");
    store.getState().openFile(createFile({ relativePath: "schema.md", content: "# Schema" }));
    store.getState().clearFile();

    expect(store.getState().section).toBe("Schema");
    expect(store.getState().selectedPath).toBeNull();
    expect(store.getState().file).toBeNull();
    expect(store.getState().draft).toBe("");
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().saving).toBe(false);
  });

  it("can clear the loaded file while keeping the requested path selected", () => {
    const store = createWorkbenchStore();

    store.getState().setSection("Files");
    store.getState().openFile(createFile({ relativePath: "wiki/index.md", content: "# Wiki" }));
    store.getState().setSelectedPath("wiki/missing.md");
    store.getState().clearFile(true);

    expect(store.getState().section).toBe("Files");
    expect(store.getState().selectedPath).toBe("wiki/missing.md");
    expect(store.getState().file).toBeNull();
    expect(store.getState().draft).toBe("");
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().saving).toBe(false);
  });

  it("resets the full workbench state", () => {
    const store = createWorkbenchStore();

    store.getState().setSection("Project Info");
    store.getState().openFile(createFile({ relativePath: "wiki/entry.md", content: "hello" }));
    store.getState().setDraft("changed");
    store.getState().setSaving(true);
    store.getState().reset();

    expect(store.getState()).toMatchObject({
      section: "Overview",
      selectedPath: null,
      file: null,
      draft: "",
      dirty: false,
      saving: false,
    });
  });
});
