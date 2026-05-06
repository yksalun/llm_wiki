# Web Chat Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the web root with a ChatGPT-style knowledge-base chat home while keeping `/projects` as the project management page and preserving the existing project Ask streaming behavior.

**Architecture:** Extract the current project Ask conversation state and chat renderer into shared chat modules, then rebuild `ProjectQuestionPanel` as a thin wrapper and add a new `ChatHomePage` with a collapsible shadcn-style sidebar. The home page uses project selection plus the existing desktop bridge conversation/SSE APIs; browser localStorage stores only home presentation state and recent conversation index.

**Tech Stack:** Next.js 16 app router, React 19, TypeScript strict mode, Tailwind 4, shadcn/Base UI components, lucide-react, Vitest/jsdom, existing desktop bridge conversation APIs.

---

## Base And Isolation

This plan must be implemented from:

```text
F:/code/dev/llm_wiki_web/.worktree/web-chat-home
branch: codex/web-chat-home
base: main
```

Do not implement from `F:/code/dev/llm_wiki_web` because that worktree is on `codex/web-foundation-project-bridge` and has unrelated dirty changes.

## File Structure

Create:

```text
web/src/app/projects/page.tsx
web/src/components/chat/chat-experience.tsx
web/src/components/chat/chat-home-page.tsx
web/src/components/chat/chat-home-page.test.tsx
web/src/components/chat/chat-home-storage.ts
web/src/components/chat/chat-home-storage.test.ts
web/src/components/chat/chat-message.tsx
web/src/components/chat/chat-session-list.tsx
web/src/components/chat/knowledge-base-selector.test.tsx
web/src/components/chat/knowledge-base-selector.tsx
web/src/components/chat/use-question-session.ts
```

Modify:

```text
web/src/app/page.tsx
web/src/components/workbench/project-question-panel.tsx
web/src/components/workbench/project-question-panel.test.tsx
```

Responsibilities:

```text
chat-home-page.tsx:
  Full-page route UI for `/`, project loading, selected project state, home sidebar, mobile drawer, and wiring to ChatExperience.

chat-home-storage.ts:
  ASCII-only localStorage helpers for selected project, collapsed sidebar, and cross-project recent conversation index.

use-question-session.ts:
  Extracted state machine from ProjectQuestionPanelSession: conversation loading, new/select conversation, streaming send, stop, regenerate, save action, derived messages, draft handling, abort cleanup.

chat-experience.tsx:
  Shared chat viewport and composer. It uses useQuestionSession when a projectId exists, renders disabled empty state when projectId is null, and exposes session metadata changes to ChatHomePage.

chat-message.tsx:
  Pure rendering pieces moved from ProjectQuestionPanel: ChatMessage, AssistantAnswerMessage, AnswerActions, MarkdownContent helpers, hidden comment stripping, reference normalization.

chat-session-list.tsx:
  Shared conversation list UI for project Ask and home sidebar.

knowledge-base-selector.tsx:
  Project selector built from existing ProjectSummary data. No new select dependency; use a button list/popover-style panel with existing Button, ScrollArea, and Sheet for mobile.

project-question-panel.tsx:
  Thin wrapper around ChatExperience with `mode="project"` and built-in project conversation list enabled.
```

## Task 1: Route The Project List To `/projects`

**Files:**

- Create: `web/src/app/projects/page.tsx`
- Modify: `web/src/app/page.tsx`
- Test: `web/src/components/chat/chat-home-page.test.tsx`

- [ ] **Step 1: Write the failing route smoke test**

Create `web/src/components/chat/chat-home-page.test.tsx` with:

```tsx
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
```

- [ ] **Step 2: Run the new test to verify it fails**

Run:

```bash
cd web
npm run test -- src/components/chat/chat-home-page.test.tsx
```

Expected: FAIL because `web/src/components/chat/chat-home-page.tsx` does not exist.

- [ ] **Step 3: Add a minimal `ChatHomePage` placeholder**

Create `web/src/components/chat/chat-home-page.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MessageSquare, Plus, Settings2, UserCircle } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { fetchProjects } from "@/lib/client/api";
import type { ProjectsListResponse } from "@/lib/types";

type ProjectsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ProjectsListResponse };

export function ChatHomePage() {
  const [projectsState, setProjectsState] = useState<ProjectsState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    fetchProjects(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setProjectsState({ status: "ready", data });
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setProjectsState({
            status: "error",
            message: error instanceof Error ? error.message : "Unable to load projects.",
          });
        }
      });

    return () => {
      controller.abort();
    };
  }, []);

  return (
    <main className="flex min-h-screen bg-[color:var(--paper-base)] text-[color:var(--ink-strong)]">
      <aside className="hidden w-72 shrink-0 border-r border-[color:var(--paper-border)] bg-[color:var(--paper-panel)] p-3 md:flex md:flex-col">
        <div className="space-y-2">
          <Button type="button" variant="outline" className="w-full justify-start">
            <Plus className="size-4" aria-hidden="true" />
            New chat
          </Button>
          <Link href="/projects" className={buttonVariants({ variant: "ghost", className: "w-full justify-start" })}>
            <Settings2 className="size-4" aria-hidden="true" />
            Knowledge config
          </Link>
        </div>
        <div className="mt-4 min-h-0 flex-1 rounded-md border border-dashed border-[color:var(--paper-border)] p-3 text-sm text-muted-foreground">
          No recent chats
        </div>
        <Button type="button" variant="ghost" className="mt-3 w-full justify-start">
          <UserCircle className="size-4" aria-hidden="true" />
          Profile
        </Button>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-[color:var(--paper-border)] px-4 py-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="size-4 text-muted-foreground" aria-hidden="true" />
            <h1 className="text-sm font-medium">LLM Wiki Chat</h1>
          </div>
          <Link href="/projects" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Knowledge config
          </Link>
        </header>
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <div className="w-full max-w-3xl rounded-lg border border-[color:var(--paper-border)] bg-[color:var(--paper-panel)] p-4">
            <p className="text-sm text-muted-foreground">
              {projectsState.status === "loading"
                ? "Loading knowledge bases..."
                : "Choose a knowledge base before asking."}
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Update routes**

Modify `web/src/app/page.tsx`:

```tsx
import { ChatHomePage } from "@/components/chat/chat-home-page";

