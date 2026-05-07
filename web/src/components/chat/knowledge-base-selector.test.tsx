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
  it("renders projects and marks the selected project", () => {
    renderSelector({ selectedProjectId: "project-a" });

    expect(container?.textContent).toContain("Alpha");
    expect(container?.textContent).toContain("Beta");
    expect(requiredButton("Alpha").getAttribute("aria-current")).toBe("true");
    expect(requiredButton("Beta").getAttribute("aria-current")).toBeNull();
  });

  it("calls onSelectProject with the chosen project id", () => {
    const onSelectProject = vi.fn();

    renderSelector({ onSelectProject });
    clickButton("Beta");

    expect(onSelectProject).toHaveBeenCalledWith("project-b");
  });

  it("shows an empty state when there are no projects", () => {
    renderSelector({ projects: [] });

    expect(container?.textContent).toContain("No knowledge bases found.");
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

function clickButton(name: string) {
  act(() => {
    requiredButton(name).click();
  });
}

function requiredButton(name: string) {
  const button = Array.from(container?.querySelectorAll("button") ?? []).find(
    (candidate) => candidate.textContent?.trim() === name,
  );

  if (!button) {
    throw new Error(`Expected button named ${name}.`);
  }

  return button;
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
