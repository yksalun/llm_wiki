// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useWorkbenchStore } from "@/stores/workbench-store";
import { fetchProjectDetail } from "@/lib/client/api";
import type { ProjectDetail } from "@/lib/types";

import { ProjectWorkbench } from "./project-workbench";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/app/app-shell", () => ({
  AppShell: ({
    aside,
    children,
  }: {
    aside?: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <main>
      {aside}
      {children}
    </main>
  ),
}));

vi.mock("@/components/workbench/project-search", () => ({
  ProjectSearch: () => null,
}));

vi.mock("@/components/workbench/project-question-panel", () => ({
  ProjectQuestionPanel: ({
    onOpenFile,
  }: {
    onOpenFile: (relativePath: string) => void;
  }) => (
    <button type="button" onClick={() => onOpenFile("wiki/schema.md")}>
      Open source
    </button>
  ),
}));

vi.mock("@/components/workbench/project-insights-panel", () => ({
  ProjectInsightsPanel: ({
    onOpenFile,
  }: {
    onOpenFile: (relativePath: string) => void;
  }) => (
    <button type="button" onClick={() => onOpenFile("wiki/schema.md")}>
      Open insight source
    </button>
  ),
}));

vi.mock("@/lib/client/api", () => ({
  ClientApiError: class ClientApiError extends Error {
    code: string;
    details: Record<string, unknown> | null;

    constructor(message: string, code = "TEST_ERROR", details = null) {
      super(message);
      this.code = code;
      this.details = details;
    }
  },
  fetchProjectDetail: vi.fn().mockResolvedValue({
    id: "project-1",
    name: "Project One",
    status: "ready",
    hasPurpose: true,
    hasSchema: true,
    hasWikiDirectory: true,
    hasRawSourcesDirectory: false,
    access: { mode: "read-write", canRead: true, canWrite: true },
    updatedAt: null,
    rootPathHint: null,
    sections: ["Overview", "Ask", "Insights", "Files", "Purpose", "Schema", "Project Info"],
    runtime: {
      activeEngine: "node",
      bridgeStatus: "not-configured",
      heavyTasks: [
        { task: "project-search", engine: "node", bridgeStatus: "not-configured" },
        { task: "project-insights", engine: "node", bridgeStatus: "not-configured" },
      ],
    },
  }),
  fetchProjectTree: vi.fn().mockResolvedValue([
    {
      name: "purpose.md",
      relativePath: "purpose.md",
      nodeType: "file",
    },
    {
      name: "wiki",
      relativePath: "wiki",
      nodeType: "directory",
      children: [
        {
          name: "schema.md",
          relativePath: "wiki/schema.md",
          nodeType: "file",
        },
      ],
    },
  ]),
  fetchProjectFile: vi.fn().mockImplementation((_: string, relativePath: string) =>
    Promise.resolve({
      relativePath,
      mode: "editable",
      content: `# ${relativePath}`,
      editable: true,
      size: relativePath.length + 2,
      lastModified: "2026-04-26T00:00:00.000Z",
      metadata: {},
    }),
  ),
  saveProjectFile: vi.fn(),
}));

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }

  useWorkbenchStore.getState().reset();
  container?.remove();
  container = null;
  root = null;
  vi.clearAllMocks();
  vi.mocked(fetchProjectDetail).mockResolvedValue(defaultProjectDetail());
});

