# Answer Message Actions Design

## Context

The web Ask experience already renders assistant answers and citation references in `ProjectQuestionPanel`. Citation preview is handled by `QuestionReferences`, using a Sheet so users can inspect a referenced file without leaving the current page.

This change refines the assistant answer area and adds the action menu expected on assistant replies. The implementation is web-only: the web app must call desktop-provided actions for copy, save to Wiki, and regenerate. The web app must not invent save-to-Wiki file naming or persistence behavior.

## Goals

- Remove the duplicate reference count text under the "引用文件" heading.
- Show citation numbers beside each reference item, formatted as `[1]`, `[2]`, etc.
- Make reference items visibly clickable on hover, including `cursor-pointer`.
- Split assistant answer rendering into a large answer component with separate child components for answer content, references, and answer actions.
- Show an answer action menu below the assistant answer on hover.
- Provide three action buttons with icons: copy, save to Wiki, and regenerate.
- Route all three action buttons through desktop-provided functionality.

## Non-Goals

- Do not implement save-to-Wiki naming, file writing, indexing, or ingestion logic in the web app.
- Do not change the desktop action semantics.
- Do not redesign the whole Ask panel or the user message layout.
- Do not change citation preview behavior beyond the requested list display refinements.

## Recommended Architecture

Use the existing assistant message render path, but split responsibilities into small components:

- `ChatMessage`: keeps the generic role-based message shell and delegates assistant messages to the answer component.
- `AssistantAnswerMessage`: the large assistant answer component. It owns the assistant bubble layout, hover state, and answer action placement.
- `AnswerContent`: renders the answer body Markdown through the existing `MessagePrimitive.Parts` and `MarkdownTextPart` behavior.
- `QuestionReferences`: continues to own citation list rendering, expand/collapse behavior, Sheet preview state, and file preview loading.
- `AnswerActions`: renders the hover action menu and calls desktop action APIs.

This keeps citation preview logic isolated from answer action logic. It also keeps Markdown rendering independent from the outer answer controls.

## UI Behavior

Assistant answers keep the current quiet workbench styling. The answer component contains:

1. A small assistant label.
2. The answer content block.
3. The citation reference block, when references exist.
4. The action menu, shown when the large answer component is hovered or focused within.

The reference block should remain visually secondary:

- Keep the soft muted background and compact vertical rhythm.
- The heading says only "引用文件".
- Remove the description text that says "引用 x 个文件".
- Keep the right-side overflow control: "展开全部 x 个引用" or "收起引用".
- Each item displays only `[n] filename`, not the full path.
- Each item uses `cursor-pointer` and a subtle hover background/text change.
- The Sheet title may show the filename; the Sheet description continues to show the full path.

The answer action menu has three icon buttons:

- `Copy` icon: "复制".
- `BookmarkPlus` icon: "保存到 Wiki".
- `RefreshCw` icon: "重新生成".

Copy and save are available for assistant messages. Regenerate is available only for the last assistant message in the active conversation, matching the existing desktop chat semantics and avoiding ambiguous middle-of-history regeneration.

## Desktop Action Contract

The web app calls desktop-owned actions. The preferred web proxy shape is:

- `POST /api/projects/:projectId/question/conversations/:conversationId/messages/:messageId/actions/copy`
- `POST /api/projects/:projectId/question/conversations/:conversationId/messages/:messageId/actions/save-to-wiki`
- `POST /api/projects/:projectId/question/conversations/:conversationId/messages/:messageId/actions/regenerate`

Payloads should be minimal. Prefer identifying the message by `projectId`, `conversationId`, and `messageId`; desktop owns the persisted conversation context and action behavior. If the desktop bridge already requires content in addition to IDs, the web proxy can include `content` and `references`, but the action semantics still remain desktop-owned.

Expected responses:

- Copy: success or error.
- Save to Wiki: success or error; optional saved path if desktop provides it.
- Regenerate: either returns the updated message list/new assistant message, or returns success and the web app refreshes the current conversation messages.

## State And Error Handling

`AnswerActions` tracks per-action status locally:

- Idle
- Loading
- Success
- Error

While an action is loading, disable that button and show concise text such as "复制中", "保存中", or "重新生成中".

On success, show a short-lived success label such as "已复制" or "已保存". On failure, show a small `text-destructive` message in the action menu area. Do not open a disruptive modal for action failures.

For regenerate:

- Disable regenerate while the Ask panel is streaming or loading.
- On success, update the current conversation from the desktop action response when possible.
- If the response does not include messages, re-fetch messages for the active conversation.
- Keep existing streaming and cancellation behavior unchanged.

## Accessibility

- Action buttons are real buttons with accessible labels.
- Hover-only menu must also appear on keyboard focus within the answer component.
- Reference buttons keep a useful `title` with the full path while visible text stays filename-only.
- Icon buttons include visible text, not icon-only controls.

## Testing Plan

Update `project-question-panel.test.tsx` with behavior-level coverage:

- The reference block no longer renders the "引用 x 个文件" description.
- Reference items render `[1] filename`, `[2] filename`, and do not render full paths in the list.
- Reference item buttons include `cursor-pointer`.
- The first three references show by default, and expanding shows all references with numbering preserved.
- Opening a reference still displays the full path in the Sheet and fetches the file by full path.
- Assistant answer rendering still displays Markdown body content separately from references.
- Hover/focus on an assistant answer exposes action buttons with `Copy`, `BookmarkPlus`, and `RefreshCw` icons.
- Copy and save action clicks call the desktop action API wrapper with project, conversation, and message identity.
- Regenerate appears only on the last assistant message and calls the regenerate action.
- Regenerate success refreshes or updates the current conversation messages.
- Action failures render a small error message and do not crash the panel.

## Implementation Notes

- Use existing shadcn/local UI primitives such as `Button`, `Card`, and existing Sheet components.
- Use `lucide-react` icons already present in the app.
- Preserve the existing assistant-ui runtime integration.
- Keep changes scoped to the web Ask panel and related client/proxy API files.
- Do not touch desktop-side implementation in this task.
