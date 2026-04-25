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

  it("tracks successful save feedback without replacing dirty calculation", () => {
    const store = createWorkbenchStore();
    const savedAt = "2026-04-25T01:00:00.000Z";

    store.getState().openFile(createFile());
    store.getState().setDraft("# Updated");
    store.getState().setSaving(true);
    store.getState().markSaveSuccess(savedAt);

    expect(store.getState().saving).toBe(false);
    expect(store.getState().lastSaveStatus).toBe("success");
    expect(store.getState().lastSavedAt).toBe(savedAt);
    expect(store.getState().conflict).toBeNull();
    expect(store.getState().dirty).toBe(true);
  });

  it("clears save feedback when opening a new file", () => {
    const store = createWorkbenchStore();

    store.getState().openFile(createFile({ relativePath: "first.md" }));
    store.getState().markSaveSuccess("2026-04-25T01:00:00.000Z");
    store.getState().setRefreshing(true);
    store.getState().markRefreshFailed("2026-04-25T14:00:00.000Z");

    store.getState().openFile(createFile({ relativePath: "second.md", content: "# Second" }));

    expect(store.getState()).toMatchObject({
      selectedPath: "second.md",
      draft: "# Second",
      refreshing: false,
      lastSaveStatus: "idle",
      lastSavedAt: null,
      conflict: null,
    });
  });

  it("keeps the draft when save fails or conflicts", () => {
    const store = createWorkbenchStore();

    store.getState().openFile(createFile({ relativePath: "purpose.md" }));
    store.getState().setDraft("# Local draft");
    store.getState().setSaving(true);
    store.getState().markSaveFailed();

    expect(store.getState()).toMatchObject({
      draft: "# Local draft",
      dirty: true,
      saving: false,
      lastSaveStatus: "failed",
      conflict: null,
    });

    store.getState().setSaving(true);
    store.getState().markSaveConflict({
      relativePath: "purpose.md",
      message: "File changed on disk.",
      currentLastModified: "2026-04-25T02:00:00.000Z",
    });

    expect(store.getState()).toMatchObject({
      draft: "# Local draft",
      dirty: true,
      saving: false,
      lastSaveStatus: "conflict",
      conflict: {
        relativePath: "purpose.md",
        message: "File changed on disk.",
        currentLastModified: "2026-04-25T02:00:00.000Z",
      },
    });
  });

  it("records saved time when refresh fails after a successful save", () => {
    const store = createWorkbenchStore();
    const savedAt = "2026-04-25T14:00:00.000Z";

    store.getState().openFile(createFile({ relativePath: "purpose.md" }));
    store.getState().setRefreshing(true);
    store.getState().markSaveConflict({
      relativePath: "purpose.md",
      message: "File changed on disk.",
      currentLastModified: "2026-04-25T02:00:00.000Z",
    });
    store.getState().markRefreshFailed(savedAt);

    expect(store.getState()).toMatchObject({
      saving: false,
      refreshing: false,
      lastSaveStatus: "refresh_failed",
      lastSavedAt: savedAt,
      conflict: null,
    });
  });

  it("clears save feedback explicitly", () => {
    const store = createWorkbenchStore();

    store.getState().openFile(createFile());
    store.getState().markSaveConflict({
      relativePath: "purpose.md",
      message: "File changed on disk.",
      currentLastModified: "2026-04-25T02:00:00.000Z",
    });
    store.getState().clearSaveFeedback();

    expect(store.getState()).toMatchObject({
      refreshing: false,
      lastSaveStatus: "idle",
      lastSavedAt: null,
      conflict: null,
    });
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
    expect(store.getState().refreshing).toBe(false);
    expect(store.getState().lastSaveStatus).toBe("idle");
    expect(store.getState().lastSavedAt).toBeNull();
    expect(store.getState().conflict).toBeNull();
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
    expect(store.getState().refreshing).toBe(false);
    expect(store.getState().lastSaveStatus).toBe("idle");
    expect(store.getState().lastSavedAt).toBeNull();
    expect(store.getState().conflict).toBeNull();
  });

  it("resets the full workbench state", () => {
    const store = createWorkbenchStore();

    store.getState().setSection("Project Info");
    store.getState().openFile(createFile({ relativePath: "wiki/entry.md", content: "hello" }));
    store.getState().setDraft("changed");
    store.getState().setSaving(true);
    store.getState().setRefreshing(true);
    store.getState().markSaveConflict({
      relativePath: "wiki/entry.md",
      message: "File changed on disk.",
      currentLastModified: "2026-04-25T03:00:00.000Z",
    });
    store.getState().reset();

    expect(store.getState()).toMatchObject({
      section: "Overview",
      selectedPath: null,
      file: null,
      draft: "",
      dirty: false,
      saving: false,
      refreshing: false,
      lastSaveStatus: "idle",
      lastSavedAt: null,
      conflict: null,
    });
  });
});