describe("ProjectWorkbench draft guard", () => {
  it("shows read-only project access in the aside and project info", async () => {
    vi.mocked(fetchProjectDetail).mockResolvedValue({
      id: "project-1",
      name: "Project One",
      status: "ready",
      hasPurpose: true,
      hasSchema: true,
      hasWikiDirectory: true,
      hasRawSourcesDirectory: false,
      access: { mode: "read-only", canRead: true, canWrite: false },
      updatedAt: null,
      rootPathHint: null,
      sections: ["Overview", "Ask", "Insights", "Files", "Purpose", "Schema", "Project Info"],
      runtime: {
        activeEngine: "node",
        bridgeStatus: "not-configured",
        heavyTasks: [
          { task: "project-search", engine: "node", bridgeStatus: "not-configured" },
          { task: "project-insights", engine: "node", bridgeStatus: "not-configured" },
        ],
      },
    });

    renderProjectWorkbench();

    await waitForText("read-only");
    await clickButton("Project Info");

    expect(container?.textContent).toContain("Access mode");
    expect(container?.textContent).toContain("read-only");
    expect(container?.textContent).toContain("Write access");
    expect(container?.textContent).toContain("No");
  });

  it("shows and cancels the dirty draft guard from an Ask source open", async () => {
    renderProjectWorkbench();

    await waitForButton("Purpose");
    await clickButton("Purpose");
    await waitForText("purpose.md");
    await clickButton("Edit");

    updateEditor("# purpose.md\n\nLocal unsaved edit.");

    act(() => {
      useWorkbenchStore.getState().setSection("Ask");
    });

    await clickButton("Open source");

    expect(container?.textContent).toContain("Unsaved draft");
    expect(container?.textContent).toContain("wiki/schema.md");

    await clickButton("Cancel");

    expect(container?.textContent).not.toContain("Unsaved draft");
    expect(container?.textContent).not.toContain("wiki/schema.md");
  });

  it("shows and cancels the dirty draft guard from an Insights source open", async () => {
    renderProjectWorkbench();

    await waitForButton("Purpose");
    await clickButton("Purpose");
    await waitForText("purpose.md");
    await clickButton("Edit");

    updateEditor("# purpose.md\n\nLocal unsaved edit.");

    act(() => {
      useWorkbenchStore.getState().setSection("Insights");
    });

    await clickButton("Open insight source");

    expect(container?.textContent).toContain("Unsaved draft");
    expect(container?.textContent).toContain("wiki/schema.md");

    await clickButton("Cancel");

    expect(container?.textContent).not.toContain("Unsaved draft");
    expect(container?.textContent).not.toContain("wiki/schema.md");
  });
});

function renderProjectWorkbench() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  act(() => {
    root?.render(<ProjectWorkbench projectId="project-1" />);
  });
}

async function waitForText(text: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await act(async () => {
      await Promise.resolve();
    });

    if (container?.textContent?.includes(text)) {
      return;
    }
  }

  throw new Error(`Expected text "${text}".`);
}

async function waitForButton(name: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await act(async () => {
      await Promise.resolve();
    });

    if (buttonNamed(name)) {
      return;
    }
  }

  throw new Error(`Expected button named ${name}.`);
}

async function clickButton(name: string) {
  await act(async () => {
    requiredButton(name).click();
    await Promise.resolve();
  });
}

function updateEditor(value: string) {
  const textarea = container?.querySelector("textarea");

  if (!textarea) {
    throw new Error("Expected editor textarea.");
  }

  act(() => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")
      ?.set;
    valueSetter?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
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
    (candidate) => candidate.textContent?.trim() === name,
  ) ?? null;
}

function defaultProjectDetail(): ProjectDetail {
  return {
    id: "project-1",
    name: "Project One",
    status: "ready" as const,
    hasPurpose: true,
    hasSchema: true,
    hasWikiDirectory: true,
    hasRawSourcesDirectory: false,
    access: { mode: "read-write" as const, canRead: true, canWrite: true },
    updatedAt: null,
    rootPathHint: null,
    sections: ["Overview", "Ask", "Insights", "Files", "Purpose", "Schema", "Project Info"],
    runtime: {
      activeEngine: "node",
      bridgeStatus: "not-configured",
      heavyTasks: [
        { task: "project-search", engine: "node", bridgeStatus: "not-configured" },
        { task: "project-insights", engine: "node", bridgeStatus: "not-configured" },
      ],
    },
  };
}