export default function Home() {
  return <ChatHomePage />;
}
```

Create `web/src/app/projects/page.tsx`:

```tsx
import { ProjectListPage } from "@/components/projects/project-list-page";

export default function ProjectsPage() {
  return <ProjectListPage />;
}
```

- [ ] **Step 5: Run route smoke test**

Run:

```bash
cd web
npm run test -- src/components/chat/chat-home-page.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/page.tsx web/src/app/projects/page.tsx web/src/components/chat/chat-home-page.tsx web/src/components/chat/chat-home-page.test.tsx
git commit -m "feat: route home to chat shell"
```

## Task 2: Add Home Presentation Storage

**Files:**

- Create: `web/src/components/chat/chat-home-storage.ts`
- Create: `web/src/components/chat/chat-home-storage.test.ts`

- [ ] **Step 1: Write storage tests**

Create `web/src/components/chat/chat-home-storage.test.ts`:

```ts
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
```

- [ ] **Step 2: Run storage tests to verify failure**

Run:

```bash
cd web
npm run test -- src/components/chat/chat-home-storage.test.ts
```

Expected: FAIL because `chat-home-storage.ts` does not exist.

- [ ] **Step 3: Implement storage helpers**

Create `web/src/components/chat/chat-home-storage.ts`:

```ts
export const CHAT_HOME_STORAGE_KEY = "llm-wiki-web.chat.home.v1";
const MAX_RECENT_CONVERSATIONS = 50;

export interface ChatHomeRecentConversation {
  projectId: string;
  projectName: string;
  conversationId: string;
  title: string;
  updatedAt: number;
}

export interface ChatHomeState {
  sidebarCollapsed: boolean;
  selectedProjectId: string | null;
  recentConversations: ChatHomeRecentConversation[];
}

const defaultState: ChatHomeState = {
  sidebarCollapsed: false,
  selectedProjectId: null,
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

  if (!normalizedItem) {
    return normalizeChatHomeState(state);
  }

  const existing = normalizeChatHomeState(state).recentConversations.filter(
    (candidate) =>
      candidate.projectId !== normalizedItem.projectId ||
      candidate.conversationId !== normalizedItem.conversationId,
  );

  return {
    ...normalizeChatHomeState(state),
    recentConversations: [normalizedItem, ...existing]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_RECENT_CONVERSATIONS),
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
  };
}

function getLocalStorage() {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.localStorage;
}
```

- [ ] **Step 4: Run storage tests**

Run:

```bash
cd web
npm run test -- src/components/chat/chat-home-storage.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/chat/chat-home-storage.ts web/src/components/chat/chat-home-storage.test.ts
git commit -m "feat: add chat home local state"
```

## Task 3: Extract Pure Chat Message Rendering

**Files:**

- Create: `web/src/components/chat/chat-message.tsx`
- Modify: `web/src/components/workbench/project-question-panel.tsx`
- Test: `web/src/components/workbench/project-question-panel.test.tsx`

- [ ] **Step 1: Write a focused export test by extending existing expectations**

In `web/src/components/workbench/project-question-panel.test.tsx`, keep existing tests. Add this assertion to the existing test named `does not render hidden citation comments from assistant messages`:

```ts
expect(container?.querySelector('[data-answer-message="true"]')).not.toBeNull();
```

This fails if the extraction drops the existing message data attributes.

- [ ] **Step 2: Create `chat-message.tsx` by moving pure code**

Create `web/src/components/chat/chat-message.tsx` and move these items from `project-question-panel.tsx` without behavior changes:

```text
AnswerActionKind
AnswerActionRequest
AnswerActionHandler
ChatMessage
AssistantAnswerMessage
AnswerContent
MessageContent
ThinkingIndicator
AnswerActions
AnswerActionButton
MarkdownContent
MarkdownBlock
parseMarkdownBlocks
renderInlineMarkdown
stripHiddenHtmlComments
getMessageReferences
isStreamingMessageId
getMessageText
isDesktopBridgeReference
getErrorMessage
```

The public exports must be:

```tsx
export type AnswerActionKind = "copy" | "save" | "regenerate";

export interface AnswerActionRequest {
  conversationId: string;
  messageId: string;
  content: string;
  references: DesktopBridgeReference[];
  signal?: AbortSignal;
}

export type AnswerActionHandler = (
  action: AnswerActionKind,
  request: AnswerActionRequest,
) => Promise<void>;

export function ChatMessage(props: {
  projectId: string;
  message: DesktopBridgeMessage;
  hiddenMessageId: string | null;
  isLast: boolean;
  onAnswerAction: AnswerActionHandler;
}) {
  // moved body from project-question-panel.tsx
}

export function stripHiddenHtmlComments(content: string) {
  return content.replace(/<!--[\s\S]*?-->/g, "").trimEnd();
}

export function getMessageText(content: string) {
  return stripHiddenHtmlComments(content).trim();
}
```

Imports for the new file:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import {
  BookmarkPlus,
  Check,
  Copy,
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { QuestionReferences } from "@/components/workbench/question-references";
import type { DesktopBridgeMessage, DesktopBridgeReference } from "@/lib/types";
import { cn } from "@/lib/utils";
```

- [ ] **Step 3: Replace local definitions in ProjectQuestionPanel**

Modify `web/src/components/workbench/project-question-panel.tsx` imports:

```tsx
import {
  ChatMessage,
  getMessageText,
  stripHiddenHtmlComments,
  type AnswerActionHandler,
} from "@/components/chat/chat-message";
```

Remove the moved function/type declarations from `project-question-panel.tsx`.

Remove unused icon imports from `project-question-panel.tsx` so its lucide import becomes:

```tsx
import {
  LoaderCircle,
  MessageSquare,
  Plus,
  StopCircle,
} from "lucide-react";
```

- [ ] **Step 4: Run project question tests**

Run:

```bash
cd web
npm run test -- src/components/workbench/project-question-panel.test.tsx
```

Expected: PASS with no behavior changes.

- [ ] **Step 5: Run typecheck**

