// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatMessage } from "./chat-message";

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
  window.localStorage.clear();
});

describe("ChatMessage", () => {
  it("renders assistant answers with standard markdown blocks", () => {
    const html = renderToStaticMarkup(
      <ChatMessage
        projectId="project-a"
        hiddenMessageId={null}
        isLast
        onAnswerAction={vi.fn()}
        message={{
          id: "assistant-a",
          role: "assistant",
          conversationId: "conversation-a",
          timestamp: 1,
          content: [
            "### 小标题",
            "",
            "> 引用内容",
            "",
            "```ts",
            "const answer = true;",
            "```",
            "",
            "| 列 | 值 |",
            "| --- | --- |",
            "| A | B |",
          ].join("\n"),
        }}
      />,
    );

    expect(html).toContain("<h3");
    expect(html).toContain("小标题");
    expect(html).toContain("<blockquote");
    expect(html).toContain("引用内容");
    expect(html).toContain("<pre");
    expect(html).toContain("const answer = true;");
    expect(html).toContain("<table");
    expect(html).toContain("<td");
  });

  it("renders answer metrics by default and hides them when disabled", async () => {
    const message = {
      id: "assistant-metrics",
      role: "assistant" as const,
      conversationId: "conversation-a",
      timestamp: 1,
      content: "Answer",
      metrics: {
        version: 1 as const,
        totalDurationMs: 1200,
        stages: [{ id: "model_generation", name: "Model generation", durationMs: 1200 }],
      },
    };

    renderMessage(message);

    expect(container?.textContent).toContain("回答数据");

    await act(async () => {
      window.localStorage.setItem(
        "llm-wiki-web.preferences.v1",
        JSON.stringify({ showAnswerMetrics: false }),
      );
      window.dispatchEvent(new Event("llm-wiki-web.preferences-change"));
    });

    expect(container?.textContent).not.toContain("回答数据");
  });
});

function renderMessage(message: React.ComponentProps<typeof ChatMessage>["message"]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  act(() => {
    root?.render(
      <ChatMessage
        projectId="project-a"
        hiddenMessageId={null}
        isLast
        onAnswerAction={vi.fn()}
        message={message}
      />,
    );
  });
}
