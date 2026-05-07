// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import {
  CHAT_HOME_STORAGE_KEY,
  loadChatHomeState,
  saveChatHomeState,
  upsertRecentConversation,
  type ChatHomeState,
} from "./chat-home-storage";

afterEach(() => {
  window.localStorage.clear();
});

describe("chat home storage", () => {
  it("returns a stable default when storage is empty", () => {
    expect(loadChatHomeState()).toEqual({
      sidebarCollapsed: false,
      selectedProjectId: null,
      recentConversations: [],
    });
  });

  it("saves and loads selected project and collapsed sidebar", () => {
    const state: ChatHomeState = {
      sidebarCollapsed: true,
      selectedProjectId: "project-1",
      recentConversations: [],
    };

    saveChatHomeState(state);

    expect(JSON.parse(window.localStorage.getItem(CHAT_HOME_STORAGE_KEY) ?? "{}")).toMatchObject({
      sidebarCollapsed: true,
      selectedProjectId: "project-1",
    });
    expect(loadChatHomeState()).toEqual(state);
  });

  it("dedupes recent conversations and keeps newest first", () => {
    const state = upsertRecentConversation(
      upsertRecentConversation(loadChatHomeState(), {
        projectId: "project-a",
        projectName: "Alpha",
        conversationId: "conv-1",
        title: "First",
        updatedAt: 1,
      }),
      {
        projectId: "project-a",
        projectName: "Alpha",
        conversationId: "conv-1",
        title: "Renamed",
        updatedAt: 2,
      },
    );

    expect(state.recentConversations).toEqual([
      {
        projectId: "project-a",
        projectName: "Alpha",
        conversationId: "conv-1",
        title: "Renamed",
        updatedAt: 2,
      },
    ]);
  });

  it("ignores corrupt JSON", () => {
    window.localStorage.setItem(CHAT_HOME_STORAGE_KEY, "{bad json");

    expect(loadChatHomeState().recentConversations).toEqual([]);
  });
});
