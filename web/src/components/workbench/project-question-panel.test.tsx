// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  DesktopBridgeConversation,
  DesktopBridgeMessage,
  FileReadResult,
} from "@/lib/types";

import { ProjectQuestionPanel } from "./project-question-panel";

vi.mock("@/lib/client/desktop-question-api", () => ({
  createQuestionConversation: vi.fn(),
  listQuestionConversations: vi.fn(),
  listQuestionMessages: vi.fn(),
  streamQuestionMessage: vi.fn(),
}));

vi.mock("@/lib/client/api", () => ({
  fetchProjectFile: vi.fn(),
}));

import { fetchProjectFile } from "@/lib/client/api";
import {
  createQuestionConversation,
  listQuestionConversations,
  listQuestionMessages,
  streamQuestionMessage,
  type StreamQuestionMessageHandlers,
} from "@/lib/client/desktop-question-api";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
  ResizeObserverMock as typeof ResizeObserver;

if (!HTMLElement.prototype.scrollTo) {
  HTMLElement.prototype.scrollTo = vi.fn();
}

const apiMocks = vi.mocked({
  createQuestionConversation,
  fetchProjectFile,
  listQuestionConversations,
  listQuestionMessages,
  streamQuestionMessage,
});

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

describe("ProjectQuestionPanel", () => {
  it("加载桌面端会话和消息历史", async () => {
    const conversation = createConversation({ id: "conv-history", title: "历史会话" });
    apiMocks.listQuestionConversations.mockResolvedValue([conversation]);
    apiMocks.listQuestionMessages.mockResolvedValue([
      createMessage({
        id: "msg-user",
        role: "user",
        content: "schema 在哪里？",
        conversationId: conversation.id,
      }),
      createMessage({
        id: "msg-assistant",
        role: "assistant",
        content: "schema 在 wiki/schema.md。",
        conversationId: conversation.id,
        references: [{ title: "schema.md", path: "wiki/schema.md" }],
      }),
    ]);

    renderProjectQuestionPanel({ projectId: "project/a" });
    await waitForText("schema 在 wiki/schema.md。");

    expect(container?.textContent).toContain("历史会话");
    expect(container?.textContent).toContain("新会话");
    expect(container?.textContent).toContain("项目问答");
    expect(apiMocks.listQuestionConversations).toHaveBeenCalledWith(
      "project/a",
      expect.any(AbortSignal),
    );
    expect(apiMocks.createQuestionConversation).not.toHaveBeenCalled();
    expect(apiMocks.listQuestionMessages).toHaveBeenCalledWith(
      "project/a",
      "conv-history",
      expect.any(AbortSignal),
    );
    expect(container?.textContent).toContain("schema 在哪里？");
    expect(container?.textContent).toContain("wiki/schema.md");
  });

  it("does not render hidden citation comments from assistant messages", async () => {
    const conversation = createConversation({ id: "conv-cited-comment", title: "citations" });
    apiMocks.listQuestionConversations.mockResolvedValue([conversation]);
    apiMocks.listQuestionMessages.mockResolvedValue([
      createMessage({
        id: "msg-hidden-citation",
        role: "assistant",
        content: "Answer body.\n\n<!-- cited: 1, 3 -->",
        conversationId: conversation.id,
        references: [{ title: "schema.md", path: "wiki/schema.md" }],
      }),
    ]);

    renderProjectQuestionPanel();
    await waitForText("Answer body.");

    expect(document.body.textContent).not.toContain("<!-- cited:");
    expect(document.body.textContent).not.toContain("cited: 1, 3");
  });

  it("没有会话时创建新会话，并可通过新会话按钮切换", async () => {
    const initialConversation = createConversation({ id: "conv-created", title: "新建会话" });
    const nextConversation = createConversation({ id: "conv-next", title: "第二会话" });
    apiMocks.listQuestionConversations.mockResolvedValue([]);
    apiMocks.createQuestionConversation
      .mockResolvedValueOnce(initialConversation)
      .mockResolvedValueOnce(nextConversation);
    apiMocks.listQuestionMessages
      .mockResolvedValueOnce([
        createMessage({
          content: "初始历史",
          conversationId: initialConversation.id,
        }),
      ])
      .mockResolvedValueOnce([
        createMessage({
          content: "第二段历史",
          conversationId: nextConversation.id,
        }),
      ]);

    renderProjectQuestionPanel();
    await waitForText("初始历史");

    await clickButton("新会话");
    await waitForText("第二段历史");

    expect(apiMocks.createQuestionConversation).toHaveBeenCalledTimes(2);
    expect(apiMocks.listQuestionMessages).toHaveBeenLastCalledWith(
      "project-1",
      "conv-next",
      expect.any(AbortSignal),
    );
    expect(container?.textContent).not.toContain("初始历史");
  });

  it("发送消息时展示流式回答和引用，并点击引用打开文件", async () => {
    const onOpenFile = vi.fn();
    const conversation = createConversation({ id: "conv-stream" });
    const reference = { title: "schema.md", path: "wiki/schema.md" };
    apiMocks.listQuestionConversations.mockResolvedValue([conversation]);
    apiMocks.listQuestionMessages.mockResolvedValue([]);
    apiMocks.streamQuestionMessage.mockImplementation(
      async (_projectId, _conversationId, _message, handlers) => {
        handlers.onToken("## 结论\n\n");
        handlers.onToken("- schema 在这里");
        handlers.onReferences([reference]);
        await Promise.resolve();
        handlers.onDone(
          createMessage({
            id: "assistant-final",
            role: "assistant",
            content: "## 结论\n\n- schema 在这里",
            conversationId: conversation.id,
            references: [reference],
          }),
        );
      },
    );

    renderProjectQuestionPanel({ onOpenFile });
    await waitForReady();
    updateQuestion("schema 在哪里？");

    await clickButton("发送");
    await waitForText("schema 在这里");

    expect(apiMocks.streamQuestionMessage).toHaveBeenCalledWith(
      "project-1",
      "conv-stream",
      "schema 在哪里？",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(container?.textContent).toContain("schema 在哪里？");
    expect(container?.textContent).toContain("schema.md");
    expect(container?.textContent).toContain("wiki/schema.md");
    const headings = Array.from(container?.querySelectorAll("h2") ?? []).map(
      (node) => node.textContent,
    );
    expect(headings).toContain("结论");

    apiMocks.fetchProjectFile.mockResolvedValue(
      createFile({
        relativePath: "wiki/schema.md",
        content: "# Schema\n\nDesktop bridge reference body.",
      }),
    );

    await clickButtonContaining("schema.md");
    await waitForText("Desktop bridge reference body.");

    expect(apiMocks.fetchProjectFile).toHaveBeenCalledWith(
      "project-1",
      "wiki/schema.md",
      expect.any(AbortSignal),
    );
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("切换会话时清空 composer 草稿，避免发送到新会话", async () => {
    const firstConversation = createConversation({ id: "conv-first", title: "第一会话" });
    const secondConversation = createConversation({ id: "conv-second", title: "第二会话" });
    apiMocks.listQuestionConversations.mockResolvedValue([firstConversation, secondConversation]);
    apiMocks.listQuestionMessages
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        createMessage({
          id: "second-history",
          content: "第二会话历史",
          conversationId: secondConversation.id,
        }),
      ]);

    renderProjectQuestionPanel();
    await waitForReady();
    updateQuestion("不应该发送的旧草稿");

    expect(questionTextarea().value).toBe("不应该发送的旧草稿");

    await clickButton("第二会话");
    await waitForText("第二会话历史");

    expect(questionTextarea().value).toBe("");

    await clickButton("发送");

    expect(apiMocks.streamQuestionMessage).not.toHaveBeenCalled();
  });

  it("加载状态下不会通过发送按钮清空未发送草稿", async () => {
    const initialConversation = createConversation({ id: "conv-initial", title: "当前会话" });
    const nextConversation = createConversation({ id: "conv-loading", title: "加载中会话" });
    const pendingMessages = createDeferred<DesktopBridgeMessage[]>();
    apiMocks.listQuestionConversations.mockResolvedValue([initialConversation]);
    apiMocks.createQuestionConversation.mockResolvedValue(nextConversation);
    apiMocks.listQuestionMessages.mockResolvedValueOnce([]).mockReturnValueOnce(pendingMessages.promise);

    renderProjectQuestionPanel();
    await waitForReady();
    updateQuestion("加载时保留的草稿");

    await clickButton("新会话");
    await waitForText("正在加载项目问答");
    await clickButton("发送");

    expect(questionTextarea().value).toBe("加载时保留的草稿");
    expect(apiMocks.streamQuestionMessage).not.toHaveBeenCalled();
  });

  it("项目切换时 abort 流请求，并防止旧请求污染当前项目", async () => {
    const firstConversation = createConversation({ id: "conv-a" });
    const secondConversation = createConversation({ id: "conv-b" });
    let firstHandlers: StreamQuestionMessageHandlers | undefined;
    const firstStream = createDeferred<void>();

    apiMocks.listQuestionConversations
      .mockResolvedValueOnce([firstConversation])
      .mockResolvedValueOnce([secondConversation]);
    apiMocks.listQuestionMessages
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        createMessage({
          id: "project-b-history",
          content: "项目 B 历史",
          conversationId: secondConversation.id,
        }),
      ]);
    apiMocks.streamQuestionMessage.mockImplementation((_projectId, _conversationId, _message, handlers) => {
      firstHandlers = handlers;
      return firstStream.promise;
    });

    const { rerender } = renderProjectQuestionPanel({ projectId: "project-a" });
    await waitForReady();
    updateQuestion("项目 A 问题");
    await clickButton("发送");

    const staleHandlers = requireStreamHandlers(firstHandlers);

    expect(staleHandlers.signal?.aborted).toBe(false);

    rerender({ projectId: "project-b" });
    await waitForText("项目 B 历史");

    expect(staleHandlers.signal?.aborted).toBe(true);

    act(() => {
      staleHandlers.onToken("项目 A 旧回答");
      staleHandlers.onDone(
        createMessage({
          role: "assistant",
          content: "项目 A 完整旧回答",
          conversationId: firstConversation.id,
        }),
      );
    });

    expect(container?.textContent).toContain("项目 B 历史");
    expect(container?.textContent).not.toContain("项目 A 旧回答");
    expect(container?.textContent).not.toContain("项目 A 完整旧回答");
  });

  it("marks the active conversation item", async () => {
    const firstConversation = createConversation({ id: "conv-first", title: "conversation-first" });
    const secondConversation = createConversation({ id: "conv-second", title: "conversation-second" });
    apiMocks.listQuestionConversations.mockResolvedValue([firstConversation, secondConversation]);
    apiMocks.listQuestionMessages.mockResolvedValue([]);

    renderProjectQuestionPanel();
    await waitForReady();

    expect(requiredButton("conversation-first").getAttribute("aria-current")).toBe("true");
    expect(requiredButton("conversation-second").getAttribute("aria-current")).toBeNull();
  });

  it("aligns user messages to the right and assistant messages to the left", async () => {
    const conversation = createConversation({ id: "conv-layout", title: "layout conversation" });
    apiMocks.listQuestionConversations.mockResolvedValue([conversation]);
    apiMocks.listQuestionMessages.mockResolvedValue([
      createMessage({
        id: "msg-user-layout",
        role: "user",
        content: "user layout message",
        conversationId: conversation.id,
      }),
      createMessage({
        id: "msg-assistant-layout",
        role: "assistant",
        content: "assistant layout message",
        conversationId: conversation.id,
      }),
    ]);

    renderProjectQuestionPanel();
    await waitForText("assistant layout message");

    const userMessage = requiredMessage("user layout message");
    const assistantMessage = requiredMessage("assistant layout message");

    expect(userMessage.dataset.messageRole).toBe("user");
    expect(userMessage.dataset.messageAlign).toBe("right");
    expect(assistantMessage.dataset.messageRole).toBe("assistant");
    expect(assistantMessage.dataset.messageAlign).toBe("left");
  });

  it("shows a Sheet error when a referenced file cannot be loaded", async () => {
    const onOpenFile = vi.fn();
    const conversation = createConversation({ id: "conv-preview-error", title: "preview error" });
    apiMocks.listQuestionConversations.mockResolvedValue([conversation]);
    apiMocks.listQuestionMessages.mockResolvedValue([
      createMessage({
        id: "msg-preview-error",
        role: "assistant",
        content: "The answer references a missing page.",
        conversationId: conversation.id,
        references: [{ title: "missing.md", path: "wiki/missing.md" }],
      }),
    ]);
    apiMocks.fetchProjectFile.mockRejectedValue(new Error("File not found"));

    renderProjectQuestionPanel({ onOpenFile });
    await waitForText("The answer references a missing page.");

    await clickButtonContaining("missing.md");
    await waitForText("File not found");

    expect(apiMocks.fetchProjectFile).toHaveBeenCalledWith(
      "project-1",
      "wiki/missing.md",
      expect.any(AbortSignal),
    );
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("collapses long assistant reference lists by default and can expand them", async () => {
    const onOpenFile = vi.fn();
    const conversation = createConversation({ id: "conv-references", title: "references" });
    apiMocks.listQuestionConversations.mockResolvedValue([conversation]);
    apiMocks.listQuestionMessages.mockResolvedValue([
      createMessage({
        id: "msg-with-references",
        role: "assistant",
        content: "assistant references message",
        conversationId: conversation.id,
        references: [
          { title: "引用 1", path: "wiki/ref-1.md" },
          { title: "引用 2", path: "wiki/ref-2.md" },
          { title: "引用 3", path: "wiki/ref-3.md" },
          { title: "引用 4", path: "wiki/ref-4.md" },
          { title: "引用 5", path: "wiki/ref-5.md" },
        ],
      }),
    ]);

    renderProjectQuestionPanel({ onOpenFile });
    await waitForText("assistant references message");

    expect(document.body.textContent).toContain("引用 5 个文件");
    expect(document.body.textContent).not.toContain("wiki/ref-5.md");

    await clickButtonContaining("引用 5 个文件");

    expect(document.body.textContent).toContain("wiki/ref-1.md");
    expect(document.body.textContent).toContain("wiki/ref-5.md");

    apiMocks.fetchProjectFile.mockResolvedValue(
      createFile({
        relativePath: "wiki/ref-5.md",
        content: "# Ref 5\n\nExpanded reference file.",
      }),
    );

    await clickButtonContaining("引用 5");
    await waitForText("Expanded reference file.");

    expect(onOpenFile).not.toHaveBeenCalled();
  });
});

function renderProjectQuestionPanel({
  projectId = "project-1",
  onOpenFile = vi.fn(),
}: {
  projectId?: string;
  onOpenFile?: (relativePath: string) => void;
} = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  act(() => {
    root?.render(<ProjectQuestionPanel projectId={projectId} onOpenFile={onOpenFile} />);
  });

  return {
    rerender(nextProps: {
      projectId?: string;
      onOpenFile?: (relativePath: string) => void;
    }) {
      act(() => {
        root?.render(
          <ProjectQuestionPanel
            projectId={nextProps.projectId ?? projectId}
            onOpenFile={nextProps.onOpenFile ?? onOpenFile}
          />,
        );
      });
    },
  };
}

function updateQuestion(value: string) {
  const textarea = questionTextarea();

  act(() => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")
      ?.set;
    valueSetter?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function questionTextarea() {
  const textarea = container?.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="项目问答输入"]',
  );

  if (!textarea) {
    throw new Error("Expected question textarea.");
  }

  return textarea;
}

async function clickButton(name: string) {
  await act(async () => {
    requiredButton(name).click();
    await Promise.resolve();
  });
}

async function clickButtonContaining(text: string) {
  await act(async () => {
    const button = Array.from(container?.querySelectorAll("button") ?? []).find((candidate) =>
      candidate.textContent?.includes(text),
    );

    if (!button) {
      throw new Error(`Expected button containing ${text}.`);
    }

    button.click();
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

function requiredMessage(text: string) {
  const message = Array.from(
    container?.querySelectorAll<HTMLElement>("[data-message-role]") ?? [],
  ).find((candidate) => candidate.textContent?.includes(text));

  if (!message) {
    throw new Error(`Expected message containing ${text}.`);
  }

  return message;
}

async function waitForReady() {
  await waitFor(() => {
    expect(questionTextarea().disabled).toBe(false);
  });
}

async function waitForText(text: string) {
  await waitFor(() => {
    expect(container?.textContent).toContain(text);
  });
}

async function waitFor(assertion: () => void) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await act(async () => {
      await Promise.resolve();
    });

    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  throw lastError;
}

function createConversation(
  overrides: Partial<DesktopBridgeConversation> = {},
): DesktopBridgeConversation {
  return {
    id: "conv-1",
    title: "默认会话",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function createMessage(overrides: Partial<DesktopBridgeMessage> = {}): DesktopBridgeMessage {
  return {
    id: "msg-1",
    role: "assistant",
    content: "默认消息",
    timestamp: 1,
    conversationId: "conv-1",
    ...overrides,
  };
}

function createFile(overrides: Partial<FileReadResult> = {}): FileReadResult {
  return {
    relativePath: "wiki/schema.md",
    mode: "preview",
    content: "# Schema\n\nReference file body.",
    editable: false,
    size: 31,
    lastModified: "2026-05-01T00:00:00.000Z",
    metadata: {},
    ...overrides,
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

function requireStreamHandlers(
  handlers: StreamQuestionMessageHandlers | undefined,
): StreamQuestionMessageHandlers {
  if (!handlers) {
    throw new Error("Expected stream handlers.");
  }

  return handlers;
}
