// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FileTreeNode, ProjectDetail } from "@/lib/types";

import { ProjectOverview } from "./project-overview";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const project: ProjectDetail = {
  id: "project-alpha",
  name: "Project Alpha",
  status: "ready",
  hasPurpose: true,
  hasSchema: true,
  hasWikiDirectory: true,
  hasRawSourcesDirectory: false,
  updatedAt: "2026-04-26T00:00:00.000Z",
  sections: ["Overview", "Files", "Purpose", "Schema", "Project Info"],
  rootPathHint: null,
  access: {
    mode: "read-write",
    canRead: true,
    canWrite: true,
  },
  runtime: {
    activeEngine: "node",
    bridgeStatus: "not-configured",
    heavyTasks: [
      { task: "project-search", engine: "node", bridgeStatus: "not-configured" },
      { task: "project-insights", engine: "node", bridgeStatus: "not-configured" },
    ],
  },
};

const tree: FileTreeNode[] = [
  {
    name: "wiki",
    relativePath: "wiki",
    nodeType: "directory",
    children: [
      {
        name: "intro",
        relativePath: "wiki/intro.md",
        nodeType: "file",
      },
      {
        name: "data",
        relativePath: "wiki/data.json",
        nodeType: "file",
      },
      {
        name: "brief",
        relativePath: "wiki/brief.pdf",
        nodeType: "file",
      },
    ],
  },
];

describe("ProjectOverview", () => {
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

  it("renders localized reading structure metrics and a wiki entry point", () => {
    const html = renderToStaticMarkup(
      <ProjectOverview project={project} tree={tree} onChangeSection={() => undefined} />,
    );

    expect(html).toContain("标记文档");
    expect(html).toContain("预览文件");
    expect(html).toContain("元数据文件");
    expect(html).toContain("从知识库开始");
    expectMetric(html, "标记文档", "1");
    expectMetric(html, "预览文件", "1");
    expectMetric(html, "元数据文件", "1");
  });

  it("opens wiki/index.md when starting with wiki and index exists", () => {
    const onOpenFile = vi.fn();

    renderProjectOverview(
      [
        {
          name: "wiki",
          relativePath: "wiki",
          nodeType: "directory",
          children: [
            {
              name: "intro",
              relativePath: "wiki/intro.md",
              nodeType: "file",
            },
            {
              name: "index",
              relativePath: "wiki/index.md",
              nodeType: "file",
            },
          ],
        },
      ],
      onOpenFile,
    );

    startWithWikiButton().click();

    expect(onOpenFile).toHaveBeenCalledWith("wiki/index.md");
  });

  it("opens the first wiki markdown file when index is missing", () => {
    const onOpenFile = vi.fn();

    renderProjectOverview(tree, onOpenFile);

    startWithWikiButton().click();

    expect(onOpenFile).toHaveBeenCalledWith("wiki/intro.md");
  });

  function renderProjectOverview(nextTree: FileTreeNode[], onOpenFile: (relativePath: string) => void) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <ProjectOverview
          project={project}
          tree={nextTree}
          onChangeSection={() => undefined}
          onOpenFile={onOpenFile}
        />,
      );
    });
  }

  function startWithWikiButton(): HTMLButtonElement {
    const button = Array.from(container?.querySelectorAll("button") ?? []).find(
      (candidate) => candidate.textContent === "从知识库开始",
    );

    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("Start with wiki button not found");
    }

    return button;
  }
});

function expectMetric(html: string, label: string, value: string) {
  expect(html).toMatch(new RegExp(`${label}</p><p class="[^"]*">${value}</p>`));
}
