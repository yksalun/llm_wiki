// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatHomePage } from "./chat-home-page";

vi.mock("@/lib/client/api", () => ({
  fetchProjects: vi.fn(),
}));

vi.mock("@/lib/client/desktop-question-api", () => ({
  createQuestionConversation: vi.fn(),
  listQuestionConversations: vi.fn(),
  listQuestionMessages: vi.fn(),
  saveQuestionAnswerToWiki: vi.fn(),
  streamRegenerateQuestionAnswer: vi.fn(),
  streamQuestionMessage: vi.fn(),
}));

vi.mock("@/components/theme/theme-toggle", () => ({
  ThemeToggle: () => <button type="button">Theme</button>,
}));

import { fetchProjects } from "@/lib/client/api";
import {
  createQuestionConversation,
  listQuestionConversations,
  listQuestionMessages,
  streamQuestionMessage,
  type StreamQuestionMessageHandlers,
} from "@/lib/client/desktop-question-api";

const desktopMocks = vi.mocked({
  createQuestionConversation,
  listQuestionConversations,
  listQuestionMessages,
  streamQuestionMessage,
});

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
  vi.resetAllMocks();
});

describe("ChatHomePage", () => {
  it("renders the chat home shell and project configuration entry", async () => {
    vi.mocked(fetchProjects).mockResolvedValue({
      projects: [],
      warnings: [],
    });

    await renderChatHomePage();

    expect(container?.textContent).toContain("新会话");
    expect(container?.textContent).toContain("知识库配置");
    expect(container?.textContent).toContain("选择知识库");
    expect(container?.textContent).toContain("暂无知识库，请先打开知识库配置添加项目。");
  });

  it("centers the empty home composer while the page shell owns the viewport", async () => {
    vi.mocked(fetchProjects).mockResolvedValue({
      projects: [],
      warnings: [],
    });

    await renderChatHomePage();

    const shell = container?.querySelector<HTMLElement>("main");
    expect(shell?.className.split(/\s+/)).toContain("h-screen");
    expect(shell?.className).toContain("overflow-hidden");
    expect(shell?.className).not.toContain("min-h-screen");

    const sidebar = container?.querySelector<HTMLElement>("aside");
    expect(sidebar?.className.split(/\s+/)).toContain("h-screen");

    const chatScrollArea = container?.querySelector<HTMLElement>('[data-chat-home-scroll-area="true"]');
    expect(chatScrollArea?.className).toContain("overflow-hidden");
    expect(chatScrollArea?.className).toContain("flex-1");

    const chatExperience = container?.querySelector<HTMLElement>('[data-chat-experience="home"]');
    expect(chatExperience?.className).toContain("max-w-none");
    expect(chatExperience?.className).toContain("h-full");
    expect(chatExperience?.className).toContain("bg-transparent");
    expect(chatExperience?.className).not.toContain("bg-[color:var(--paper-panel)]");
    expect(chatExperience?.parentElement?.className).toContain("justify-center");
    expect(chatExperience?.parentElement?.className).toContain("pr-0");
    expect(chatExperience?.parentElement?.className).toContain("md:pr-0");

    const composer = container?.querySelector<HTMLElement>('[data-chat-composer="home"]');
    expect(composer?.getAttribute("data-chat-composer-state")).toBe("empty");
    expect(composer?.className).not.toContain("fixed");
    expect(composer?.className).not.toContain("bottom-0");

    const textarea = requiredQuestionTextarea();
    expect(textarea.className).toContain("border");
    expect(textarea.className).not.toContain("border-0");
  });

  it("selects a knowledge base and sends through shared streaming API", async () => {
    let handlers: StreamQuestionMessageHandlers | undefined;
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
    });
    desktopMocks.listQuestionConversations.mockResolvedValue([
      { id: "conv-a", title: "New Conversation", createdAt: 1, updatedAt: 1 },
    ]);
    desktopMocks.listQuestionMessages.mockResolvedValue([]);
    desktopMocks.createQuestionConversation.mockResolvedValue({
      id: "conv-a",
      title: "New Conversation",
      createdAt: 1,
      updatedAt: 1,
    });
    desktopMocks.streamQuestionMessage.mockImplementation(
      async (_projectId, _conversationId, _message, nextHandlers) => {
        handlers = nextHandlers;
      },
    );

    await renderChatHomePage();
    await selectKnowledgeBase("Alpha");
    await waitForText("询问这个知识库");
    updateQuestion("What is inside?");
    await waitForCondition(() => !requiredButton("发送").disabled);
    await clickButton("发送");

    expect(desktopMocks.createQuestionConversation).toHaveBeenCalledWith(
      "project-a",
      expect.any(AbortSignal),
    );
    expect(desktopMocks.streamQuestionMessage).toHaveBeenCalledWith(
      "project-a",
      "conv-a",
      "What is inside?",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    act(() => {
      handlers?.onDone({
        id: "assistant-home",
        role: "assistant",
        content: "Home answer.",
        timestamp: 2,
        conversationId: "conv-a",
      });
    });

    await waitForText("Home answer.");

    const answerMessage = container?.querySelector<HTMLElement>('[data-answer-message="true"]');
    expect(answerMessage?.className).not.toContain("bg-[color:var(--paper-muted)]");
    expect(answerMessage?.className).not.toContain("border-[color:var(--paper-border)]");

    const composer = container?.querySelector<HTMLElement>('[data-chat-composer="home"]');
    expect(composer?.getAttribute("data-chat-composer-state")).toBe("active");
    expect(composer?.className).toContain("shrink-0");
    expect(composer?.className).not.toContain("fixed");
    expect(composer?.className).not.toContain("bottom-0");

    const viewport = container?.querySelector<HTMLElement>('[data-chat-message-viewport="home"]');
    expect(viewport?.className).toContain("flex-1");
    expect(viewport?.className).toContain("overflow-y-auto");
    expect(viewport?.className).toContain("chat-home-message-scrollbar");
    expect(viewport?.className).toContain("max-w-none");
    expect(viewport?.className).toContain("mr-0");
    expect(viewport?.className).toContain("pl-0");
    expect(viewport?.className).toContain("pr-0");

    const messageRail = container?.querySelector<HTMLElement>('[data-chat-message-rail="home"]');
    expect(messageRail?.className).toContain("mx-auto");
    expect(messageRail?.className).toContain("max-w-3xl");

    const spacer = container?.querySelector<HTMLElement>('[data-chat-composer-spacer="home"]');
    expect(spacer).toBeNull();
  });

  it("persists the answer metrics preference from personal center", async () => {
    window.localStorage.setItem(
      "llm-wiki-web.chat.home.v1",
      JSON.stringify({
        sidebarCollapsed: false,
        selectedProjectId: "project-a",
        selectedConversationId: "conv-a",
        recentConversations: [
          {
            projectId: "project-a",
            projectName: "Alpha",
            conversationId: "conv-a",
            title: "New Conversation",
            updatedAt: 1,
          },
        ],
      }),
    );
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
    });
    desktopMocks.listQuestionConversations.mockResolvedValue([
      { id: "conv-a", title: "New Conversation", createdAt: 1, updatedAt: 1 },
    ]);
    desktopMocks.listQuestionMessages.mockResolvedValue([
      {
        id: "assistant-metrics",
        role: "assistant",
        content: "Answer with metrics.",
        timestamp: 2,
        conversationId: "conv-a",
        metrics: {
          version: 1,
          totalDurationMs: 1200,
          stages: [
            { id: "model_generation", name: "Model generation", durationMs: 1200 },
          ],
        },
      },
    ]);

    await renderChatHomePage();
    await waitForText("Answer with metrics.");
    expect(container?.querySelector('[data-answer-metrics="true"]')).not.toBeNull();

    await act(async () => {
      requiredPersonalCenterTrigger().click();
      await Promise.resolve();
    });

    const switchButton = requiredAnswerMetricsSwitch();
    expect(switchButton.getAttribute("aria-checked")).toBe("true");

    await act(async () => {
      switchButton.click();
      await Promise.resolve();
    });

    expect(window.localStorage.getItem("llm-wiki-web.preferences.v1")).toBe(
      JSON.stringify({ showAnswerMetrics: false }),
    );
    expect(container?.querySelector('[data-answer-metrics="true"]')).toBeNull();
  });

  it("hydrates recent chats from desktop conversation history", async () => {
    window.localStorage.setItem(
      "llm-wiki-web.chat.home.v1",
      JSON.stringify({
        sidebarCollapsed: false,
        selectedProjectId: "project-a",
        selectedConversationId: null,
        recentConversations: [],
      }),
    );
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
    });
    desktopMocks.listQuestionConversations.mockResolvedValue([
      { id: "conv-a", title: "First restored chat", createdAt: 1, updatedAt: 2 },
      { id: "conv-b", title: "Second restored chat", createdAt: 1, updatedAt: 1 },
    ]);
    desktopMocks.listQuestionMessages.mockResolvedValue([]);

    await renderChatHomePage();

    await waitForText("First restored chat");
    await waitForText("Second restored chat");
    expect(window.localStorage.getItem("llm-wiki-web.chat.home.v1")).toContain(
      "First restored chat",
    );
  });

  it("starts a new home chat from the sidebar for the selected knowledge base", async () => {
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
    });
    desktopMocks.listQuestionConversations.mockResolvedValue([
      { id: "conv-a", title: "First chat", createdAt: 1, updatedAt: 1 },
    ]);
    desktopMocks.listQuestionMessages.mockResolvedValue([]);
    desktopMocks.createQuestionConversation.mockResolvedValue({
      id: "conv-new",
      title: "New chat",
      createdAt: 3,
      updatedAt: 3,
    });

    await renderChatHomePage();
    await selectKnowledgeBase("Alpha");
    await clickDesktopNewConversation();

    await waitForCondition(() =>
      desktopMocks.createQuestionConversation.mock.calls.some(
        ([projectId]) => projectId === "project-a",
      ),
    );
    expect(desktopMocks.createQuestionConversation).toHaveBeenCalledWith(
      "project-a",
      expect.any(AbortSignal),
    );
    expect(desktopMocks.listQuestionMessages).toHaveBeenLastCalledWith(
      "project-a",
      "conv-new",
      expect.any(AbortSignal),
    );
    expect(container?.querySelector('[aria-current="true"]')?.textContent).toContain("New chat");
  });

  it("switches the home chat to the selected recent conversation", async () => {
    window.localStorage.setItem(
      "llm-wiki-web.chat.home.v1",
      JSON.stringify({
        sidebarCollapsed: false,
        selectedProjectId: "project-a",
        selectedConversationId: "conv-a",
        recentConversations: [
          {
            projectId: "project-a",
            projectName: "Alpha",
            conversationId: "conv-a",
            title: "First chat",
            updatedAt: 2,
          },
          {
            projectId: "project-a",
            projectName: "Alpha",
            conversationId: "conv-b",
            title: "Second chat",
            updatedAt: 1,
          },
        ],
      }),
    );
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
    });
    desktopMocks.listQuestionConversations.mockResolvedValue([
      { id: "conv-a", title: "First chat", createdAt: 1, updatedAt: 2 },
      { id: "conv-b", title: "Second chat", createdAt: 1, updatedAt: 1 },
    ]);
    desktopMocks.listQuestionMessages.mockImplementation(
      async (_projectId, conversationId) =>
        conversationId === "conv-b"
          ? [
              {
                id: "message-b",
                role: "assistant",
                content: "Second answer.",
                timestamp: 2,
                conversationId: "conv-b",
              },
            ]
          : [
              {
                id: "message-a",
                role: "assistant",
                content: "First answer.",
                timestamp: 1,
                conversationId: "conv-a",
              },
            ],
    );

    await renderChatHomePage();
    await waitForText("First answer.");

    const selectedBefore = container?.querySelector<HTMLElement>('[aria-current="true"]');
    expect(selectedBefore?.textContent).toContain("First chat");

    await clickButtonContaining("Second chat");

    expect(desktopMocks.listQuestionMessages).toHaveBeenLastCalledWith(
      "project-a",
      "conv-b",
      expect.any(AbortSignal),
    );
    await waitForText("Second answer.");

    const selectedAfter = container?.querySelector<HTMLElement>('[aria-current="true"]');
    expect(selectedAfter?.textContent).toContain("Second chat");
    expect(selectedAfter?.className).toContain("border-[color:var(--ring)]");
    expect(selectedAfter?.className).toContain("font-semibold");
  });

  it("deletes a recent conversation from the sidebar after confirmation", async () => {
    window.localStorage.setItem(
      "llm-wiki-web.chat.home.v1",
      JSON.stringify({
        sidebarCollapsed: false,
        selectedProjectId: "project-a",
        selectedConversationId: "conv-a",
        recentConversations: [
          {
            projectId: "project-a",
            projectName: "Alpha",
            conversationId: "conv-a",
            title: "First chat",
            updatedAt: 2,
          },
          {
            projectId: "project-a",
            projectName: "Alpha",
            conversationId: "conv-b",
            title: "Second chat",
            updatedAt: 1,
          },
        ],
      }),
    );
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
    });
    desktopMocks.listQuestionConversations.mockResolvedValue([
      { id: "conv-a", title: "First chat", createdAt: 1, updatedAt: 2 },
      { id: "conv-b", title: "Second chat", createdAt: 1, updatedAt: 1 },
    ]);
    desktopMocks.listQuestionMessages.mockImplementation(
      async (_projectId, conversationId) =>
        conversationId === "conv-b"
          ? [
              {
                id: "message-b",
                role: "assistant",
                content: "Second answer.",
                timestamp: 2,
                conversationId: "conv-b",
              },
            ]
          : [
              {
                id: "message-a",
                role: "assistant",
                content: "First answer.",
                timestamp: 1,
                conversationId: "conv-a",
              },
            ],
    );

    await renderChatHomePage();
    await waitForText("First answer.");

    const menuTrigger = requiredButtonByLabel("打开 First chat 菜单");
    expect(menuTrigger.className).toContain("opacity-0");
    expect(menuTrigger.className).toContain("group-hover/recent:opacity-100");

    await clickElement(menuTrigger);
    await clickElement(requiredElementContaining("删除"));
    await waitForDocumentText("删除聊天记录");
    await waitForDocumentText("First chat");
    await clickElement(requiredButtonFromDocument("确认删除"));

    await waitForCondition(() => !requiredDesktopSidebar().textContent?.includes("First chat"));
    expect(requiredDesktopSidebar().textContent).toContain("Second chat");
    expect(container?.querySelector('[aria-current="true"]')).toBeNull();

    const composer = container?.querySelector<HTMLElement>('[data-chat-composer="home"]');
    expect(composer?.getAttribute("data-chat-composer-state")).toBe("empty");
    expect(requiredQuestionTextarea().disabled).toBe(false);
    expect(desktopMocks.createQuestionConversation).not.toHaveBeenCalled();

    await clickButtonContaining("Second chat");
    await waitForText("Second answer.");
    expect(requiredDesktopSidebar().textContent).not.toContain("First chat");
    expect(requiredDesktopSidebar().textContent).not.toContain("New Conversation");
  });

  it("renames a recent conversation from the sidebar menu", async () => {
    window.localStorage.setItem(
      "llm-wiki-web.chat.home.v1",
      JSON.stringify({
        sidebarCollapsed: false,
        selectedProjectId: "project-a",
        selectedConversationId: "conv-a",
        recentConversations: [
          {
            projectId: "project-a",
            projectName: "Alpha",
            conversationId: "conv-a",
            title: "First chat",
            updatedAt: 2,
          },
        ],
      }),
    );
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
    });
    desktopMocks.listQuestionConversations.mockResolvedValue([
      { id: "conv-a", title: "First chat", createdAt: 1, updatedAt: 2 },
    ]);
    desktopMocks.listQuestionMessages.mockResolvedValue([
      {
        id: "message-a",
        role: "assistant",
        content: "First answer.",
        timestamp: 1,
        conversationId: "conv-a",
      },
    ]);

    await renderChatHomePage();
    await waitForText("First answer.");

    const menuTrigger = requiredButtonByLabel("打开 First chat 菜单");
    const historyItem = menuTrigger.closest<HTMLElement>('[data-chat-history-item="true"]');
    expect(historyItem?.textContent).toContain("First chat");
    expect(historyItem?.className).toContain("group/recent");
    expect(menuTrigger.className).toContain("cursor-pointer");

    await clickElement(menuTrigger);
    await clickElement(requiredElementContaining("重命名"));
    await waitForDocumentText("重命名聊天");

    updateInput(requiredInputByLabel("聊天名称"), "Renamed chat");
    await clickElement(requiredButtonFromDocument("确认重命名"));

    await waitForCondition(() => requiredDesktopSidebar().textContent?.includes("Renamed chat") === true);
    expect(requiredDesktopSidebar().textContent).not.toContain("First chat");
  });

  it("searches recent conversations by title from the sidebar top action", async () => {
    window.localStorage.setItem(
      "llm-wiki-web.chat.home.v1",
      JSON.stringify({
        sidebarCollapsed: false,
        selectedProjectId: "project-a",
        selectedConversationId: null,
        recentConversations: [
          {
            projectId: "project-a",
            projectName: "Alpha",
            conversationId: "conv-a",
            title: "First chat",
            updatedAt: 2,
          },
          {
            projectId: "project-a",
            projectName: "Alpha",
            conversationId: "conv-b",
            title: "Second chat",
            updatedAt: 1,
          },
        ],
      }),
    );
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
    });
    desktopMocks.listQuestionConversations.mockResolvedValue([
      { id: "conv-a", title: "First chat", createdAt: 1, updatedAt: 2 },
      { id: "conv-b", title: "Second chat", createdAt: 1, updatedAt: 1 },
    ]);
    desktopMocks.listQuestionMessages.mockImplementation(
      async (_projectId, conversationId) =>
        conversationId === "conv-b"
          ? [
              {
                id: "message-b",
                role: "assistant",
                content: "Second answer.",
                timestamp: 2,
                conversationId: "conv-b",
              },
            ]
          : [],
    );

    await renderChatHomePage();
    await waitForText("First chat");

    const collapseButton = requiredButtonByLabel("收起侧边栏");
    const searchButton = requiredButtonByLabel("搜索历史记录");
    expect(collapseButton.parentElement?.className).toContain("justify-between");
    expect(collapseButton.textContent).not.toContain("收起");
    expect(collapseButton.className).toContain("cursor-pointer");
    expect(searchButton.className).toContain("cursor-pointer");

    await clickElement(searchButton);
    await waitForDocumentText("搜索历史记录");
    updateInput(requiredInputByLabel("搜索历史记录"), "Second");

    const results = requiredHistorySearchResults();
    expect(results.textContent).toContain("Second chat");
    expect(results.textContent).not.toContain("First chat");

    await clickElement(requiredHistorySearchResult("Second chat"));
    await waitForText("Second answer.");
    expect(container?.querySelector('[aria-current="true"]')?.textContent).toContain("Second chat");
  });

  it("keeps a stored selected conversation when the API returns another conversation first", async () => {
    window.localStorage.setItem(
      "llm-wiki-web.chat.home.v1",
      JSON.stringify({
        sidebarCollapsed: false,
        selectedProjectId: "project-a",
        selectedConversationId: "conv-b",
        recentConversations: [
          {
            projectId: "project-a",
            projectName: "Alpha",
            conversationId: "conv-b",
            title: "Stored chat",
            updatedAt: 2,
          },
        ],
      }),
    );
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
    });
    desktopMocks.listQuestionConversations.mockResolvedValue([
      { id: "conv-a", title: "First API chat", createdAt: 1, updatedAt: 1 },
      { id: "conv-b", title: "Stored chat", createdAt: 1, updatedAt: 2 },
    ]);
    desktopMocks.listQuestionMessages.mockImplementation(
      async (_projectId, conversationId) =>
        conversationId === "conv-b"
          ? [
              {
                id: "stored-message",
                role: "assistant",
                content: "Stored answer.",
                timestamp: 2,
                conversationId: "conv-b",
              },
            ]
          : [
              {
                id: "first-message",
                role: "assistant",
                content: "First API answer.",
                timestamp: 1,
                conversationId: "conv-a",
              },
            ],
    );

    await renderChatHomePage();

    await waitForText("Stored answer.");
    expect(desktopMocks.listQuestionMessages).toHaveBeenLastCalledWith(
      "project-a",
      "conv-b",
      expect.any(AbortSignal),
    );
    expect(container?.querySelector('[aria-current="true"]')?.textContent).toContain("Stored chat");
  });

  it("shows a disabled composer before a knowledge base is selected", async () => {
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
    });

    await renderChatHomePage();
    await waitForText("询问这个知识库");

    const textarea = requiredQuestionTextarea();
    expect(textarea.disabled).toBe(true);
    expect(requiredButton("发送").disabled).toBe(true);
  });

  it("shows a Chinese knowledge base load error and config entry", async () => {
    vi.mocked(fetchProjects).mockRejectedValue(new Error("project roots missing"));

    await renderChatHomePage();
    await waitForText("无法加载知识库：project roots missing");
    await waitForText("打开知识库配置");
  });

  it("keeps home question status alerts aligned to the composer width", async () => {
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
    });
    desktopMocks.listQuestionConversations.mockRejectedValue(
      new Error("桌面端 Bridge 暂不可用，请确认桌面应用已启动。"),
    );

    await renderChatHomePage();
    await selectKnowledgeBase("Alpha");
    await waitForText("问答失败");

    const alertRail = container?.querySelector<HTMLElement>('[data-chat-status-rail="home"]');
    expect(alertRail?.className).toContain("mx-auto");
    expect(alertRail?.className).toContain("max-w-3xl");
    expect(alertRail?.className).toContain("w-full");
    expect(alertRail?.textContent).toContain("桌面端 Bridge 暂不可用");
  });

  it("shows unavailable recent chats when the stored project is gone", async () => {
    window.localStorage.setItem(
      "llm-wiki-web.chat.home.v1",
      JSON.stringify({
        sidebarCollapsed: false,
        selectedProjectId: "missing-project",
        recentConversations: [
          {
            projectId: "missing-project",
            projectName: "Missing",
            conversationId: "conv-missing",
            title: "Old chat",
            updatedAt: 1,
          },
        ],
      }),
    );
    vi.mocked(fetchProjects).mockResolvedValue({ projects: [], warnings: [] });

    await renderChatHomePage();
    await waitForText("Old chat");
    await waitForText("不可用");
  });
});

