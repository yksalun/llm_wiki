// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ChatMessage } from "./chat-message";

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
});
