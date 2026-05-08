// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/theme/theme-provider";
import { fetchProjects } from "@/lib/client/api";
import type { ProjectsListResponse } from "@/lib/types";

import { ProjectListPage } from "./project-list-page";

vi.mock("@/lib/client/api", () => ({
  fetchProjects: vi.fn(),
}));

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
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("data-theme");
  window.localStorage.clear();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("ProjectListPage", () => {
  it("renders as a knowledge base dashboard with a route back home", async () => {
    vi.mocked(fetchProjects).mockResolvedValue({
      projects: [
        {
          id: "project-a",
          name: "Alpha",
          status: "ready",
          hasPurpose: true,
          hasSchema: true,
          hasWikiDirectory: true,
          hasRawSourcesDirectory: true,
          updatedAt: null,
        },
      ],
      warnings: [],
    } satisfies ProjectsListResponse);

    await renderProjectListPage();

    expect(container?.textContent).toContain("知识库后台");
    expect(container?.textContent).toContain("返回首页");
    expect(container?.querySelector<HTMLAnchorElement>('a[href="/"]')?.textContent).toContain(
      "返回首页",
    );
    expect(container?.textContent).toContain("1");
    expect(container?.textContent).toContain("Alpha");
  });

  it("renders duplicate registry warnings without duplicate key errors", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    vi.mocked(fetchProjects).mockResolvedValue({
      projects: [],
      warnings: [
        "无法扫描已配置的项目根目录。",
        "无法扫描已配置的项目根目录。",
      ],
    } satisfies ProjectsListResponse);

    await renderProjectListPage();

    expect(container?.textContent).toContain("档案提示");
    expect(container?.textContent).toContain("未找到项目档案");
    expect(
      consoleError.mock.calls.some((call) =>
        call.some((entry) => String(entry).includes("same key")),
      ),
    ).toBe(false);
  });
});

async function renderProjectListPage() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <ThemeProvider>
        <ProjectListPage />
      </ThemeProvider>,
    );
    await Promise.resolve();
  });
}
