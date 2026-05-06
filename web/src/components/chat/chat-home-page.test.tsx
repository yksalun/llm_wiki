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

import { fetchProjects } from "@/lib/client/api";

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

    expect(container?.textContent).toContain("New chat");
    expect(container?.textContent).toContain("Knowledge config");
    expect(container?.textContent).toContain("Choose a knowledge base");
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
