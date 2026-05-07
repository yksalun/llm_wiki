// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProjectSummary } from "@/lib/types";

import { KnowledgeBaseSelector } from "./knowledge-base-selector";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

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

describe("KnowledgeBaseSelector", () => {
  it("renders projects through a shadcn select trigger", () => {
    renderSelector({ selectedProjectId: "project-a" });

    const trigger = requiredSelectTrigger();
    expect(trigger.textContent).toContain("Alpha");
    expect(trigger.className).toContain("w-64");
    expect(trigger.className).not.toContain("w-full");
    expect(container?.querySelectorAll('[data-slot="select-trigger"]')).toHaveLength(1);
    expect(container?.textContent).not.toContain("Beta");
  });

  it("calls onSelectProject with the chosen project id from the dropdown", async () => {
    const onSelectProject = vi.fn();

    renderSelector({ onSelectProject });
    await chooseSelectItem("Beta");

    expect(onSelectProject).toHaveBeenCalledWith("project-b");
  });

  it("shows an empty state when there are no projects", () => {
    renderSelector({ projects: [] });

    expect(container?.textContent).toContain("暂无知识库");
  });
});

function renderSelector({
  projects = [
    createProject({ id: "project-a", name: "Alpha" }),
    createProject({ id: "project-b", name: "Beta" }),
  ],
  selectedProjectId = null,
  onSelectProject = vi.fn(),
}: {
  projects?: ProjectSummary[];
  selectedProjectId?: string | null;
  onSelectProject?: (projectId: string) => void;
} = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  act(() => {
    root?.render(
      <KnowledgeBaseSelector
        projects={projects}
        selectedProjectId={selectedProjectId}
        onSelectProject={onSelectProject}
      />,
    );
  });
}

async function chooseSelectItem(name: string) {
  await act(async () => {
    requiredSelectTrigger().click();
    await Promise.resolve();
  });

  await act(async () => {
    pressSelectItem(requiredSelectItem(name));
    await Promise.resolve();
  });
}

function requiredSelectTrigger() {
  const trigger = container?.querySelector<HTMLButtonElement>('[data-slot="select-trigger"]');

  if (!trigger) {
    throw new Error("Expected knowledge base select trigger.");
  }

  return trigger;
}

function requiredSelectItem(name: string) {
  const item = Array.from(document.body.querySelectorAll<HTMLElement>('[data-slot="select-item"]')).find(
    (candidate) => candidate.textContent?.trim() === name,
  );

  if (!item) {
    throw new Error(`Expected select item named ${name}.`);
  }

  return item;
}

function pressSelectItem(item: HTMLElement) {
  const pointerDown = new Event("pointerdown", { bubbles: true });
  Object.defineProperty(pointerDown, "pointerType", { value: "touch" });
  item.dispatchEvent(pointerDown);
  item.click();
}

function createProject(overrides: Partial<ProjectSummary>): ProjectSummary {
  return {
    id: "project-1",
    name: "Project",
    status: "ready",
    hasPurpose: true,
    hasSchema: true,
    hasWikiDirectory: true,
    hasRawSourcesDirectory: true,
    updatedAt: null,
    ...overrides,
  };
}
