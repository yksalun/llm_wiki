// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { AnswerMetricsPanel } from "./answer-metrics-panel";

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
});

describe("AnswerMetricsPanel", () => {
  it("renders a compact summary and expands stage details", async () => {
    renderPanel({
      version: 1,
      totalDurationMs: 4120,
      stages: [
        { id: "search_wiki", name: "Search wiki", durationMs: 118 },
        {
          id: "model_generation",
          name: "Model generation",
          durationMs: 2600,
          tokenUsage: { inputTokens: 1260, outputTokens: 420, totalTokens: 1680 },
        },
      ],
    });

    expect(container?.textContent).toContain("回答数据");
    expect(container?.textContent).toContain("2 个阶段");
    expect(container?.textContent).toContain("4.1 秒");
    expect(container?.textContent).toContain("1,680 tokens");
    expect(container?.textContent).not.toContain("Search wiki");

    await act(async () => {
      requiredButton("展开回答数据").click();
    });

    expect(container?.textContent).toContain("Search wiki");
    expect(container?.textContent).toContain("118 ms");
    expect(container?.textContent).toContain("输入 1,260");
    expect(container?.textContent).toContain("输出 420");
  });

  it("omits token text when official usage is absent", () => {
    renderPanel({
      version: 1,
      totalDurationMs: 900,
      stages: [{ id: "read_pages", name: "Read pages", durationMs: 900 }],
    });

    expect(container?.textContent).toContain("900 ms");
    expect(container?.textContent).not.toContain("tokens");
  });

  it("renders nothing for malformed metrics", () => {
    renderPanel({
      version: 1,
      totalDurationMs: -1,
      stages: [],
    });

    expect(container?.textContent).toBe("");
  });
});

function renderPanel(metrics: React.ComponentProps<typeof AnswerMetricsPanel>["metrics"]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  act(() => {
    root?.render(<AnswerMetricsPanel metrics={metrics} />);
  });
}

function requiredButton(label: string) {
  const button = container?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

  if (!button) {
    throw new Error(`Expected button: ${label}`);
  }

  return button;
}
