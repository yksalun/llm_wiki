// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProjectInsightsResponse } from "@/lib/types";

import { ProjectInsightsPanel } from "./project-insights-panel";

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

describe("ProjectInsightsPanel", () => {
  it("shows initial loading while insights are requested", () => {
    const deferred = createDeferred<ProjectInsightsResponse>();
    const fetchFn = vi.fn().mockReturnValue(deferred.promise);

    renderProjectInsightsPanel({ fetchFn });

    expect(container?.textContent).toContain("正在加载洞察");
    expect(fetchFn).toHaveBeenCalledWith("project-1", expect.any(AbortSignal));
  });

  it("renders summary, graph edges, findings, and research prompts after success", async () => {
    const fetchFn = vi.fn().mockResolvedValue(createInsightsResponse());

    renderProjectInsightsPanel({ fetchFn });
    await flushPromises();

    expect(container?.textContent).toContain("项目洞察");
    expect(container?.textContent).toContain("2 个文件");
    expect(container?.textContent).toContain("1 条边");
    expect(container?.textContent).toContain("wiki/index.md -> wiki/schema.md");
    expect(container?.textContent).toContain("警告");
    expect(container?.textContent).toContain("Broken schema link");
    expect(container?.textContent).toContain("Document the schema owner");
    expect(container?.textContent).toContain("Who owns schema updates?");
  });

  it("opens finding and research prompt sources by relative path", async () => {
    const onOpenFile = vi.fn();
    const fetchFn = vi.fn().mockResolvedValue(createInsightsResponse());

    renderProjectInsightsPanel({ onOpenFile, fetchFn });
    await flushPromises();

    const buttons = openSourceButtons();

    await clickElement(buttons[0]);
    await clickElement(buttons[1]);

    expect(onOpenFile).toHaveBeenNthCalledWith(1, "wiki/index.md");
    expect(onOpenFile).toHaveBeenNthCalledWith(2, "wiki/schema.md");
  });

  it("renders errors and retries insights loading", async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("Insights service unavailable"))
      .mockResolvedValueOnce(createInsightsResponse());

    renderProjectInsightsPanel({ fetchFn });
    await flushPromises();

    expect(container?.textContent).toContain("洞察加载失败");
    expect(container?.textContent).toContain("Insights service unavailable");
    expect(fetchFn).toHaveBeenCalledTimes(1);

    await clickButton("重试");

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(container?.textContent).toContain("项目洞察");
  });

  it("aborts the prior request and resets loading state when the project changes", async () => {
    const first = createDeferred<ProjectInsightsResponse>();
    const second = createDeferred<ProjectInsightsResponse>();
    const fetchFn = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { rerender } = renderProjectInsightsPanel({ projectId: "project-a", fetchFn });

    const firstSignal = fetchFn.mock.calls[0]?.[1] as AbortSignal;

    rerender({ projectId: "project-b", fetchFn });

    expect(firstSignal.aborted).toBe(true);
    expect(container?.textContent).toContain("正在加载洞察");
    expect(fetchFn).toHaveBeenLastCalledWith("project-b", expect.any(AbortSignal));

    await act(async () => {
      first.resolve(
        createInsightsResponse({
          findings: [
            {
              id: "old",
              severity: "info",
              title: "Old project finding",
              message: "This belongs to project A.",
            },
          ],
        }),
      );
      second.resolve(createInsightsResponse());
      await Promise.resolve();
    });

    expect(container?.textContent).not.toContain("Old project finding");
    expect(container?.textContent).toContain("Broken schema link");
  });
});

function renderProjectInsightsPanel({
  projectId = "project-1",
  onOpenFile = vi.fn(),
  fetchFn = vi.fn(),
}: {
  projectId?: string;
  onOpenFile?: (relativePath: string) => void;
  fetchFn?: ComponentProps<typeof ProjectInsightsPanel>["fetchFn"];
} = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  act(() => {
    root?.render(
      <ProjectInsightsPanel projectId={projectId} onOpenFile={onOpenFile} fetchFn={fetchFn} />,
    );
  });

  return {
    rerender(nextProps: {
      projectId?: string;
      onOpenFile?: (relativePath: string) => void;
      fetchFn?: ComponentProps<typeof ProjectInsightsPanel>["fetchFn"];
    }) {
      act(() => {
        root?.render(
          <ProjectInsightsPanel
            projectId={nextProps.projectId ?? projectId}
            onOpenFile={nextProps.onOpenFile ?? onOpenFile}
            fetchFn={nextProps.fetchFn ?? fetchFn}
          />,
        );
      });
    },
  };
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function clickButton(name: string) {
  await clickElement(requiredButton(name));
}

async function clickElement(element: HTMLElement) {
  await act(async () => {
    element.click();
    await Promise.resolve();
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

function openSourceButtons() {
  const buttons = Array.from(container?.querySelectorAll("button") ?? []).filter(
    (candidate) => candidate.textContent?.trim() === "打开来源",
  );

  if (buttons.length < 2) {
    throw new Error("Expected at least two 打开来源 buttons.");
  }

  return buttons;
}

function createInsightsResponse(
  overrides: Partial<ProjectInsightsResponse> = {},
): ProjectInsightsResponse {
  return {
    summary: {
      analyzedFiles: 2,
      markdownFiles: 2,
      graphNodes: 2,
      graphEdges: 1,
      findings: 1,
      researchPrompts: 1,
      ...overrides.summary,
    },
    graph: {
      nodes: [
        {
          id: "file:wiki/index.md",
          label: "Index",
          kind: "file",
          relativePath: "wiki/index.md",
        },
        {
          id: "file:wiki/schema.md",
          label: "Schema",
          kind: "file",
          relativePath: "wiki/schema.md",
        },
      ],
      edges: [
        {
          id: "edge-1",
          sourceId: "file:wiki/index.md",
          targetId: "file:wiki/schema.md",
          kind: "links-to",
          label: "links to",
          sourceLineNumber: 7,
        },
      ],
      ...overrides.graph,
    },
    findings: [
      {
        id: "finding-1",
        severity: "warning",
        title: "Broken schema link",
        message: "The schema reference should be checked.",
        relativePath: "wiki/index.md",
        lineNumber: 7,
      },
      ...(overrides.findings ?? []),
    ],
    researchPrompts: [
      {
        id: "prompt-1",
        title: "Document the schema owner",
        question: "Who owns schema updates?",
        reason: "Ownership is unclear in the docs.",
        sourceIds: ["file:wiki/schema.md"],
      },
      ...(overrides.researchPrompts ?? []),
    ],
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}