Run:

```bash
cd web
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/chat/chat-message.tsx web/src/components/workbench/project-question-panel.tsx web/src/components/workbench/project-question-panel.test.tsx
git commit -m "refactor: extract shared chat message rendering"
```

## Task 4: Extract The Question Session Hook

**Files:**

- Create: `web/src/components/chat/use-question-session.ts`
- Modify: `web/src/components/workbench/project-question-panel.tsx`
- Test: `web/src/components/workbench/project-question-panel.test.tsx`

- [ ] **Step 1: Add a regression test for wrapper behavior**

In `web/src/components/workbench/project-question-panel.test.tsx`, add:

```ts
it("keeps the project ask wrapper on the selected project after extraction", async () => {
  const conversation = createConversation({ id: "conv-wrapper", title: "wrapper" });
  apiMocks.listQuestionConversations.mockResolvedValue([conversation]);
  apiMocks.listQuestionMessages.mockResolvedValue([]);

  renderProjectQuestionPanel({ projectId: "project-wrapper" });
  await waitForReady();
  updateQuestion("Wrapper question?");
  await submitComposer();

  expect(apiMocks.streamQuestionMessage).toHaveBeenCalledWith(
    "project-wrapper",
    "conv-wrapper",
    "Wrapper question?",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
});
```

Add this helper near the other test helpers:

```ts
async function submitComposer() {
  await act(async () => {
    const form = container?.querySelector("form");

    if (!form) {
      throw new Error("Expected composer form.");
    }

    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}
```

- [ ] **Step 2: Create hook interface**

Create `web/src/components/chat/use-question-session.ts` with this interface first:

```ts
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createQuestionConversation,
  listQuestionConversations,
  listQuestionMessages,
  saveQuestionAnswerToWiki,
  streamRegenerateQuestionAnswer,
  streamQuestionMessage,
} from "@/lib/client/desktop-question-api";
import type {
  DesktopBridgeConversation,
  DesktopBridgeMessage,
  DesktopBridgeReference,
} from "@/lib/types";
import {
  getMessageText,
  stripHiddenHtmlComments,
  type AnswerActionHandler,
} from "./chat-message";

export type QuestionStatus = "loading" | "ready" | "streaming" | "error";

export interface QuestionSessionSnapshot {
  projectId: string;
  conversations: DesktopBridgeConversation[];
  activeConversationId: string | null;
  activeConversation: DesktopBridgeConversation | null;
  messages: DesktopBridgeMessage[];
  renderedMessages: DesktopBridgeMessage[];
  draft: string;
  status: QuestionStatus;
  errorMessage: string | null;
  hiddenMessageId: string | null;
  isStreaming: boolean;
  canSendMessage: boolean;
  setDraft: (value: string) => void;
  handleNewConversation: () => Promise<void>;
  handleSelectConversation: (conversationId: string) => Promise<void>;
  handleSendMessage: (submittedMessage: string) => Promise<void>;
  handleStop: () => void;
  handleAnswerAction: AnswerActionHandler;
}

export interface UseQuestionSessionOptions {
  projectId: string;
  onConversationChange?: (event: {
    projectId: string;
    conversation: DesktopBridgeConversation | null;
  }) => void;
}

export function useQuestionSession({
  projectId,
  onConversationChange,
}: UseQuestionSessionOptions): QuestionSessionSnapshot {
  // Move ProjectQuestionPanelSession state machine here.
}
```

- [ ] **Step 3: Move session state machine**

Move all state, refs, effects, and handlers from `ProjectQuestionPanelSession` into `useQuestionSession`, keeping these helper functions in the hook file:

```text
STREAM_TYPE_INTERVAL_MS
getStreamCharacterBatchSize
deriveConversationTitlesFromMessages
renamePlaceholderConversationFromQuestion
getFirstUserMessageTitle
makeConversationTitle
isPlaceholderConversationTitle
isAbortError
getErrorMessage
```

The hook must call `onConversationChange` after:

```text
initial load chooses active conversation
new conversation succeeds
select conversation succeeds
first submitted question renames placeholder conversation
```

Use this helper inside the hook:

```ts
function notifyConversationChange(
  callback: UseQuestionSessionOptions["onConversationChange"],
  projectId: string,
  conversation: DesktopBridgeConversation | null,
) {
  callback?.({ projectId, conversation });
}
```

- [ ] **Step 4: Refactor ProjectQuestionPanelSession to use the hook**

In `project-question-panel.tsx`, `ProjectQuestionPanelSession` should keep only UI refs and render-level handlers:

```tsx
function ProjectQuestionPanelSession({ projectId }: { projectId: string }) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const isComposingRef = useRef(false);
  const session = useQuestionSession({ projectId });
  const trimmedDraft = session.draft.trim();

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    viewport.scrollTo({ top: viewport.scrollHeight });
  }, [session.renderedMessages.length, session.status]);

  function handleDraftKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    if (event.nativeEvent.isComposing || isComposingRef.current) {
      return;
    }

    event.preventDefault();

    if (!session.canSendMessage) {
      return;
    }

    void session.handleSendMessage(trimmedDraft);
  }

  // keep the existing JSX, replacing local variables with `session.*`
}
```

- [ ] **Step 5: Run project question tests**

Run:

```bash
cd web
npm run test -- src/components/workbench/project-question-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Run typecheck**

Run:

```bash
cd web
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/chat/use-question-session.ts web/src/components/workbench/project-question-panel.tsx web/src/components/workbench/project-question-panel.test.tsx
git commit -m "refactor: extract project question session hook"
```

## Task 5: Extract Shared ChatExperience And Session List

**Files:**

- Create: `web/src/components/chat/chat-experience.tsx`
- Create: `web/src/components/chat/chat-session-list.tsx`
- Modify: `web/src/components/workbench/project-question-panel.tsx`
- Test: `web/src/components/workbench/project-question-panel.test.tsx`

- [ ] **Step 1: Add ProjectQuestionPanel DOM contract test**

In `project-question-panel.test.tsx`, add:

```ts
it("renders the shared chat experience container in project mode", async () => {
  const conversation = createConversation({ id: "conv-shared", title: "shared" });
  apiMocks.listQuestionConversations.mockResolvedValue([conversation]);
  apiMocks.listQuestionMessages.mockResolvedValue([]);

  renderProjectQuestionPanel();
  await waitForReady();

  expect(container?.querySelector('[data-chat-experience="project"]')).not.toBeNull();
  expect(container?.querySelector('[data-chat-session-list="true"]')).not.toBeNull();
});
```

- [ ] **Step 2: Create ChatSessionList**

Create `web/src/components/chat/chat-session-list.tsx`:

```tsx
"use client";

