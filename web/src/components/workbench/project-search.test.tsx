// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProjectSearchResponse } from "@/lib/types";

import { ProjectSearch } from "./project-search";

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
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("ProjectSearch", () => {
  it("does not search a one-character query and asks for at least two characters", async () => {
    vi.useFakeTimers();
    const searchFn = vi.fn();

    renderProjectSearch({ searchFn });
    updateSearchInput("a");
    await advanceSearch();

    expect(searchFn).not.toHaveBeenCalled();
    expect(container?.textContent).toContain("Type at least 2 characters");
  });

  it("renders successful results and delegates opening by relative path", async () => {
    vi.useFakeTimers();
    const onOpenFile = vi.fn();
    const searchFn = vi.fn().mockResolvedValue(
      createSearchResponse({
        results: [
          {
            relativePath: "wiki/index.md",
            lineNumber: 3,
            lineText: "Alpha line",
            preview: "Alpha preview text",
            matchStart: 0,
            matchEnd: 5,
          },
        ],
      }),
    );

    renderProjectSearch({ onOpenFile, searchFn });
    updateSearchInput("alpha");
    await advanceSearch();

    expect(container?.textContent).toContain("wiki/index.md");
    expect(container?.textContent).toContain("Line 3");
    expect(container?.textContent).toContain("Alpha preview text");

    act(() => {
      requiredButton("Open result").click();
    });

    expect(onOpenFile).toHaveBeenCalledWith("wiki/index.md");
    expect(onOpenFile).toHaveBeenCalledTimes(1);
  });

  it("renders an empty state when a search returns no results", async () => {
    vi.useFakeTimers();
    const searchFn = vi.fn().mockResolvedValue(createSearchResponse({ results: [] }));

    renderProjectSearch({ searchFn });
    updateSearchInput("missing");
    await advanceSearch();

    expect(container?.textContent).toContain("No results");
  });

  it("renders errors and retries the current search", async () => {
    vi.useFakeTimers();
    const searchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("Search service unavailable"))
      .mockResolvedValueOnce(createSearchResponse({ results: [] }));

    renderProjectSearch({ searchFn });
    updateSearchInput("alpha");
    await advanceSearch();

    expect(container?.textContent).toContain("Search service unavailable");
    expect(searchFn).toHaveBeenCalledTimes(1);

    act(() => {
      requiredButton("Retry").click();
    });
    await advanceSearch();

    expect(searchFn).toHaveBeenCalledTimes(2);
  });
});

function renderProjectSearch({
  projectId = "project-1",
  onOpenFile = vi.fn(),
  searchFn = vi.fn(),
}: {
  projectId?: string;
  onOpenFile?: (relativePath: string) => void;
  searchFn?: ComponentProps<typeof ProjectSearch>["searchFn"];
} = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  act(() => {
    root?.render(
      <ProjectSearch
        projectId={projectId}
        onOpenFile={onOpenFile}
        searchFn={searchFn}
        debounceMs={20}
      />,
    );
  });
}

function updateSearchInput(value: string) {
  const input = container?.querySelector("input");

  if (!input) {
    throw new Error("Expected search input.");
  }

  act(() => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    valueSetter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function advanceSearch() {
  await act(async () => {
    vi.advanceTimersByTime(20);
    await Promise.resolve();
  });
}

function createSearchResponse(
  overrides: Partial<ProjectSearchResponse> = {},
): ProjectSearchResponse {
  const results = overrides.results ?? [];

  return {
    query: "alpha",
    results,
    summary: {
      scannedFiles: 4,
      skippedFiles: 0,
      matchedFiles: results.length > 0 ? 1 : 0,
      totalMatches: results.length,
      truncated: false,
      ...overrides.summary,
    },
    ...overrides,
  };
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
