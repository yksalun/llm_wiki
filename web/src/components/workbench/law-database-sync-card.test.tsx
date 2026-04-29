// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { syncLawDatabaseSources } from "@/lib/client/api";

import { LawDatabaseSyncCard } from "./law-database-sync-card";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/client/api", () => ({
  syncLawDatabaseSources: vi.fn(),
}));

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

describe("LawDatabaseSyncCard", () => {
  it("syncs and renders summary counts", async () => {
    vi.mocked(syncLawDatabaseSources).mockResolvedValue({
      ok: true,
      summary: { read: 3, created: 1, updated: 1, skipped: 1, failed: 0 },
      changedFiles: ["raw/sources/database/law/统计法.md"],
      failures: [],
    });

    renderCard();
    await clickButton("同步法规数据库");

    await waitForText("读取 3");
    expect(container?.textContent).toContain("新增 1");
    expect(container?.textContent).toContain("更新 1");
    expect(container?.textContent).toContain("跳过 1");
    expect(container?.textContent).toContain("raw/sources/database/law/统计法.md");
  });

  it("renders safe error messages", async () => {
    vi.mocked(syncLawDatabaseSources).mockRejectedValue(new Error("法规数据库配置不完整。"));

    renderCard();
    await clickButton("同步法规数据库");

    await waitForText("法规数据库配置不完整。");
  });
});

function renderCard() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(<LawDatabaseSyncCard projectId="project-1" />);
  });
}

async function clickButton(name: string) {
  const button = Array.from(container?.querySelectorAll("button") ?? []).find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${name}`);
  }
  await act(async () => {
    button.click();
    await Promise.resolve();
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