import { MessageSquare, Plus } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import type { DesktopBridgeConversation } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface ChatSessionListProps {
  title: string;
  conversations: DesktopBridgeConversation[];
  activeConversationId: string | null;
  disabled: boolean;
  newConversationLabel: string;
  emptyLabel: string;
  onNewConversation: () => void;
  onSelectConversation: (conversationId: string) => void;
}

export function ChatSessionList({
  title,
  conversations,
  activeConversationId,
  disabled,
  newConversationLabel,
  emptyLabel,
  onNewConversation,
  onSelectConversation,
}: ChatSessionListProps) {
  return (
    <aside
      data-chat-session-list="true"
      className="space-y-3 rounded-md border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MessageSquare className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-sm font-medium text-[color:var(--ink-strong)]">{title}</h2>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onNewConversation}
          disabled={disabled}
        >
          <Plus className="size-4" aria-hidden="true" />
          {newConversationLabel}
        </Button>
      </div>

      <div className="space-y-2">
        {conversations.length > 0 ? (
          conversations.map((conversation) => (
            <Button
              key={conversation.id}
              type="button"
              size="sm"
              aria-current={conversation.id === activeConversationId ? "true" : undefined}
              variant="ghost"
              className={cn(
                "h-auto w-full justify-start whitespace-normal border px-2 py-2 text-left",
                conversation.id === activeConversationId
                  ? "border-[color:var(--ring)] bg-[color:var(--paper-panel)] font-semibold text-[color:var(--ink-strong)] shadow-sm"
                  : "border-transparent text-muted-foreground",
              )}
              onClick={() => onSelectConversation(conversation.id)}
              disabled={disabled}
            >
              {conversation.title || "New conversation"}
            </Button>
          ))
        ) : (
          <p className="rounded-md border border-[color:var(--paper-border)] bg-[color:var(--paper-panel)] px-3 py-2 text-sm text-muted-foreground">
            {emptyLabel}
          </p>
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 3: Create ChatExperience**

Create `web/src/components/chat/chat-experience.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";
import { LoaderCircle, MessageSquare, StopCircle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ChatMessage } from "@/components/chat/chat-message";
import { ChatSessionList } from "@/components/chat/chat-session-list";
import { useQuestionSession } from "@/components/chat/use-question-session";
import type { DesktopBridgeConversation } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface ChatExperienceProps {
  projectId: string | null;
  mode: "home" | "project";
  title: string;
  subtitle?: string;
  showSessionList: boolean;
  disabledMessage?: string;
  composerTopSlot?: React.ReactNode;
  className?: string;
  minHeightClassName?: string;
  onConversationChange?: (event: {
    projectId: string;
    conversation: DesktopBridgeConversation | null;
  }) => void;
}

export function ChatExperience({
  projectId,
  mode,
  title,
  subtitle,
  showSessionList,
  disabledMessage = "Choose a knowledge base before asking.",
  composerTopSlot,
  className,
  minHeightClassName = "min-h-[28rem]",
  onConversationChange,
}: ChatExperienceProps) {
  if (!projectId) {
    return (
      <section
        data-chat-experience={mode}
        className={cn(
          "flex flex-1 flex-col rounded-lg border border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]",
          minHeightClassName,
          className,
        )}
      >
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="w-full max-w-3xl space-y-3 rounded-lg border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] p-4">
            {composerTopSlot}
            <p className="text-sm text-muted-foreground">{disabledMessage}</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <ActiveChatExperience
      projectId={projectId}
      mode={mode}
      title={title}
      subtitle={subtitle}
      showSessionList={showSessionList}
      composerTopSlot={composerTopSlot}
      className={className}
      minHeightClassName={minHeightClassName}
      onConversationChange={onConversationChange}
    />
  );
}

function ActiveChatExperience({
  projectId,
  mode,
  title,
  subtitle,
  showSessionList,
  composerTopSlot,
  className,
  minHeightClassName,
  onConversationChange,
}: Required<Pick<ChatExperienceProps, "projectId" | "mode" | "title" | "showSessionList">> &
  Omit<ChatExperienceProps, "projectId" | "mode" | "title" | "showSessionList">) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const isComposingRef = useRef(false);
  const session = useQuestionSession({ projectId, onConversationChange });
  const trimmedDraft = session.draft.trim();

  useEffect(() => {
    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    viewport.scrollTo({ top: viewport.scrollHeight });
  }, [session.renderedMessages.length, session.status]);

  function handleDraftKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    if (event.nativeEvent.isComposing || isComposingRef.current) {
      return;
    }

    event.preventDefault();

    if (!session.canSendMessage) {
      return;
    }

    void session.handleSendMessage(trimmedDraft);
  }

  const chatPanel = (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col rounded-md border border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]",
        minHeightClassName,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--paper-border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-sm font-medium text-[color:var(--ink-strong)]">{title}</h2>
        </div>
        {session.activeConversation ? (
          <p className="text-xs text-muted-foreground">
            {subtitle ?? `Current conversation: ${session.activeConversation.title}`}
          </p>
        ) : null}
      </div>

      <div ref={viewportRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {session.renderedMessages.length === 0 && session.status !== "loading" ? (
          <p className="rounded-md border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] px-3 py-2 text-sm text-muted-foreground">
            No messages yet
          </p>
        ) : null}
        {session.renderedMessages.map((message, index) => (
          <ChatMessage
            key={message.id}
            projectId={projectId}
            message={message}
            hiddenMessageId={session.hiddenMessageId}
            isLast={index === session.renderedMessages.length - 1}
            onAnswerAction={session.handleAnswerAction}
          />
        ))}
      </div>

      {session.status === "loading" ? (
        <div className="mx-4 mb-3 flex items-center gap-2 rounded-md border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] px-3 py-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          Loading project chat
        </div>
      ) : null}

      {session.errorMessage ? (
        <Alert variant="destructive" className="mx-4 mb-3 border-destructive/20 bg-destructive/5">
          <MessageSquare className="size-4" />
          <AlertTitle>Chat failed</AlertTitle>
          <AlertDescription>{session.errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      <form
        className="border-t border-[color:var(--paper-border)] p-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (session.canSendMessage) {
            void session.handleSendMessage(trimmedDraft);
          }
        }}
      >
        {composerTopSlot ? <div className="mb-2">{composerTopSlot}</div> : null}
        <textarea
          aria-label="Project question input"
          placeholder="Ask this knowledge base"
          value={session.draft}
          disabled={session.status === "loading"}
          onChange={(event) => session.setDraft(event.target.value)}
          onKeyDown={handleDraftKeyDown}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={(event) => {
            isComposingRef.current = false;
            session.setDraft(event.currentTarget.value);
          }}
          className="min-h-20 w-full resize-none rounded-md border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] px-3 py-2 text-sm leading-6 text-[color:var(--ink-strong)] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {session.isStreaming ? "Generating answer" : "Answers use the selected knowledge base."}
          </p>
          <div className="flex items-center gap-2">
            {session.isStreaming ? (
              <Button type="button" variant="outline" size="sm" onClick={session.handleStop}>
                <StopCircle className="size-4" aria-hidden="true" />
                Stop
              </Button>
            ) : null}
            <Button type="submit" size="sm" disabled={!session.canSendMessage}>
              {session.isStreaming ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <MessageSquare className="size-4" aria-hidden="true" />
              )}
              Send
            </Button>
          </div>
        </div>
      </form>
    </div>
  );

  return (
    <section data-chat-experience={mode} className={cn("rounded-lg", className)}>
      {showSessionList ? (
        <div className="grid gap-3 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <ChatSessionList
            title="History"
            conversations={session.conversations}
            activeConversationId={session.activeConversationId}
            disabled={session.isStreaming || session.status === "loading"}
            newConversationLabel="New chat"
            emptyLabel="No conversations"
            onNewConversation={() => {
              void session.handleNewConversation();
            }}
            onSelectConversation={(conversationId) => {
              void session.handleSelectConversation(conversationId);
            }}
          />
          {chatPanel}
        </div>
      ) : (
        chatPanel
      )}
    </section>
  );
}
```

- [ ] **Step 4: Replace ProjectQuestionPanel with wrapper**

Modify `web/src/components/workbench/project-question-panel.tsx` to:

```tsx
"use client";

import { ChatExperience } from "@/components/chat/chat-experience";

interface ProjectQuestionPanelProps {
  projectId: string;
  onOpenFile: (relativePath: string) => void;
}

export function ProjectQuestionPanel({ projectId }: ProjectQuestionPanelProps) {
  return (
    <section className="rounded-lg border border-[color:var(--paper-border)] bg-[color:var(--paper-panel)] p-3">
      <ChatExperience
        key={projectId}
        projectId={projectId}
        mode="project"
        title="Project Ask"
        showSessionList
      />
    </section>
  );
}
```

Keep the `onOpenFile` prop even though references now preview through `QuestionReferences`; this preserves the public component API used by `ProjectWorkbench`.

- [ ] **Step 5: Run tests and adjust labels if needed**

Run:

```bash
cd web
npm run test -- src/components/workbench/project-question-panel.test.tsx
```

Expected: likely FAIL only where tests assert old button text. Update tests to use the new ASCII labels:

```text
old new conversation label -> New chat
old send label             -> Send
old stop label             -> Stop
old current title text      -> Current conversation:
```

Do not weaken behavioral assertions about API calls, streaming, aborts, references, markdown, or actions.

- [ ] **Step 6: Run typecheck**

Run:

```bash
cd web
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/chat/chat-experience.tsx web/src/components/chat/chat-session-list.tsx web/src/components/workbench/project-question-panel.tsx web/src/components/workbench/project-question-panel.test.tsx
git commit -m "refactor: share chat experience with project ask"
```

## Task 6: Add Knowledge Base Selector

**Files:**

- Create: `web/src/components/chat/knowledge-base-selector.tsx`
- Create: `web/src/components/chat/knowledge-base-selector.test.tsx`

- [ ] **Step 1: Write selector component tests**

Create `web/src/components/chat/knowledge-base-selector.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProjectSummary } from "@/lib/types";

import { KnowledgeBaseSelector } from "./knowledge-base-selector";

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
  vi.clearAllMocks();
});

describe("KnowledgeBaseSelector", () => {
  it("renders projects and marks the selected project", () => {
    renderSelector({ selectedProjectId: "project-a" });

    expect(container?.textContent).toContain("Alpha");
    expect(container?.textContent).toContain("Beta");
    expect(requiredButton("Alpha").getAttribute("aria-current")).toBe("true");
    expect(requiredButton("Beta").getAttribute("aria-current")).toBeNull();
  });

  it("calls onSelectProject with the chosen project id", () => {
    const onSelectProject = vi.fn();

    renderSelector({ onSelectProject });
    clickButton("Beta");

    expect(onSelectProject).toHaveBeenCalledWith("project-b");
  });

  it("shows an empty state when there are no projects", () => {
    renderSelector({ projects: [] });

    expect(container?.textContent).toContain("No knowledge bases found.");
  });
});

function renderSelector({
  projects = [
    createProject({ id: "project-a", name: "Alpha" }),
    createProject({ id: "project-b", name: "Beta" }),
  ],
  selectedProjectId = null,
  onSelectProject = vi.fn(),
}: {
  projects?: ProjectSummary[];
  selectedProjectId?: string | null;
  onSelectProject?: (projectId: string) => void;
} = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  act(() => {
    root?.render(
      <KnowledgeBaseSelector
        projects={projects}
        selectedProjectId={selectedProjectId}
        onSelectProject={onSelectProject}
      />,
    );
  });
}

function clickButton(name: string) {
  act(() => {
    requiredButton(name).click();
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

function createProject(overrides: Partial<ProjectSummary>): ProjectSummary {
  return {
    id: "project-1",
    name: "Project",
    status: "ready",
    hasPurpose: true,
    hasSchema: true,
    hasWikiDirectory: true,
    hasRawSourcesDirectory: true,
    updatedAt: null,
    ...overrides,
  };
}
```

- [ ] **Step 2: Run selector tests to verify failure**

Run:

```bash
cd web
npm run test -- src/components/chat/knowledge-base-selector.test.tsx
```

Expected: FAIL because `knowledge-base-selector.tsx` does not exist.

- [ ] **Step 3: Create selector component**

Create `web/src/components/chat/knowledge-base-selector.tsx`:

```tsx
"use client";

import { BookOpen, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ProjectSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface KnowledgeBaseSelectorProps {
  projects: ProjectSummary[];
  selectedProjectId: string | null;
  disabled?: boolean;
  onSelectProject: (projectId: string) => void;
}

export function KnowledgeBaseSelector({
  projects,
  selectedProjectId,
  disabled = false,
  onSelectProject,
}: KnowledgeBaseSelectorProps) {
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;

  return (
    <div
      data-knowledge-base-selector="true"
      className="rounded-md border border-[color:var(--paper-border)] bg-[color:var(--paper-panel)] p-2"
    >
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <BookOpen className="size-3.5" aria-hidden="true" />
        Knowledge base
      </div>
      {projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">No knowledge bases found.</p>
      ) : (
        <ScrollArea className="max-h-44">
          <div className="space-y-1 pr-2">
            {projects.map((project) => {
              const selected = project.id === selectedProject?.id;

              return (
                <Button
                  key={project.id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-current={selected ? "true" : undefined}
                  disabled={disabled}
                  className={cn(
                    "h-auto w-full justify-start gap-2 whitespace-normal px-2 py-2 text-left",
                    selected
                      ? "bg-[color:var(--paper-muted)] text-[color:var(--ink-strong)]"
                      : "text-muted-foreground",
                  )}
                  onClick={() => onSelectProject(project.id)}
                >
                  <Check
                    className={cn("size-3.5", selected ? "opacity-100" : "opacity-0")}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate">{project.name}</span>
                </Button>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run selector tests**

Run:

```bash
cd web
npm run test -- src/components/chat/knowledge-base-selector.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/chat/knowledge-base-selector.tsx web/src/components/chat/knowledge-base-selector.test.tsx
git commit -m "feat: add knowledge base selector"
```

## Task 7: Build ChatHomePage With Sidebar And Shared Chat

**Files:**

- Modify: `web/src/components/chat/chat-home-page.tsx`
- Modify: `web/src/components/chat/chat-home-page.test.tsx`
- Use: `web/src/components/chat/chat-home-storage.ts`
- Use: `web/src/components/chat/chat-experience.tsx`
- Use: `web/src/components/chat/knowledge-base-selector.tsx`

- [ ] **Step 1: Add home behavior tests**

Extend `chat-home-page.test.tsx`:

```tsx
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
  await clickButton("Alpha");
  await waitForText("Ask this knowledge base");
  updateQuestion("What is inside?");
  await clickButton("Send");

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
```

Add helpers:

```tsx
function updateQuestion(value: string) {
  const textarea = container?.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Project question input"]',
  );

  if (!textarea) {
    throw new Error("Expected chat textarea.");
  }

  act(() => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")
      ?.set;
    valueSetter?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function clickButton(name: string) {
  await act(async () => {
    const button = Array.from(container?.querySelectorAll("button") ?? []).find(
      (candidate) => candidate.textContent?.trim() === name,
    );

    if (!button) {
      throw new Error(`Expected button named ${name}.`);
    }

    button.click();
    await Promise.resolve();
  });
}
```

- [ ] **Step 2: Replace ChatHomePage placeholder with full shell**

Modify `web/src/components/chat/chat-home-page.tsx` to:

```tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Menu,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings2,
  UserCircle,
} from "lucide-react";

import { ChatExperience } from "@/components/chat/chat-experience";
import {
  loadChatHomeState,
  saveChatHomeState,
  upsertRecentConversation,
  type ChatHomeState,
} from "@/components/chat/chat-home-storage";
import { KnowledgeBaseSelector } from "@/components/chat/knowledge-base-selector";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { fetchProjects } from "@/lib/client/api";
import type { DesktopBridgeConversation, ProjectSummary, ProjectsListResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

type ProjectsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ProjectsListResponse };

export function ChatHomePage() {
  const [projectsState, setProjectsState] = useState<ProjectsState>({ status: "loading" });
  const [homeState, setHomeState] = useState<ChatHomeState>(() => loadChatHomeState());
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useEffect(() => {
    saveChatHomeState(homeState);
  }, [homeState]);

  useEffect(() => {
    const controller = new AbortController();

    fetchProjects(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setProjectsState({ status: "ready", data });
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setProjectsState({
            status: "error",
            message: error instanceof Error ? error.message : "Unable to load projects.",
          });
        }
      });

    return () => {
      controller.abort();
    };
  }, []);

  const projects = projectsState.status === "ready" ? projectsState.data.projects : [];
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === homeState.selectedProjectId) ?? null,
    [homeState.selectedProjectId, projects],
  );

  function updateHomeState(updater: (current: ChatHomeState) => ChatHomeState) {
    setHomeState((current) => updater(current));
  }

  function handleSelectProject(projectId: string) {
    updateHomeState((current) => ({
      ...current,
      selectedProjectId: projectId,
    }));
  }

  function handleConversationChange(event: {
    projectId: string;
    conversation: DesktopBridgeConversation | null;
  }) {
    if (!event.conversation) {
      return;
    }

    const project = projects.find((candidate) => candidate.id === event.projectId);
    updateHomeState((current) =>
      upsertRecentConversation(current, {
        projectId: event.projectId,
        projectName: project?.name ?? event.projectId,
        conversationId: event.conversation.id,
        title: event.conversation.title || "New conversation",
        updatedAt: event.conversation.updatedAt || Date.now(),
      }),
    );
  }

  const selector = (
    <KnowledgeBaseSelector
      projects={projects}
      selectedProjectId={selectedProject?.id ?? null}
      disabled={projectsState.status !== "ready"}
      onSelectProject={handleSelectProject}
    />
  );

  return (
    <main className="flex min-h-screen bg-[color:var(--paper-base)] text-[color:var(--ink-strong)]">
      <DesktopSidebar
        collapsed={homeState.sidebarCollapsed}
        recentConversations={homeState.recentConversations}
        selectedProjectId={selectedProject?.id ?? null}
        onToggleCollapsed={() =>
          updateHomeState((current) => ({
            ...current,
            sidebarCollapsed: !current.sidebarCollapsed,
          }))
        }
        onSelectRecent={(projectId) =>
          updateHomeState((current) => ({
            ...current,
            selectedProjectId: projectId,
          }))
        }
      />

      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <SheetContent side="left" className="w-80 max-w-[85vw]">
          <SheetHeader>
            <SheetTitle>Chat navigation</SheetTitle>
          </SheetHeader>
          <MobileSidebarBody
            recentConversations={homeState.recentConversations}
            onSelectRecent={(projectId) => {
              setMobileSidebarOpen(false);
              updateHomeState((current) => ({
                ...current,
                selectedProjectId: projectId,
              }));
            }}
          />
        </SheetContent>
      </Sheet>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]/80 px-4 py-3">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="md:hidden"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Open chat navigation"
            >
              <Menu className="size-4" aria-hidden="true" />
            </Button>
            <MessageSquare className="hidden size-4 text-muted-foreground sm:block" aria-hidden="true" />
            <div>
              <h1 className="text-sm font-medium">LLM Wiki Chat</h1>
              <p className="text-xs text-muted-foreground">
                {selectedProject ? selectedProject.name : "Choose a knowledge base"}
              </p>
            </div>
          </div>
          <ThemeToggle />
        </header>

        <div className="flex min-h-0 flex-1 p-3 md:p-5">
          <ChatExperience
            key={selectedProject?.id ?? "no-project"}
            projectId={selectedProject?.id ?? null}
            mode="home"
            title="Knowledge chat"
            showSessionList={false}
            disabledMessage={
              projects.length === 0
                ? "No knowledge bases are available. Open knowledge config to add one."
                : "Choose a knowledge base before asking."
            }
            composerTopSlot={selector}
            className="flex min-h-0 flex-1"
            minHeightClassName="min-h-[calc(100vh-8rem)]"
            onConversationChange={handleConversationChange}
          />
        </div>
      </section>
    </main>
  );
}

