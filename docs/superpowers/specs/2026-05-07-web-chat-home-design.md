# Web Chat Home Design

Date: 2026-05-07
Base branch: main
Implementation branch/worktree: codex/web-chat-home at .worktree/web-chat-home

## Goal

Replace the web root page with a ChatGPT-style AI question interface. The first screen should be a working question box, not a project card gallery. Users can choose a knowledge base before asking, and the answer flow must match the project-level Ask experience.

The existing project management page remains available as the knowledge base configuration entry. There is no account system, permission system, or real personal center in this phase.

## Market And Library Research

The design should reuse mature shadcn-oriented building blocks instead of inventing a custom chat framework.

References:

- shadcn Sidebar: https://ui.shadcn.com/docs/components/sidebar
- AI SDK Elements overview: https://ai-sdk.dev/elements/overview
- AI SDK Elements PromptInput: https://ai-sdk.dev/elements/components/prompt-input
- assistant-ui docs: https://www.assistant-ui.com/docs/getting-started
- Vercel AI Chatbot template: https://github.com/vercel/chatbot

Decision:

- Use shadcn Sidebar patterns for the collapsible app rail/sidebar.
- Use AI SDK Elements and assistant-ui as interaction references for conversation, messages, prompt input, and thread list structure.
- Do not migrate to a full assistant-ui runtime in this pass.
- Do not import the Vercel AI Chatbot application stack because it brings auth, database sessions, model provider wiring, and product assumptions that are outside the current scope.

## Main-Branch Baseline

This design is based on main at commit 0417e7d, where project Ask already uses desktop bridge conversations and SSE streaming:

```text
web/src/components/workbench/project-question-panel.tsx
web/src/lib/client/desktop-question-api.ts
web/src/app/api/projects/[projectId]/question/conversations/*
```

That means the new home page must not target the removed/old single-shot question API. It must reuse or extract the current conversation/streaming flow.

The user selected "local history" during brainstorming. On main, project conversations already live in the local/self-hosted desktop bridge path, not in a multi-user account database. The implementation should treat that as the source of truth for real messages. Browser localStorage may be used for home-level presentation state, such as selected project, recent cross-project conversation ids, sidebar collapse state, and draft metadata. It should not duplicate the full server/bridge message history unless a fallback is required.

## Routes

The routes should become:

```text
/                  AI chat home
/projects          project / knowledge base management
/projects/:id      project workbench
```

Current root behavior moves to `/projects`:

```text
web/src/app/page.tsx                  -> render ChatHomePage
web/src/app/projects/page.tsx          -> render ProjectListPage
web/src/components/projects/*          -> keep project cards and states
```

The "Knowledge base configuration" sidebar button navigates to `/projects`.

## Layout

The root page should not use the current hero-style AppShell. Chat UI needs a full-height app layout with the prompt visible immediately.

Desktop structure:

```text
+-- sidebar ----------------+-- main --------------------------------+
| top                       |                                      |
|  [new chat]               |                                      |
|  [knowledge config]       |          shared ChatExperience        |
|                           |                                      |
| middle                    |                                      |
|  history item             |                                      |
|  history item             |                                      |
|                           |                                      |
| bottom                    |       knowledge selector + prompt     |
|  avatar profile button    |                                      |
+---------------------------+--------------------------------------+
```

Collapsed sidebar:

```text
+-- rail --+-- main --------------------------------+
|  +       |                                       |
|  db      |          shared ChatExperience        |
|  msg     |                                       |
|  user    |       knowledge selector + prompt     |
+---------+---------------------------------------+
```

Mobile behavior:

```text
+-- main --------------------------------+
| top bar: menu + selected knowledge base |
|                                         |
| shared ChatExperience                   |
|                                         |
| knowledge selector + prompt             |
+-----------------------------------------+

sidebar opens as an overlay/drawer
```

## Component Architecture

The feature should extract the existing project Ask UI into shared pieces instead of building a second chat interface.

Target component shape:

```text
ChatHomePage
  -> ChatSidebar
  -> ChatExperience

ProjectQuestionPanel
  -> ChatExperience
```

Shared components:

```text
components/chat/chat-experience.tsx
components/chat/chat-sidebar.tsx
components/chat/chat-composer.tsx
components/chat/chat-message.tsx
components/chat/chat-history-list.tsx
components/chat/knowledge-base-selector.tsx
components/chat/chat-session-storage.ts
```

`ChatExperience` owns the common interaction surface:

```text
messages viewport
assistant and user message bubbles
streaming answer state
stop generation
answer actions: copy, save to wiki, regenerate
reference/citation rendering
composer textarea
submit and keyboard behavior
error display
empty state
```

Project-specific props:

```text
projectId
conversationId
mode = "home" | "project"
projectOptions?
selectedProjectId?
onSelectProject?
onOpenProject?
onOpenReference?
```

