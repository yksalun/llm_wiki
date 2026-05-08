export const CHAT_HOME_STORAGE_KEY = "llm-wiki-web.chat.home.v1";
const MAX_RECENT_CONVERSATIONS = 50;

export interface ChatHomeRecentConversation {
  projectId: string;
  projectName: string;
  conversationId: string;
  title: string;
  updatedAt: number;
  isTitleCustomized?: boolean;
}

export interface ChatHomeState {
  sidebarCollapsed: boolean;
  selectedProjectId: string | null;
  selectedConversationId: string | null;
  recentConversations: ChatHomeRecentConversation[];
}

const defaultState: ChatHomeState = {
  sidebarCollapsed: false,
  selectedProjectId: null,
  selectedConversationId: null,
  recentConversations: [],
};

export function loadChatHomeState(storage: Storage | undefined = getLocalStorage()) {
  if (!storage) {
    return defaultState;
  }

  const raw = storage.getItem(CHAT_HOME_STORAGE_KEY);
  if (!raw) {
    return defaultState;
  }

  try {
    return normalizeChatHomeState(JSON.parse(raw));
  } catch {
    return defaultState;
  }
}

export function saveChatHomeState(
  state: ChatHomeState,
  storage: Storage | undefined = getLocalStorage(),
) {
  if (!storage) {
    return;
  }

  storage.setItem(CHAT_HOME_STORAGE_KEY, JSON.stringify(normalizeChatHomeState(state)));
}

export function upsertRecentConversation(
  state: ChatHomeState,
  item: ChatHomeRecentConversation,
): ChatHomeState {
  const normalizedItem = normalizeRecentConversation(item);
  const normalizedState = normalizeChatHomeState(state);

  if (!normalizedItem) {
    return normalizedState;
  }

  const existingConversation = normalizedState.recentConversations.find(
    (candidate) =>
      candidate.projectId === normalizedItem.projectId &&
      candidate.conversationId === normalizedItem.conversationId,
  );
  const nextItem = existingConversation?.isTitleCustomized
    ? {
        ...normalizedItem,
        title: existingConversation.title,
        isTitleCustomized: true,
      }
    : normalizedItem;
  const existing = normalizedState.recentConversations.filter(
    (candidate) =>
      candidate.projectId !== nextItem.projectId ||
      candidate.conversationId !== nextItem.conversationId,
  );

  return {
    ...normalizedState,
    recentConversations: [nextItem, ...existing]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_RECENT_CONVERSATIONS),
  };
}

export function renameRecentConversation(
  state: ChatHomeState,
  projectId: string,
  conversationId: string,
  title: string,
): ChatHomeState {
  const normalized = normalizeChatHomeState(state);
  const nextTitle = title.trim();

  if (!nextTitle) {
    return normalized;
  }

  return {
    ...normalized,
    recentConversations: normalized.recentConversations.map((candidate) =>
      candidate.projectId === projectId && candidate.conversationId === conversationId
        ? { ...candidate, title: nextTitle, isTitleCustomized: true }
        : candidate,
    ),
  };
}

export function removeRecentConversation(
  state: ChatHomeState,
  projectId: string,
  conversationId: string,
): ChatHomeState {
  const normalized = normalizeChatHomeState(state);

  return {
    ...normalized,
    recentConversations: normalized.recentConversations.filter(
      (candidate) =>
        candidate.projectId !== projectId || candidate.conversationId !== conversationId,
    ),
  };
}

function normalizeChatHomeState(value: unknown): ChatHomeState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaultState;
  }

  const candidate = value as Partial<ChatHomeState>;
  const recentConversations = Array.isArray(candidate.recentConversations)
    ? candidate.recentConversations
        .map(normalizeRecentConversation)
        .filter((item): item is ChatHomeRecentConversation => item !== null)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_RECENT_CONVERSATIONS)
    : [];

  return {
    sidebarCollapsed: candidate.sidebarCollapsed === true,
    selectedProjectId:
      typeof candidate.selectedProjectId === "string" &&
      candidate.selectedProjectId.trim().length > 0
        ? candidate.selectedProjectId
        : null,
    selectedConversationId:
      typeof candidate.selectedConversationId === "string" &&
      candidate.selectedConversationId.trim().length > 0
        ? candidate.selectedConversationId
        : null,
    recentConversations,
  };
}

function normalizeRecentConversation(value: unknown): ChatHomeRecentConversation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Partial<ChatHomeRecentConversation>;
  if (
    typeof candidate.projectId !== "string" ||
    typeof candidate.projectName !== "string" ||
    typeof candidate.conversationId !== "string" ||
    typeof candidate.title !== "string"
  ) {
    return null;
  }

  const projectId = candidate.projectId.trim();
  const projectName = candidate.projectName.trim();
  const conversationId = candidate.conversationId.trim();
  const title = candidate.title.trim();
  const updatedAt =
    typeof candidate.updatedAt === "number" && Number.isFinite(candidate.updatedAt)
      ? candidate.updatedAt
      : 0;

  if (!projectId || !projectName || !conversationId) {
    return null;
  }

  return {
    projectId,
    projectName,
    conversationId,
    title: title || "New conversation",
    updatedAt,
    ...(candidate.isTitleCustomized === true ? { isTitleCustomized: true } : {}),
  };
}

function getLocalStorage() {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.localStorage;
}