function DesktopSidebar({
  collapsed,
  recentConversations,
  selectedProjectId,
  onToggleCollapsed,
  onSelectRecent,
}: {
  collapsed: boolean;
  recentConversations: ChatHomeState["recentConversations"];
  selectedProjectId: string | null;
  onToggleCollapsed: () => void;
  onSelectRecent: (projectId: string) => void;
}) {
  return (
    <aside
      className={cn(
        "hidden shrink-0 border-r border-[color:var(--paper-border)] bg-[color:var(--paper-panel)] p-3 transition-[width] md:flex md:flex-col",
        collapsed ? "w-16" : "w-72",
      )}
    >
      <div className="space-y-2">
        <Button type="button" variant="outline" className={cn("w-full", collapsed ? "px-0" : "justify-start")}>
          <Plus className="size-4" aria-hidden="true" />
          {!collapsed ? "New chat" : null}
        </Button>
        <Link
          href="/projects"
          className={buttonVariants({
            variant: "ghost",
            className: cn("w-full", collapsed ? "px-0" : "justify-start"),
          })}
        >
          <Settings2 className="size-4" aria-hidden="true" />
          {!collapsed ? "Knowledge config" : null}
        </Link>
        <Button
          type="button"
          variant="ghost"
          className={cn("w-full", collapsed ? "px-0" : "justify-start")}
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" aria-hidden="true" />
          ) : (
            <PanelLeftClose className="size-4" aria-hidden="true" />
          )}
          {!collapsed ? "Collapse" : null}
        </Button>
      </div>

      <div className="mt-4 min-h-0 flex-1 space-y-1 overflow-y-auto">
        {!collapsed && recentConversations.length === 0 ? (
          <p className="rounded-md border border-dashed border-[color:var(--paper-border)] px-3 py-2 text-sm text-muted-foreground">
            No recent chats
          </p>
        ) : null}
        {!collapsed
          ? recentConversations.map((item) => (
              <Button
                key={`${item.projectId}:${item.conversationId}`}
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  "h-auto w-full justify-start whitespace-normal px-2 py-2 text-left",
                  item.projectId === selectedProjectId
                    ? "bg-[color:var(--paper-muted)] text-[color:var(--ink-strong)]"
                    : "text-muted-foreground",
                )}
                onClick={() => onSelectRecent(item.projectId)}
              >
                <span className="min-w-0">
                  <span className="block truncate">{item.title}</span>
                  <span className="block truncate text-[11px] opacity-75">{item.projectName}</span>
                </span>
              </Button>
            ))
          : null}
      </div>

      <Button type="button" variant="ghost" className={cn("mt-3 w-full", collapsed ? "px-0" : "justify-start")}>
        <UserCircle className="size-4" aria-hidden="true" />
        {!collapsed ? "Profile" : null}
      </Button>
    </aside>
  );
}

