// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FileReadResult } from "@/lib/types";

import { FilePanel, type DraftGuardPrompt, type FilePanelNotice } from "./file-panel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const noop = vi.fn();

interface RenderOptions {
  file?: FileReadResult | null;
  draft?: string;
  dirty?: boolean;
  saving?: boolean;
  onReset?: () => void;
}

const baseProps = {
  section: "Files" as const,
  selectedPath: "docs/guide.md",
  file: createEditableFile("docs/guide.md"),
  draft: "# Guide\n\nRead this first.",
  dirty: false,
  saving: false,
  refreshing: false,
  loading: false,
  lastSaveStatus: "idle" as const,
  lastSavedAt: null,
  conflict: null,
  draftGuardPrompt: null as DraftGuardPrompt | null,
  notice: null as FilePanelNotice | null,
  onDraftChange: noop,
  onSave: noop,
  onReset: noop,
  onReloadRemote: noop,
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }

  container?.remove();
  container = null;
  root = null;
  vi.clearAllMocks();
});

describe("FilePanel reading mode", () => {
  it("opens editable files in read mode with edit controls hidden", () => {
    renderFilePanel();

    expect(readButton().getAttribute("aria-pressed")).toBe("true");
    expect(editButton().getAttribute("aria-pressed")).toBe("false");
    expect(container?.querySelector("textarea")).toBeNull();
    expect(buttonNamed("Save changes")).toBeNull();
    expect(buttonNamed("Reset draft")).toBeNull();
    expect(container?.textContent).toContain("Guide");
    expect(container?.textContent).toContain("Read this first.");
  });

  it("switches to edit mode when dirty becomes true", () => {
    renderFilePanel({ dirty: false });

    rerenderFilePanel({ dirty: true });

    expect(readButton().getAttribute("aria-pressed")).toBe("false");
    expect(editButton().getAttribute("aria-pressed")).toBe("true");
    expect(container?.querySelector("textarea")).not.toBeNull();
    expect(buttonNamed("Save changes")).not.toBeNull();
    expect(buttonNamed("Reset draft")).not.toBeNull();
  });

  it("resets to read mode when the file path changes", () => {
    renderFilePanel();

    act(() => {
      editButton().click();
    });

    expect(editButton().getAttribute("aria-pressed")).toBe("true");

    rerenderFilePanel({
      file: createEditableFile("docs/next.md"),
      draft: "# Next file",
      dirty: false,
    });

    expect(readButton().getAttribute("aria-pressed")).toBe("true");
    expect(editButton().getAttribute("aria-pressed")).toBe("false");
    expect(container?.querySelector("textarea")).toBeNull();
    expect(container?.textContent).toContain("Next file");
  });

  it("keeps read and edit toggles disabled while saving", () => {
    renderFilePanel({ saving: true });

    expect(readButton().disabled).toBe(true);
    expect(editButton().disabled).toBe(true);
  });

  it("returns to read mode immediately when resetting a dirty draft", () => {
    const onReset = vi.fn();

    renderFilePanel({ dirty: true, onReset });

    act(() => {
      requiredButton("Reset draft").click();
    });

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(readButton().getAttribute("aria-pressed")).toBe("true");
    expect(editButton().getAttribute("aria-pressed")).toBe("false");
    expect(container?.querySelector("textarea")).toBeNull();
    expect(buttonNamed("Save changes")).toBeNull();
    expect(buttonNamed("Reset draft")).toBeNull();
    expect(container?.textContent).toContain("Guide");
    expect(container?.textContent).toContain("Read this first.");
  });
});

function renderFilePanel(options: RenderOptions = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  rerenderFilePanel(options);
}

function rerenderFilePanel(options: RenderOptions = {}) {
  if (!root) {
    throw new Error("FilePanel test root is not mounted.");
  }

  act(() => {
    root?.render(<FilePanel {...baseProps} {...options} />);
  });
}

function createEditableFile(relativePath: string): FileReadResult {
  return {
    relativePath,
    mode: "editable",
    content: "# Guide\n\nRead this first.",
    editable: true,
    size: 25,
    lastModified: "2026-04-26T00:00:00.000Z",
    metadata: {},
  };
}

function readButton() {
  return requiredButton("Read");
}

function editButton() {
  return requiredButton("Edit");
}

function requiredButton(name: string) {
  const button = buttonNamed(name);

  if (!button) {
    throw new Error(`Expected button named ${name}.`);
  }

  return button;
}

function buttonNamed(name: string) {
  return Array.from(container?.querySelectorAll("button") ?? []).find(
    (button) => button.textContent?.trim() === name,
  ) ?? null;
}
