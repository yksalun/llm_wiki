# Chat Message Layout And Reference Folding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 调整 Web 问答聊天窗口，让用户消息靠右、AI 消息靠左，并让 AI 引用列表超过 3 条时默认折叠。

**Architecture:** 所有行为集中在 `ProjectQuestionPanel` 的 `ChatMessage` 渲染层。消息数据、桌面端 API、Web API route、流式协议和历史会话逻辑保持不变；引用折叠只使用单条消息组件内的本地 UI 状态。

**Tech Stack:** Next.js 16、React 19、assistant-ui、Vitest、Tailwind CSS。

---

### Task 1: 消息左右布局

**Files:**
- Modify: `web/src/components/workbench/project-question-panel.tsx`
- Test: `web/src/components/workbench/project-question-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

Add this test inside `describe("ProjectQuestionPanel", ...)`:

```tsx
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
```

Add this helper near the existing `requiredButton` helper:

```tsx
function requiredMessage(text: string) {
  const message = Array.from(
    container?.querySelectorAll<HTMLElement>("[data-message-role]") ?? [],
  ).find((candidate) => candidate.textContent?.includes(text));

  if (!message) {
    throw new Error(`Expected message containing ${text}.`);
  }

  return message;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm run test -- src/components/workbench/project-question-panel.test.tsx
```

Expected: FAIL because no rendered message has `data-message-role` / `data-message-align`.

- [ ] **Step 3: Write minimal implementation**

Modify `ChatMessage` in `web/src/components/workbench/project-question-panel.tsx`:

```tsx
function ChatMessage({
  message,
  onOpenFile,
}: {
  message: MessageState;
  onOpenFile: (relativePath: string) => void;
}) {
  const label =
    message.role === "user" ? "用户" : message.role === "assistant" ? "助手" : "系统";
  const isUserMessage = message.role === "user";

  return (
    <MessagePrimitive.Root
      data-message-role={message.role}
      data-message-align={isUserMessage ? "right" : "left"}
      className={cn("flex w-full", isUserMessage ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "max-w-[78%] rounded-md border p-3",
          isUserMessage
            ? "border-primary/25 bg-primary text-primary-foreground"
            : "border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] text-[color:var(--ink-strong)]",
        )}
      >
        <p
          className={cn(
            "text-xs font-medium",
            isUserMessage ? "text-primary-foreground/80" : "text-muted-foreground",
          )}
        >
          {label}
        </p>
        <div className="mt-1">
          <MessagePrimitive.Parts components={{ Text: MarkdownTextPart }} />
        </div>
        {/* Existing references block remains below in this bubble. */}
      </div>
    </MessagePrimitive.Root>
  );
}
```

Keep the existing references rendering inside the inner `<div>` after the message body. Do not change reference behavior in this task.

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
npm run test -- src/components/workbench/project-question-panel.test.tsx
```

Expected: PASS for the new alignment test and existing tests.

- [ ] **Step 5: Commit**

```powershell
git add web/src/components/workbench/project-question-panel.tsx web/src/components/workbench/project-question-panel.test.tsx
git commit -m "feat(web): align qa chat messages by role"
```

### Task 2: AI 引用默认折叠

**Files:**
- Modify: `web/src/components/workbench/project-question-panel.tsx`
- Test: `web/src/components/workbench/project-question-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

Add this test inside `describe("ProjectQuestionPanel", ...)`:

```tsx
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

  expect(container?.textContent).toContain("引用 5 条，已显示 3 条");
  expect(container?.textContent).toContain("wiki/ref-1.md");
  expect(container?.textContent).toContain("wiki/ref-2.md");
  expect(container?.textContent).toContain("wiki/ref-3.md");
  expect(container?.textContent).not.toContain("wiki/ref-4.md");
  expect(container?.textContent).not.toContain("wiki/ref-5.md");

  await clickButton("展开全部");

  expect(container?.textContent).toContain("引用 5 条，已显示 5 条");
  expect(container?.textContent).toContain("wiki/ref-4.md");
  expect(container?.textContent).toContain("wiki/ref-5.md");

  await clickButtonContaining("引用 5");

  expect(onOpenFile).toHaveBeenCalledWith("wiki/ref-5.md");

  await clickButton("收起");

  expect(container?.textContent).toContain("引用 5 条，已显示 3 条");
  expect(container?.textContent).not.toContain("wiki/ref-4.md");
  expect(container?.textContent).not.toContain("wiki/ref-5.md");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm run test -- src/components/workbench/project-question-panel.test.tsx
```

Expected: FAIL because all references are currently rendered and no `展开全部` / `收起` button exists.

- [ ] **Step 3: Write minimal implementation**

In `ChatMessage`, add local state and visible reference calculation:

```tsx
const [referencesExpanded, setReferencesExpanded] = useState(false);
const references = getMessageReferences(message);
const hasCollapsibleReferences = references.length > 3;
const visibleReferences =
  hasCollapsibleReferences && !referencesExpanded ? references.slice(0, 3) : references;
```

Replace the existing references block with:

```tsx
{references.length > 0 ? (
  <div className="mt-3 space-y-2">
    {hasCollapsibleReferences ? (
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          引用 {references.length} 条，已显示 {visibleReferences.length} 条
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          onClick={() => setReferencesExpanded((current) => !current)}
        >
          {referencesExpanded ? "收起" : "展开全部"}
        </Button>
      </div>
    ) : null}
    <ul className="space-y-2">
      {visibleReferences.map((reference) => (
        <li key={`${reference.path}-${reference.title}`}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-auto w-full justify-start whitespace-normal text-left"
            onClick={() => onOpenFile(reference.path)}
          >
            <ExternalLink className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block font-medium">{reference.title}</span>
              <span className="block text-xs text-muted-foreground">{reference.path}</span>
            </span>
          </Button>
        </li>
      ))}
    </ul>
  </div>
) : null}
```

Do not collapse user messages specially; the behavior naturally applies only when a message has more than 3 references. Desktop data currently attaches references to assistant messages.

- [ ] **Step 4: Run targeted test**

Run:

```powershell
npm run test -- src/components/workbench/project-question-panel.test.tsx
```

Expected: PASS for all question panel tests.

- [ ] **Step 5: Run full verification**

Run:

```powershell
npm run lint
npm run typecheck
npm run test
npm run build
```

Expected:
- lint: 0 errors; existing unused warnings may remain.
- typecheck: exit 0.
- test: all tests pass.
- build: exit 0; existing Turbopack NFT trace warning may remain.

- [ ] **Step 6: Commit**

```powershell
git add web/src/components/workbench/project-question-panel.tsx web/src/components/workbench/project-question-panel.test.tsx
git commit -m "feat(web): collapse long qa references"
```

---

## Self-Review

- Spec coverage: Task 1 covers message left/right alignment and stable test attributes. Task 2 covers default folded references, total count, expand/collapse, and reference opening.
- Placeholder scan: no TBD/TODO/待定 placeholders.
- Type consistency: all changed code stays inside existing `ProjectQuestionPanel` component and uses existing `DesktopBridgeReference`, `MessageState`, `Button`, and `cn` utilities.