function MobileSidebarBody({
  recentConversations,
  onSelectRecent,
}: {
  recentConversations: ChatHomeState["recentConversations"];
  onSelectRecent: (projectId: string) => void;
}) {
  return (
    <div className="space-y-3 px-4 pb-4">
      <Link href="/projects" className={buttonVariants({ variant: "outline", className: "w-full justify-start" })}>
        <Settings2 className="size-4" aria-hidden="true" />
        Knowledge config
      </Link>
      <div className="space-y-1">
        {recentConversations.length === 0 ? (
          <p className="rounded-md border border-dashed border-[color:var(--paper-border)] px-3 py-2 text-sm text-muted-foreground">
            No recent chats
          </p>
        ) : (
          recentConversations.map((item) => (
            <Button
              key={`${item.projectId}:${item.conversationId}`}
              type="button"
              variant="ghost"
              className="h-auto w-full justify-start whitespace-normal px-2 py-2 text-left"
              onClick={() => onSelectRecent(item.projectId)}
            >
              <span className="min-w-0">
                <span className="block truncate">{item.title}</span>
                <span className="block truncate text-[11px] opacity-75">{item.projectName}</span>
              </span>
            </Button>
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run home tests**

Run:

```bash
cd web
npm run test -- src/components/chat/chat-home-page.test.tsx
```

Expected: PASS after any label adjustment.

- [ ] **Step 4: Run project question tests**

Run:

```bash
cd web
npm run test -- src/components/workbench/project-question-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/chat/chat-home-page.tsx web/src/components/chat/chat-home-page.test.tsx web/src/components/chat/knowledge-base-selector.tsx
git commit -m "feat: build chat home page"
```

## Task 8: Polish Empty, Error, And Removed-Project States

**Files:**

- Modify: `web/src/components/chat/chat-home-page.tsx`
- Modify: `web/src/components/chat/chat-home-storage.ts`
- Test: `web/src/components/chat/chat-home-page.test.tsx`
- Test: `web/src/components/chat/chat-home-storage.test.ts`

- [ ] **Step 1: Add unavailable recent conversation test**

In `chat-home-page.test.tsx`, add:

```tsx
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
  await waitForText("Unavailable");
});
```

- [ ] **Step 2: Add storage remove test**

In `chat-home-storage.test.ts`, add:

```ts
import { removeRecentConversation } from "./chat-home-storage";

it("removes a recent conversation from the local index", () => {
  const state = upsertRecentConversation(loadChatHomeState(), {
    projectId: "project-a",
    projectName: "Alpha",
    conversationId: "conv-1",
    title: "First",
    updatedAt: 1,
  });

  expect(removeRecentConversation(state, "project-a", "conv-1").recentConversations).toEqual([]);
});
```

- [ ] **Step 3: Implement unavailable labels and remove action**

Modify the recent list render in `DesktopSidebar` and `MobileSidebarBody`:

```tsx
const unavailable = projects.length > 0
  ? !projects.some((project) => project.id === item.projectId)
  : true;
```

Pass `projects` into both sidebar components. Render:

```tsx
{unavailable ? (
  <span className="block text-[11px] text-destructive">Unavailable</span>
) : (
  <span className="block truncate text-[11px] opacity-75">{item.projectName}</span>
)}
```

Disable selecting unavailable items:

```tsx
disabled={unavailable}
```

Add a small remove button beside unavailable items:

```tsx
<Button
  type="button"
  variant="ghost"
  size="icon-xs"
  aria-label={`Remove ${item.title}`}
  onClick={(event) => {
    event.stopPropagation();
    onRemoveRecent(item.projectId, item.conversationId);
  }}
>
  <X className="size-3" aria-hidden="true" />
</Button>
```

Wire `onRemoveRecent` through both sidebars using `removeRecentConversation`.

- [ ] **Step 4: Run focused tests**

Run:

```bash
cd web
npm run test -- src/components/chat/chat-home-storage.test.ts src/components/chat/chat-home-page.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/chat/chat-home-page.tsx web/src/components/chat/chat-home-page.test.tsx web/src/components/chat/chat-home-storage.ts web/src/components/chat/chat-home-storage.test.ts
git commit -m "feat: handle unavailable chat home history"
```

## Task 9: Final Verification And Browser Check

**Files:**

- No code files unless verification reveals a defect.

- [ ] **Step 1: Run full web typecheck**

Run:

```bash
cd web
npm run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run focused test suite**

Run:

```bash
cd web
npm run test -- src/components/chat/chat-home-storage.test.ts src/components/chat/chat-home-page.test.tsx src/components/workbench/project-question-panel.test.tsx src/components/projects/project-list-page.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run full web tests if focused suite passes**

Run:

```bash
cd web
npm run test
```

Expected: PASS. If unrelated existing failures appear, capture the failing test names and run the focused suite again to prove this feature.

- [ ] **Step 4: Start dev server**

Run:

```bash
cd web
npm run dev
```

Expected: Next.js dev server starts and prints a localhost URL.

- [ ] **Step 5: Manual browser QA**

Open:

```text
http://localhost:3000/
```

Verify:

```text
/ shows the chat home, not project cards
sidebar has New chat, Knowledge config, history area, Profile
sidebar can collapse and expand on desktop
mobile width opens sidebar as a sheet
knowledge selector appears inside composer area
send is disabled until a knowledge base is selected
selecting a project loads/creates conversations
sending a message streams into the shared message UI
references still open previews
/projects shows the old project card list
/projects/:id Ask still works and has the same shared chat UI
```

- [ ] **Step 6: Stop dev server**

Stop the dev server cleanly with Ctrl+C in the terminal that started it.

- [ ] **Step 7: Commit any verification fixes**

Only if fixes were needed:

```bash
git add <changed-files>
git commit -m "fix: stabilize chat home verification"
```

## Self-Review Checklist

Spec coverage:

```text
root page replaced by chat home: Tasks 1, 7
/projects keeps project management: Task 1
collapsible left sidebar: Task 7
top/middle/bottom sidebar layout: Task 7
knowledge config links to /projects: Tasks 1, 7
history list click restores project/conversation context: Tasks 2, 7, 8
profile is display-only: Task 7
knowledge base selector in composer: Tasks 6, 7
home question uses existing streaming conversation APIs: Tasks 4, 5, 7
project Ask and home share UI: Tasks 3, 4, 5
no auth or permissions: all tasks avoid auth/db session work
main-based worktree: Base And Isolation section
```

Placeholder scan:

```text
No red-flag placeholder terms are intended in implementation steps.
When a step says "move existing body", the source and destination symbols are enumerated exactly.
```

Type consistency:

```text
ChatExperienceProps uses `projectId: string | null`.
useQuestionSession requires `projectId: string`; ChatExperience guards null before calling it.
Home storage uses projectId + conversationId, matching DesktopBridgeConversation ids.
ProjectQuestionPanel public props remain unchanged.
```
