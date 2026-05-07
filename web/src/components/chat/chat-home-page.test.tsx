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

  it("centers the home chat in a narrow Gemini-style column", async () => {
    vi.mocked(fetchProjects).mockResolvedValue({
      projects: [],
      warnings: [],
    });

    await renderChatHomePage();

    const chatExperience = container?.querySelector<HTMLElement>('[data-chat-experience="home"]');
    expect(chatExperience?.className).toContain("max-w-3xl");
    expect(chatExperience?.parentElement?.className).toContain("justify-center");
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
    desktopMocks.streamQuestionMessage.mockImplementation(
      async (_projectId, _conversationId, _message, nextHandlers) => {
        handlers = nextHandlers;
      },
    );

    await renderChatHomePage();
    await selectKnowledgeBase("Alpha");
    await waitForText("询问这个知识库");
    updateQuestion("What is inside?");
    await clickButton("发送");

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