`ProjectQuestionPanel` should become a thin wrapper that fixes `projectId` and renders the shared experience in compact project mode.

## Knowledge Base Selection

The home composer includes a knowledge base selector. It loads projects through the existing project list client API.

Rules:

```text
no projects:
  disable composer
  show action to open /projects

no selected project:
  disable send
  keep selector visible

project selected:
  create or load a conversation for that project
  future turns in that home session use the selected project
```

If the user changes the project in a non-empty conversation, the safer default is to start a new conversation for the new project. Cross-project context mixing should not happen silently.

## Conversation And History Data Flow

Main-based API flow:

```text
fetchProjects()
  -> project options

listQuestionConversations(projectId)
  -> project conversation list

createQuestionConversation(projectId)
  -> new conversation id

listQuestionMessages(projectId, conversationId)
  -> messages

streamQuestionMessage(projectId, conversationId, message)
  -> SSE token/reference/done/error events

streamRegenerateQuestionAnswer(...)
  -> replace the target assistant message

saveQuestionAnswerToWiki(...)
  -> existing answer save action
```

Home sidebar history should aggregate conversations across selected/recent projects. Because the backend lists conversations per project, the first implementation can keep a local index:

```text
localStorage key:
  llm-wiki-web.chat.home.v1

shape:
  {
    sidebarCollapsed: boolean,
    selectedProjectId: string | null,
    recentConversations: [
      {
        projectId: string,
        projectName: string,
        conversationId: string,
        title: string,
        updatedAt: number
      }
    ]
  }
```

The local index is presentation state only. Message content remains loaded from the desktop bridge conversation API.

## Interaction Details

Initial home state:

```text
show centered prompt composer
show knowledge base selector inside composer
show short empty-state prompt suggestions only if they do not feel like marketing copy
```

Sending a message:

```text
append optimistic user message
clear composer
show streaming assistant message
reveal tokens as they arrive
show references as they arrive
finish with final assistant message
update home recent conversation index
```

Stopping:

```text
abort active stream
keep existing committed messages
  clear streaming draft message
return to ready state
```

History click:

```text
select projectId
select conversationId
load messages
render the same ChatExperience
```

New chat:

```text
if project selected:
  create a new conversation for that project
else:
  create empty home state and wait for project selection
```

Knowledge base configuration:

```text
navigate to /projects
```

Profile button:

```text
open a small menu or popover
show static profile preview
do not add login/logout/settings/auth flows
```

## References And Source Opening

Project mode already previews references through `QuestionReferences`.

Home mode should use the same reference component behavior when possible:

```text
click reference:
  open inline/sheet preview from the selected project
```

If a full workbench open action is needed, provide a link to:

```text
/projects/:projectId
```

Do not implement file-position deep linking unless the current workbench already supports it.

## Error Handling

Expected states:

```text
project list load failure:
  keep page usable where possible
  show retry and /projects action

desktop bridge unavailable:
  show API error in chat surface
  keep draft or failed user turn recoverable

project removed after local recent index was saved:
  mark history item unavailable
  allow removing it from the local index

stream error:
  stop streaming draft message
  show error under composer or failed assistant turn
  allow retry/regenerate when the API supports it

abort:
  do not show as an error
```

## Testing Scope

Component tests:

```text
home route renders ChatHomePage instead of ProjectListPage
/projects renders ProjectListPage
knowledge selector loads project options
send is disabled before project selection
new chat creates a conversation for selected project
home submit calls streamQuestionMessage with selected projectId and conversationId
stream token/reference/done events render in shared UI
history index saves/restores selected project and conversation
ProjectQuestionPanel uses shared ChatExperience while preserving current behavior
reference preview behavior remains covered
```

Route/API tests:

```text
keep existing desktop bridge conversation route tests passing
add no new auth/session tables
add no legacy /question API dependency
```

Verification:

```text
npm run typecheck
npm run test -- --runInBand is not applicable to vitest
npm run test -- relevant chat/project tests
manual browser check at / and /projects
```

## Out Of Scope

```text
auth
permissions
real personal center
server-side user chat session table
full assistant-ui runtime migration
Vercel AI Chatbot app-stack migration
streaming protocol redesign
cross-project context in one conversation
deep file-position routing from citations
```

## Implementation Notes

Follow this order later:

```text
1. Keep work on branch codex/web-chat-home, based on main.
2. Move ProjectListPage to /projects.
3. Extract shared chat pieces from ProjectQuestionPanel.
4. Rebuild ProjectQuestionPanel as a wrapper around ChatExperience.
5. Build ChatHomePage and ChatSidebar.
6. Add home local presentation-state storage.
7. Add tests.
8. Run verification.
```

Future worktrees for this feature or follow-up tasks must also be created from `main`, not from the older `codex/web-foundation-project-bridge` branch.