async function renderChatHomePage() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(<ChatHomePage />);
    await Promise.resolve();
  });
}

function updateQuestion(value: string) {
  const textarea = requiredQuestionTextarea();

  act(() => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")
      ?.set;
    valueSetter?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function updateInput(input: HTMLInputElement, value: string) {
  act(() => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
      ?.set;
    valueSetter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function requiredQuestionTextarea() {
  const textarea = container?.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="知识库问答输入"]',
  );

  if (!textarea) {
    throw new Error("Expected chat textarea.");
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
    requiredButtonContaining(text).click();
    await Promise.resolve();
  });
}

async function clickDesktopNewConversation() {
  await act(async () => {
    requiredDesktopNewConversationButton().click();
    await Promise.resolve();
  });
}

function requiredDesktopNewConversationButton() {
  const button = Array.from(
    requiredDesktopSidebar().querySelectorAll<HTMLButtonElement>("button"),
  ).find((candidate) => candidate.textContent?.includes("新会话"));

  if (!button) {
    throw new Error("Expected desktop new conversation button.");
  }

  return button;
}

function requiredDesktopSidebar() {
  const sidebar = container?.querySelector<HTMLElement>("aside");

  if (!sidebar) {
    throw new Error("Expected desktop sidebar.");
  }

  return sidebar;
}

async function selectKnowledgeBase(name: string) {
  await waitForSelectTrigger();

  await act(async () => {
    requiredSelectTrigger().click();
    await Promise.resolve();
  });

  await act(async () => {
    pressSelectItem(requiredSelectItem(name));
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

function requiredButtonContaining(text: string) {
  const button = Array.from(container?.querySelectorAll("button") ?? []).find(
    (candidate) => candidate.textContent?.includes(text),
  );

  if (!button) {
    throw new Error(`Expected button containing ${text}.`);
  }

  return button;
}

function requiredButtonByLabel(label: string) {
  const button = document.body.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );

  if (!button) {
    throw new Error(`Expected button labeled ${label}.`);
  }

  return button;
}

function requiredPersonalCenterTrigger() {
  const button = container?.querySelector<HTMLButtonElement>(
    '[data-personal-center-trigger="desktop"]',
  );

  if (!button) {
    throw new Error("Expected desktop personal center trigger.");
  }

  return button;
}

function requiredAnswerMetricsSwitch() {
  const button = document.body.querySelector<HTMLButtonElement>(
    '[data-answer-metrics-switch="true"]',
  );

  if (!button) {
    throw new Error("Expected answer metrics switch.");
  }

  return button;
}

function requiredInputByLabel(label: string) {
  const input = document.body.querySelector<HTMLInputElement>(
    `input[aria-label="${label}"]`,
  );

  if (!input) {
    throw new Error(`Expected input labeled ${label}.`);
  }

  return input;
}

function requiredHistorySearchResults() {
  const results = document.body.querySelector<HTMLElement>(
    '[data-chat-history-search-results="true"]',
  );

  if (!results) {
    throw new Error("Expected chat history search results.");
  }

  return results;
}

function requiredHistorySearchResult(title: string) {
  const result = Array.from(
    document.body.querySelectorAll<HTMLElement>('[data-chat-history-search-result="true"]'),
  ).find((candidate) => candidate.textContent?.includes(title));

  if (!result) {
    throw new Error(`Expected chat history search result ${title}.`);
  }

  return result;
}

function requiredButtonFromDocument(name: string) {
  const button = Array.from(document.body.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === name,
  );

  if (!button) {
    throw new Error(`Expected document button named ${name}.`);
  }

  return button;
}

function requiredElementContaining(text: string) {
  const element = Array.from(document.body.querySelectorAll<HTMLElement>("[role='menuitem'], button")).find(
    (candidate) => candidate.textContent?.includes(text),
  );

  if (!element) {
    throw new Error(`Expected document element containing ${text}.`);
  }

  return element;
}

async function clickElement(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    element.click();
    await Promise.resolve();
  });
}

function requiredSelectTrigger() {
  const trigger = container?.querySelector<HTMLButtonElement>('[data-slot="select-trigger"]');

  if (!trigger) {
    throw new Error("Expected knowledge base select trigger.");
  }

  return trigger;
}

function requiredSelectItem(name: string) {
  const item = Array.from(document.body.querySelectorAll<HTMLElement>('[data-slot="select-item"]')).find(
    (candidate) => candidate.textContent?.trim() === name,
  );

  if (!item) {
    throw new Error(`Expected select item named ${name}.`);
  }

  return item;
}

function pressSelectItem(item: HTMLElement) {
  const pointerDown = new Event("pointerdown", { bubbles: true });
  Object.defineProperty(pointerDown, "pointerType", { value: "touch" });
  item.dispatchEvent(pointerDown);
  item.click();
}

async function waitForSelectTrigger() {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 2000) {
    if (container?.querySelector('[data-slot="select-trigger"]')) {
      return;
    }

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }

  throw new Error("Expected knowledge base select trigger.");
}

async function waitForText(text: string) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 2000) {
    const matchingField = Array.from(
      container?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea") ?? [],
    ).some(
      (field) =>
        field.placeholder.includes(text) ||
        field.value.includes(text) ||
        field.getAttribute("aria-label")?.includes(text),
    );

    if (container?.textContent?.includes(text) || matchingField) {
      return;
    }

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }

  throw new Error(`Expected text: ${text}`);
}

async function waitForDocumentText(text: string) {
  await waitForCondition(() => document.body.textContent?.includes(text) === true);
}

async function waitForCondition(predicate: () => boolean) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 2000) {
    if (predicate()) {
      return;
    }

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }

  throw new Error("Expected condition to pass.");
}
