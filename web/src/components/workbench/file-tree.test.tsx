// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FileTreeNode } from "@/lib/types";

import { FileTree } from "./file-tree";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const tree: FileTreeNode[] = [
  {
    name: "wiki",
    relativePath: "wiki",
    nodeType: "directory",
    children: [
      { name: "index.md", relativePath: "wiki/index.md", nodeType: "file" },
      {
        name: "nested",
        relativePath: "wiki/nested",
        nodeType: "directory",
        children: [
          {
            name: "deep.md",
            relativePath: "wiki/nested/deep.md",
            nodeType: "file",
          },
        ],
      },
    ],
  },
];

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

describe("FileTree", () => {
  it("collapses directories by default", () => {
    renderFileTree();

    expect(container?.textContent).toContain("wiki");
    expect(container?.textContent).not.toContain("index.md");
  });

  it("opens a file after expanding its directory", () => {
    const onOpenFile = vi.fn();

    renderFileTree({ onOpenFile });

    act(() => {
      requiredButton("wiki").click();
    });
    act(() => {
      requiredButton("index.md").click();
    });

    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(onOpenFile).toHaveBeenCalledWith("wiki/index.md");
  });

  it("auto-expands ancestor directories for a selected nested file", () => {
    renderFileTree({ selectedPath: "wiki/nested/deep.md" });

    expect(container?.textContent).toContain("wiki");
    expect(container?.textContent).toContain("nested");
    expect(container?.textContent).toContain("deep.md");
  });
});

function renderFileTree(options: Partial<FileTreeProps> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  act(() => {
    root?.render(
      <FileTree
        tree={tree}
        selectedPath={null}
        loadingPath={null}
        onOpenFile={vi.fn()}
        {...options}
      />,
    );
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

type FileTreeProps = Parameters<typeof FileTree>[0];
