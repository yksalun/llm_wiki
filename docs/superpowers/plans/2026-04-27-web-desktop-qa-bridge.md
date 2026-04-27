# Web 端复用桌面端问答能力 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Web 端问答通过桌面端本地 bridge 调用桌面端问答逻辑，支持流式输出、历史记录和来源引用，并停止依赖 Web 自己的 RAG/LLM 实现。

**Architecture:** 桌面端新增一个独立 `127.0.0.1:19828` Web Bridge，并把 `ChatPanel` 内的问答逻辑抽到 `project-chat-service`，让桌面 UI 和 bridge 共用同一套检索、prompt、历史和 `streamChat()` 流程。Web 端 Next API 只做代理，浏览器 UI 通过 Web API 读取桌面端会话、消息和 SSE 流。

**Tech Stack:** Tauri 2, Rust `tiny_http`, Tauri event/command bridge, React 19, Zustand, TypeScript, Vitest, Next.js 16 App Router, SSE.

---

## 文件结构

### Desktop

- Create: `src/lib/project-chat-service.ts`  
  桌面端共享问答 service。负责构建问答上下文、写入 user/assistant 消息、调用 `streamChat()`、回传 token/references/done。

- Create: `src/lib/__tests__/project-chat-service.test.ts`  
  测试 greeting、普通检索、历史拼接、references 保存和 abort 行为。

- Modify: `src/components/chat/chat-panel.tsx`  
  删除组件内重复的问答执行逻辑，改为调用 `sendProjectChatMessage()`。

- Create: `src/lib/web-bridge-handler.ts`  
  桌面前端启动时注册 bridge listener。收到 Rust 发来的 chat request 后调用 `sendProjectChatMessage()`，再通过 Tauri command 把 token/references/done/error 回传给 Rust。

- Modify: `src/App.tsx`  
  在应用初始化时启动 `startWebBridgeHandler()`。

- Create: `src-tauri/src/web_bridge.rs`  
  独立本地 HTTP/SSE bridge，监听 `127.0.0.1:19828`，维护 request id 到 JSON/streaming channel 的映射，并提供 Tauri commands 接收前端回传事件。

- Modify: `src-tauri/src/lib.rs`  
  注册 `web_bridge` 模块，启动 bridge，并注册回传 commands。

- Test: `src-tauri` cargo tests  
  覆盖 SSE 格式、request registry、unknown request id。

### Web

- Modify: `web/src/lib/types.ts`  
  新增 bridge 会话、消息、引用、SSE event 类型。保留旧 `ProjectQuestion*` 类型一段时间用于兼容测试或旧 API。

- Create: `web/src/lib/server/desktop-bridge-client.ts`  
  Web 服务端访问桌面 bridge 的 client，封装 JSON 请求、SSE 代理、错误映射。

- Create: `web/src/lib/server/__tests__/desktop-bridge-client.test.ts`  
  测试 bridge 可用、bridge 不可用、错误响应、SSE 透传。

- Create: `web/src/app/api/projects/[projectId]/question/conversations/route.ts`  
  代理会话列表和创建会话。

- Create: `web/src/app/api/projects/[projectId]/question/conversations/[conversationId]/messages/route.ts`  
  代理消息历史。

- Create: `web/src/app/api/projects/[projectId]/question/conversations/[conversationId]/messages/stream/route.ts`  
  代理流式发送消息。

- Create: `web/src/lib/client/desktop-question-api.ts`  
  浏览器端调用 Web API 的 client，负责解析 SSE event。

- Modify: `web/src/components/workbench/project-question-panel.tsx`  
  从单次问答面板升级为聊天界面：会话列表、消息历史、流式输出、停止生成、来源引用。

- Modify: `web/src/components/workbench/project-question-panel.test.tsx`  
  覆盖加载会话、创建会话、加载消息、流式提问、引用打开和 bridge 错误。

- Modify: `web/src/components/workbench/project-workbench.tsx`  
  保持 Ask section 接入，确保 reference 点击仍通过 `requestOpenRelativePath(relativePath, "Files")`。

- Modify: `web/README.md`  
  删除或降级 Web 端独立 LLM 环境变量说明，新增桌面 bridge 依赖说明。

- Modify: `web/docs/web-roadmap-next-phases.md`  
  记录问答架构调整：Web 问答改为桌面端 bridge 模式。

---

### Task 1: Desktop 共享问答 Service

**Files:**
- Create: `src/lib/project-chat-service.ts`
- Create: `src/lib/__tests__/project-chat-service.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `src/lib/__tests__/project-chat-service.test.ts`：

```ts
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { LlmConfig } from "@/stores/wiki-store"
import type { Conversation, DisplayMessage } from "@/stores/chat-store"
import {
  buildProjectChatContext,
  sendProjectChatMessage,
  type ProjectChatDependencies,
} from "../project-chat-service"

const fakeConfig: LlmConfig = {
  provider: "openai",
  apiKey: "test-key",
  model: "test-model",
  ollamaUrl: "http://localhost:11434",
  customEndpoint: "",
  maxContextSize: 12000,
}

function deps(overrides: Partial<ProjectChatDependencies> = {}): ProjectChatDependencies {
  const messages: DisplayMessage[] = []
  const conversations: Conversation[] = [
    {
      id: "conv_1",
      title: "旧会话",
      createdAt: 1000,
      updatedAt: 1000,
    },
  ]

  return {
    now: () => 2000,
    readFile: vi.fn(async (path: string) => {
      if (path.endsWith("/wiki/index.md")) return "# Index\n\n- [[schema]]"
      if (path.endsWith("/purpose.md")) return "项目目标"
      if (path.endsWith("/wiki/schema.md")) return "# Schema\n\nSchema defines entities."
      if (path.endsWith("/wiki/overview.md")) return "# Overview"
      throw new Error(`missing ${path}`)
    }),
    searchWiki: vi.fn(async () => [
      {
        path: "F:/project/wiki/schema.md",
        title: "Schema",
        snippet: "Schema defines entities.",
        titleMatch: true,
        score: 10,
      },
    ]),
    buildRetrievalGraph: vi.fn(async () => ({ nodes: [], edges: [] })),
    getRelatedNodes: vi.fn(() => []),
    streamChat: vi.fn(async (_config, messagesForLlm, callbacks) => {
      expect(messagesForLlm[0]?.role).toBe("system")
      callbacks.onToken("回答")
      callbacks.onToken("内容")
      callbacks.onDone()
    }),
    getState: () => ({
      project: {
        id: "project_1",
        name: "项目",
        path: "F:/project",
      },
      llmConfig: fakeConfig,
      dataVersion: 1,
      messages,
      conversations,
      maxHistoryMessages: 10,
    }),
    addMessage: (message) => {
      messages.push(message)
    },
    upsertConversation: (conversation) => {
      const index = conversations.findIndex((item) => item.id === conversation.id)
      if (index >= 0) conversations[index] = conversation
      else conversations.push(conversation)
    },
    ...overrides,
  }
}

describe("buildProjectChatContext", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("跳过问候语检索，只生成轻量 system message", async () => {
    const dependencies = deps()

    const result = await buildProjectChatContext(
      {
        projectId: "project_1",
        projectPath: "F:/project",
        conversationId: "conv_1",
        message: "你好",
      },
      dependencies,
    )

    expect(dependencies.searchWiki).not.toHaveBeenCalled()
    expect(result.references).toEqual([])
    expect(result.messages[0]?.content).toContain("casual greeting")
  })

  it("普通问题会检索 wiki 并构建带引用页面的 system message", async () => {
    const dependencies = deps()

    const result = await buildProjectChatContext(
      {
        projectId: "project_1",
        projectPath: "F:/project",
        conversationId: "conv_1",
        message: "schema 在哪里？",
      },
      dependencies,
    )

    expect(dependencies.searchWiki).toHaveBeenCalledWith("F:/project", "schema 在哪里？")
    expect(result.references).toEqual([{ title: "Schema", path: "wiki/schema.md" }])
    expect(result.messages[0]?.content).toContain("## Wiki Pages")
    expect(result.messages[0]?.content).toContain("Schema defines entities.")
  })
})

describe("sendProjectChatMessage", () => {
  it("写入 user message、流式回传 token，并保存 assistant message 和 references", async () => {
    const dependencies = deps()
    const tokens: string[] = []
    let doneMessage: DisplayMessage | null = null

    await sendProjectChatMessage(
      {
        projectId: "project_1",
        projectPath: "F:/project",
        conversationId: "conv_1",
        message: "schema 在哪里？",
      },
      {
        onToken: (token) => tokens.push(token),
        onDone: (message) => {
          doneMessage = message
        },
        onError: (error) => {
          throw error
        },
      },
      dependencies,
    )

    expect(tokens).toEqual(["回答", "内容"])
    expect(doneMessage?.role).toBe("assistant")
    expect(doneMessage?.content).toBe("回答内容")
    expect(doneMessage?.references).toEqual([{ title: "Schema", path: "wiki/schema.md" }])
    expect(dependencies.getState().messages.map((message) => message.role)).toEqual(["user", "assistant"])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm run test:mocks -- src/lib/__tests__/project-chat-service.test.ts
```

Expected: 失败，提示找不到 `src/lib/project-chat-service.ts`。

- [ ] **Step 3: 创建 service 类型和依赖注入边界**

创建 `src/lib/project-chat-service.ts`，先写入以下完整骨架：

```ts
import type { ChatMessage as LLMMessage, StreamCallbacks } from "@/lib/llm-client"
import { streamChat as defaultStreamChat } from "@/lib/llm-client"
import { readFile as defaultReadFile } from "@/commands/fs"
import { searchWiki as defaultSearchWiki, type SearchResult } from "@/lib/search"
import { buildRetrievalGraph as defaultBuildRetrievalGraph, getRelatedNodes as defaultGetRelatedNodes } from "@/lib/graph-relevance"
import { normalizePath, getFileName, getRelativePath } from "@/lib/path-utils"
import { getOutputLanguage, buildLanguageReminder } from "@/lib/output-language"
import { isGreeting } from "@/lib/greeting-detector"
import { chatMessagesToLLM, type Conversation, type DisplayMessage, type MessageReference, useChatStore } from "@/stores/chat-store"
import { useWikiStore, type LlmConfig } from "@/stores/wiki-store"

export interface ProjectChatRequest {
  projectId: string
  projectPath: string
  conversationId: string
  message: string
  signal?: AbortSignal
}

export interface ProjectChatCallbacks {
  onToken: (token: string) => void
  onReferences?: (references: MessageReference[]) => void
  onDone: (message: DisplayMessage) => void
  onError: (error: Error) => void
}

export interface ProjectChatContext {
  messages: LLMMessage[]
  references: MessageReference[]
}

export interface ProjectChatDependencies {
  now: () => number
  readFile: (path: string) => Promise<string>
  searchWiki: (projectPath: string, query: string) => Promise<SearchResult[]>
  buildRetrievalGraph: typeof defaultBuildRetrievalGraph
  getRelatedNodes: typeof defaultGetRelatedNodes
  streamChat: (
    config: LlmConfig,
    messages: LLMMessage[],
    callbacks: StreamCallbacks,
    signal?: AbortSignal,
  ) => Promise<void>
  getState: () => {
    project: { id: string; name: string; path: string } | null
    llmConfig: LlmConfig
    dataVersion: number
    messages: DisplayMessage[]
    conversations: Conversation[]
    maxHistoryMessages: number
  }
  addMessage: (message: DisplayMessage) => void
  upsertConversation: (conversation: Conversation) => void
}

export function createDefaultProjectChatDependencies(): ProjectChatDependencies {
  return {
    now: () => Date.now(),
    readFile: defaultReadFile,
    searchWiki: defaultSearchWiki,
    buildRetrievalGraph: defaultBuildRetrievalGraph,
    getRelatedNodes: defaultGetRelatedNodes,
    streamChat: defaultStreamChat,
    getState: () => {
      const wiki = useWikiStore.getState()
      const chat = useChatStore.getState()

      return {
        project: wiki.project,
        llmConfig: wiki.llmConfig,
        dataVersion: wiki.dataVersion,
        messages: chat.messages,
        conversations: chat.conversations,
        maxHistoryMessages: chat.maxHistoryMessages,
      }
    },
    addMessage: (message) => {
      useChatStore.setState((state) => ({
        messages: [...state.messages, message],
      }))
    },
    upsertConversation: (conversation) => {
      useChatStore.setState((state) => {
        const exists = state.conversations.some((item) => item.id === conversation.id)
        return {
          conversations: exists
            ? state.conversations.map((item) => item.id === conversation.id ? conversation : item)
            : [conversation, ...state.conversations],
          activeConversationId: conversation.id,
        }
      })
    },
  }
}
```

- [ ] **Step 4: 实现上下文构建函数**

在同一文件追加：

```ts
const DEFAULT_MAX_CONTEXT_SIZE = 204800

export async function buildProjectChatContext(
  request: ProjectChatRequest,
  dependencies: ProjectChatDependencies = createDefaultProjectChatDependencies(),
): Promise<ProjectChatContext> {
  const state = dependencies.getState()
  const projectName = state.project?.name ?? "当前项目"
  const pp = normalizePath(request.projectPath)
  const message = request.message.trim()

  if (isGreeting(message)) {
    const outLang = getOutputLanguage(message)
    return {
      references: [],
      messages: [
        {
          role: "system",
          content: [
            `You are a wiki assistant for the project "${projectName}".`,
            "The user sent a casual greeting — reply briefly and naturally, in one or two sentences.",
            "Do NOT invent wiki content or pretend to have retrieved pages. Invite the user to ask a concrete question if they want information from the wiki.",
            "",
            `Respond in ${outLang}.`,
          ].join("\n"),
        },
        ...buildHistoryMessages(request.conversationId, state.messages, state.maxHistoryMessages),
      ],
    }
  }

  const maxCtx = state.llmConfig.maxContextSize || DEFAULT_MAX_CONTEXT_SIZE
  const indexBudget = Math.floor(maxCtx * 0.05)
  const pageBudget = Math.floor(maxCtx * 0.6)
  const maxPageSize = Math.min(Math.floor(pageBudget * 0.3), 30000)

  const [rawIndex, purpose] = await Promise.all([
    dependencies.readFile(`${pp}/wiki/index.md`).catch(() => ""),
    dependencies.readFile(`${pp}/purpose.md`).catch(() => ""),
  ])

  const searchResults = await dependencies.searchWiki(pp, message)
  const topSearchResults = searchResults.slice(0, 10)
  const index = trimIndexForQuestion(rawIndex, message, indexBudget)
  const graph = await dependencies.buildRetrievalGraph(pp, state.dataVersion)
  const expandedIds = new Set<string>()
  const searchHitPaths = new Set(topSearchResults.map((result) => normalizePath(result.path)))
  const graphExpansions: Array<{ title: string; path: string; relevance: number }> = []

  for (const result of topSearchResults) {
    const fileName = getFileName(result.path)
    const nodeId = fileName.replace(/\.md$/, "")
    const related = dependencies.getRelatedNodes(nodeId, graph, 3)
    for (const { node, relevance } of related) {
      if (relevance < 2.0) continue
      if (searchHitPaths.has(normalizePath(node.path))) continue
      if (expandedIds.has(node.id)) continue
      expandedIds.add(node.id)
      graphExpansions.push({ title: node.title, path: node.path, relevance })
    }
  }
  graphExpansions.sort((left, right) => right.relevance - left.relevance)

  let usedChars = 0
  const relevantPages: Array<{ title: string; path: string; content: string; priority: number }> = []

  async function tryAddPage(title: string, filePath: string, priority: number): Promise<void> {
    if (usedChars >= pageBudget) return
    try {
      const raw = await dependencies.readFile(filePath)
      const relativePath = getRelativePath(filePath, pp)
      const truncated = raw.length > maxPageSize ? `${raw.slice(0, maxPageSize)}\n\n[...truncated...]` : raw
      if (usedChars + truncated.length > pageBudget) return
      usedChars += truncated.length
      relevantPages.push({ title, path: relativePath, content: truncated, priority })
    } catch {
      return
    }
  }

  for (const result of topSearchResults.filter((result) => result.titleMatch)) {
    await tryAddPage(result.title, result.path, 0)
  }
  for (const result of topSearchResults.filter((result) => !result.titleMatch)) {
    await tryAddPage(result.title, result.path, 1)
  }
  for (const expansion of graphExpansions) {
    await tryAddPage(expansion.title, expansion.path, 2)
  }
  if (relevantPages.length === 0) {
    await tryAddPage("Overview", `${pp}/wiki/overview.md`, 3)
  }

  const pagesContext = relevantPages.length > 0
    ? relevantPages.map((page, index) =>
        `### [${index + 1}] ${page.title}\nPath: ${page.path}\n\n${page.content}`
      ).join("\n\n---\n\n")
    : "(No wiki pages found)"
  const pageList = relevantPages.map((page, index) => `[${index + 1}] ${page.title} (${page.path})`).join("\n")
  const outLang = getOutputLanguage(message)
  const languageReminder = buildLanguageReminder(message)
  const historyMessages = buildHistoryMessages(request.conversationId, state.messages, state.maxHistoryMessages)
  const references = relevantPages.map((page) => ({ title: page.title, path: page.path }))

  const systemMessage: LLMMessage = {
    role: "system",
    content: [
      "You are a knowledgeable wiki assistant. Answer questions based on the wiki content provided below.",
      "",
      "## Rules",
      "- Answer based ONLY on the numbered wiki pages provided below.",
      "- If the provided pages don't contain enough information, say so honestly.",
      "- Use [[wikilink]] syntax to reference wiki pages.",
      "- When citing information, use the page number in brackets, e.g. [1], [2].",
      "- At the VERY END of your response, add a hidden comment listing which page numbers you used:",
      "  <!-- cited: 1, 3, 5 -->",
      "",
      "Use markdown formatting for clarity.",
      "",
      purpose ? `## Wiki Purpose\n${purpose}` : "",
      index ? `## Wiki Index\n${index}` : "",
      relevantPages.length > 0 ? `## Page List\n${pageList}` : "",
      `## Wiki Pages\n\n${pagesContext}`,
      "",
      "---",
      "",
      `## MANDATORY OUTPUT LANGUAGE: ${outLang}`,
      "",
      `You MUST write your entire response in **${outLang}**.`,
      `Ignore the language of the wiki content. Write in ${outLang} only.`,
      "DO NOT use any other language. This overrides all other instructions.",
    ].filter(Boolean).join("\n"),
  }

  const currentUserMessage: LLMMessage = {
    role: "user",
    content: languageReminder ? `[${languageReminder}]\n\n${message}` : message,
  }

  return {
    references,
    messages: [systemMessage, ...historyMessages, currentUserMessage],
  }
}

function buildHistoryMessages(
  conversationId: string,
  messages: DisplayMessage[],
  maxHistoryMessages: number,
): LLMMessage[] {
  return chatMessagesToLLM(
    messages
      .filter((message) => message.conversationId === conversationId)
      .filter((message) => message.role === "user" || message.role === "assistant")
      .slice(-maxHistoryMessages),
  )
}

function trimIndexForQuestion(rawIndex: string, question: string, budget: number): string {
  if (rawIndex.length <= budget) return rawIndex
  const tokens = question
    .toLowerCase()
    .split(/[\s,，。！？、；：""''（）()\-_/\\·~～…]+/)
    .filter((token) => token.length > 1)
  const lines = rawIndex.split("\n")
  const keptLines: string[] = []
  let keptSize = 0
  for (const line of lines) {
    const lower = line.toLowerCase()
    const keep = line.startsWith("##") || tokens.some((token) => lower.includes(token))
    if (keep && keptSize + line.length + 1 <= budget) {
      keptLines.push(line)
      keptSize += line.length + 1
    }
  }
  return keptLines.length > 0 ? `${keptLines.join("\n")}\n\n[...index trimmed to relevant entries...]` : ""
}
```

- [ ] **Step 5: 实现发送函数**

在同一文件追加：

```ts
let messageCounter = 0

function nextBridgeMessageId(): string {
  messageCounter += 1
  return `bridge_${Date.now()}_${messageCounter}`
}

export async function sendProjectChatMessage(
  request: ProjectChatRequest,
  callbacks: ProjectChatCallbacks,
  dependencies: ProjectChatDependencies = createDefaultProjectChatDependencies(),
): Promise<void> {
  const state = dependencies.getState()
  const now = dependencies.now()
  const trimmed = request.message.trim()

  if (!trimmed) {
    callbacks.onError(new Error("消息不能为空。"))
    return
  }

  const existingConversation = state.conversations.find((item) => item.id === request.conversationId)
  const conversation: Conversation = existingConversation ?? {
    id: request.conversationId,
    title: trimmed.slice(0, 50) || "新会话",
    createdAt: now,
    updatedAt: now,
  }
  dependencies.upsertConversation({ ...conversation, updatedAt: now })

  const userMessage: DisplayMessage = {
    id: nextBridgeMessageId(),
    role: "user",
    content: trimmed,
    timestamp: now,
    conversationId: request.conversationId,
  }

  try {
    const context = await buildProjectChatContext(request, dependencies)
    dependencies.addMessage(userMessage)
    let accumulated = ""

    await dependencies.streamChat(
      state.llmConfig,
      context.messages,
      {
        onToken: (token) => {
          accumulated += token
          callbacks.onToken(token)
        },
        onDone: () => {
          const assistantMessage: DisplayMessage = {
            id: nextBridgeMessageId(),
            role: "assistant",
            content: accumulated,
            timestamp: dependencies.now(),
            conversationId: request.conversationId,
            references: context.references,
          }
          dependencies.addMessage(assistantMessage)
          dependencies.upsertConversation({
            ...conversation,
            title: conversation.title === "新会话" ? trimmed.slice(0, 50) : conversation.title,
            updatedAt: assistantMessage.timestamp,
          })
          callbacks.onReferences?.(context.references)
          callbacks.onDone(assistantMessage)
        },
        onError: (error) => callbacks.onError(error),
      },
      request.signal,
    )
  } catch (error) {
    callbacks.onError(error instanceof Error ? error : new Error(String(error)))
  }
}
```

- [ ] **Step 6: 验证**

Run:

```bash
npm run test:mocks -- src/lib/__tests__/project-chat-service.test.ts
npm run typecheck
```

Expected: 测试通过，`typecheck` 通过。

- [ ] **Step 7: 提交**

Run:

```bash
git add src/lib/project-chat-service.ts src/lib/__tests__/project-chat-service.test.ts
git commit -m "feat: extract desktop project chat service"
```

---

### Task 2: Desktop ChatPanel 改用共享 Service

**Files:**
- Modify: `src/components/chat/chat-panel.tsx`
- Test: `src/lib/__tests__/project-chat-service.test.ts`

- [ ] **Step 1: 添加回归测试场景**

在 `src/lib/__tests__/project-chat-service.test.ts` 的 `sendProjectChatMessage` describe 里追加：

```ts
  it("当已有会话存在时复用会话标题，只更新时间", async () => {
    const dependencies = deps()

    await sendProjectChatMessage(
      {
        projectId: "project_1",
        projectPath: "F:/project",
        conversationId: "conv_1",
        message: "schema 在哪里？",
      },
      {
        onToken: () => {},
        onDone: () => {},
        onError: (error) => {
          throw error
        },
      },
      dependencies,
    )

    expect(dependencies.getState().conversations[0]).toMatchObject({
      id: "conv_1",
      title: "旧会话",
      updatedAt: 2000,
    })
  })
```

- [ ] **Step 2: 运行测试**

Run:

```bash
npm run test:mocks -- src/lib/__tests__/project-chat-service.test.ts
```

Expected: PASS。这个测试锁定 service 行为，后面改 UI 时不应破坏。

- [ ] **Step 3: 精简 ChatPanel imports**

在 `src/components/chat/chat-panel.tsx`：

移除这些 import：

```ts
import { streamChat, type ChatMessage as LLMMessage } from "@/lib/llm-client"
import { searchWiki } from "@/lib/search"
import { buildRetrievalGraph, getRelatedNodes } from "@/lib/graph-relevance"
import { normalizePath, getFileName, getRelativePath } from "@/lib/path-utils"
import { getOutputLanguage, buildLanguageReminder } from "@/lib/output-language"
import { isGreeting } from "@/lib/greeting-detector"
```

保留 `normalizePath`，因为 `handleWriteToWiki` 仍然使用它。最终 imports 应包含：

```ts
import { normalizePath } from "@/lib/path-utils"
import { sendProjectChatMessage } from "@/lib/project-chat-service"
```

- [ ] **Step 4: 替换 `handleSend` 内部实现**

在 `ChatPanel` 的 `handleSend` 中，保留自动创建 conversation 的逻辑：

```ts
let convId = useChatStore.getState().activeConversationId
if (!convId) {
  convId = createConversation()
}
```

然后删除原来从 `addMessage("user", text)` 到 `await streamChat(...)` 的整段上下文构建和流式调用逻辑，替换为：

```ts
if (!project) return

setStreaming(true)

const controller = new AbortController()
abortRef.current = controller

await sendProjectChatMessage(
  {
    projectId: project.id,
    projectPath: project.path,
    conversationId: convId,
    message: text,
    signal: controller.signal,
  },
  {
    onToken: appendStreamToken,
    onReferences: (references) => {
      lastQueryPages = references.map((reference) => ({
        title: reference.title,
        path: reference.path,
      }))
    },
    onDone: () => {
      setStreaming(false)
      useChatStore.setState({ streamingContent: "" })
      abortRef.current = null
    },
    onError: (error) => {
      finalizeStream(`Error: ${error.message}`, undefined)
      abortRef.current = null
    },
  },
)
```

确保 `useChatStore` 的 selector 不再读取 `addMessage`、`finalizeStream` 之外不需要的变量。如果 `addMessage` 不再使用，从 selector 和 dependency array 中删除。

- [ ] **Step 5: 验证 desktop 编译**

Run:

```bash
npm run test:mocks -- src/lib/__tests__/project-chat-service.test.ts
npm run typecheck
```

Expected: 测试通过，`typecheck` 通过。`ChatPanel` 不应再直接调用 `streamChat()`。

- [ ] **Step 6: 提交**

Run:

```bash
git add src/components/chat/chat-panel.tsx src/lib/__tests__/project-chat-service.test.ts
git commit -m "refactor: route desktop chat panel through shared service"
```

---

### Task 3: Rust Web Bridge HTTP/SSE 服务

**Files:**
- Create: `src-tauri/src/web_bridge.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 写 Rust 单元测试**

创建 `src-tauri/src/web_bridge.rs`，先写测试和纯函数：

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BridgeStreamEvent {
    Token { text: String },
    References { references: Vec<BridgeReference> },
    Done { message: BridgeMessage },
    Error { code: String, message: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BridgeReference {
    pub title: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BridgeMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    #[serde(rename = "timestamp")]
    pub timestamp: i64,
    #[serde(rename = "conversationId")]
    pub conversation_id: String,
    #[serde(default)]
    pub references: Vec<BridgeReference>,
}

pub fn format_sse_event(event: &BridgeStreamEvent) -> String {
    let event_name = match event {
        BridgeStreamEvent::Token { .. } => "token",
        BridgeStreamEvent::References { .. } => "references",
        BridgeStreamEvent::Done { .. } => "done",
        BridgeStreamEvent::Error { .. } => "error",
    };
    let data = serde_json::to_string(event).unwrap_or_else(|_| {
        r#"{"type":"error","code":"SERIALIZE_ERROR","message":"事件序列化失败"}"#.to_string()
    });
    format!("event: {}\ndata: {}\n\n", event_name, data)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_token_sse_event() {
        let sse = format_sse_event(&BridgeStreamEvent::Token {
            text: "你好".to_string(),
        });

        assert!(sse.starts_with("event: token\n"));
        assert!(sse.contains(r#""type":"token""#));
        assert!(sse.ends_with("\n\n"));
    }

    #[test]
    fn formats_done_sse_event_with_message() {
        let sse = format_sse_event(&BridgeStreamEvent::Done {
            message: BridgeMessage {
                id: "m1".to_string(),
                role: "assistant".to_string(),
                content: "回答".to_string(),
                timestamp: 123,
                conversation_id: "conv_1".to_string(),
                references: vec![BridgeReference {
                    title: "Schema".to_string(),
                    path: "wiki/schema.md".to_string(),
                }],
            },
        });

        assert!(sse.starts_with("event: done\n"));
        assert!(sse.contains(r#""conversationId":"conv_1""#));
        assert!(sse.contains(r#""wiki/schema.md""#));
    }
}
```

- [ ] **Step 2: 运行测试**

Run:

```bash
cd src-tauri
cargo test web_bridge --lib
cd ..
```

Expected: PASS。

- [ ] **Step 3: 实现 request registry 和 Tauri commands**

在 `src-tauri/src/web_bridge.rs` 顶部追加 imports 和 registry：

```rust
use std::collections::HashMap;
use std::io::{Read, Result as IoResult};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Mutex, OnceLock};
use std::thread;
use tiny_http::{Header, Method, Response, Server};
use tauri::{AppHandle, Emitter};

static NEXT_REQUEST_ID: AtomicU64 = AtomicU64::new(1);
static STREAMS: OnceLock<Mutex<HashMap<String, mpsc::Sender<BridgeStreamEvent>>>> = OnceLock::new();
static JSON_REQUESTS: OnceLock<Mutex<HashMap<String, mpsc::Sender<BridgeJsonResponse>>>> = OnceLock::new();

fn streams() -> &'static Mutex<HashMap<String, mpsc::Sender<BridgeStreamEvent>>> {
    STREAMS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn json_requests() -> &'static Mutex<HashMap<String, mpsc::Sender<BridgeJsonResponse>>> {
    JSON_REQUESTS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn next_request_id() -> String {
    let id = NEXT_REQUEST_ID.fetch_add(1, Ordering::Relaxed);
    format!("bridge_req_{}", id)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BridgeJsonResponse {
    pub status: u16,
    pub body: serde_json::Value,
}

fn send_to_stream(request_id: &str, event: BridgeStreamEvent) -> Result<(), String> {
    let sender = {
        let guard = streams().lock().map_err(|error| format!("Lock error: {error}"))?;
        guard.get(request_id).cloned()
    };

    match sender {
        Some(sender) => sender.send(event).map_err(|error| format!("Send error: {error}")),
        None => Err(format!("Unknown bridge request id: {request_id}")),
    }
}

fn send_json_response(request_id: &str, response: BridgeJsonResponse) -> Result<(), String> {
    let sender = {
        let mut guard = json_requests().lock().map_err(|error| format!("Lock error: {error}"))?;
        guard.remove(request_id)
    };

    match sender {
        Some(sender) => sender.send(response).map_err(|error| format!("Send error: {error}")),
        None => Err(format!("Unknown bridge JSON request id: {request_id}")),
    }
}

#[tauri::command]
pub fn web_bridge_emit_token(request_id: String, text: String) -> Result<(), String> {
    send_to_stream(&request_id, BridgeStreamEvent::Token { text })
}

#[tauri::command]
pub fn web_bridge_emit_references(request_id: String, references: Vec<BridgeReference>) -> Result<(), String> {
    send_to_stream(&request_id, BridgeStreamEvent::References { references })
}

#[tauri::command]
pub fn web_bridge_emit_done(request_id: String, message: BridgeMessage) -> Result<(), String> {
    let result = send_to_stream(&request_id, BridgeStreamEvent::Done { message });
    if let Ok(mut guard) = streams().lock() {
        guard.remove(&request_id);
    }
    result
}

#[tauri::command]
pub fn web_bridge_emit_error(request_id: String, code: String, message: String) -> Result<(), String> {
    let result = send_to_stream(&request_id, BridgeStreamEvent::Error { code, message });
    if let Ok(mut guard) = streams().lock() {
        guard.remove(&request_id);
    }
    result
}

#[tauri::command]
pub fn web_bridge_respond_json(request_id: String, status: u16, body: serde_json::Value) -> Result<(), String> {
    send_json_response(&request_id, BridgeJsonResponse { status, body })
}
```

- [ ] **Step 4: 实现 SSE reader**

在同一文件追加：

```rust
struct SseReceiverReader {
    receiver: mpsc::Receiver<BridgeStreamEvent>,
    buffer: Vec<u8>,
    done: bool,
}

impl SseReceiverReader {
    fn new(receiver: mpsc::Receiver<BridgeStreamEvent>) -> Self {
        Self {
            receiver,
            buffer: Vec::new(),
            done: false,
        }
    }
}

impl Read for SseReceiverReader {
    fn read(&mut self, target: &mut [u8]) -> IoResult<usize> {
        while self.buffer.is_empty() && !self.done {
            match self.receiver.recv() {
                Ok(event) => {
                    self.done = matches!(event, BridgeStreamEvent::Done { .. } | BridgeStreamEvent::Error { .. });
                    self.buffer = format_sse_event(&event).into_bytes();
                }
                Err(_) => {
                    self.done = true;
                }
            }
        }

        if self.buffer.is_empty() {
            return Ok(0);
        }

        let amount = target.len().min(self.buffer.len());
        target[..amount].copy_from_slice(&self.buffer[..amount]);
        self.buffer.drain(..amount);
        Ok(amount)
    }
}
```

- [ ] **Step 5: 实现 HTTP 服务**

在同一文件追加：

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
struct BridgeChatRequestPayload {
    #[serde(rename = "requestId")]
    request_id: String,
    #[serde(rename = "projectId")]
    project_id: String,
    #[serde(rename = "projectPath")]
    project_path: String,
    #[serde(rename = "conversationId")]
    conversation_id: String,
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BridgeJsonRequestPayload {
    #[serde(rename = "requestId")]
    request_id: String,
    kind: String,
    #[serde(rename = "projectId")]
    project_id: String,
    #[serde(rename = "projectPath")]
    project_path: Option<String>,
    #[serde(rename = "conversationId")]
    conversation_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct IncomingStreamBody {
    #[serde(rename = "projectPath")]
    project_path: String,
    message: String,
}

pub fn start_web_bridge(app: AppHandle) {
    thread::spawn(move || {
        let server = match Server::http("127.0.0.1:19828") {
            Ok(server) => server,
            Err(error) => {
                eprintln!("[Web Bridge] Failed to bind 127.0.0.1:19828: {error}");
                return;
            }
        };

        println!("[Web Bridge] Listening on http://127.0.0.1:19828");

        for mut request in server.incoming_requests() {
            let url = request.url().to_string();
            let method = request.method().clone();

            if method == Method::Options {
                let _ = request.respond(with_cors(Response::from_string("").with_status_code(204)));
                continue;
            }

            if method == Method::Get && url == "/health" {
                let body = serde_json::json!({
                    "ok": true,
                    "service": "llm-wiki-web-bridge",
                    "version": "0.1.0",
                }).to_string();
                let _ = request.respond(with_cors(json_response(body, 200)));
                continue;
            }

            if method == Method::Get && url.starts_with("/projects/") && url.ends_with("/conversations") {
                let parts: Vec<&str> = url.trim_matches('/').split('/').collect();
                if parts.len() != 3 || parts[0] != "projects" || parts[2] != "conversations" {
                    let _ = request.respond(with_cors(json_response(r#"{"ok":false,"error":"Not found"}"#.to_string(), 404)));
                    continue;
                }

                let response = dispatch_json_request(&app, BridgeJsonRequestPayload {
                    request_id: next_request_id(),
                    kind: "list_conversations".to_string(),
                    project_id: parts[1].to_string(),
                    project_path: None,
                    conversation_id: None,
                });
                let _ = request.respond(with_cors(json_response(response.body.to_string(), response.status)));
                continue;
            }

            if method == Method::Post && url.starts_with("/projects/") && url.ends_with("/conversations") {
                let parts: Vec<&str> = url.trim_matches('/').split('/').collect();
                if parts.len() != 3 || parts[0] != "projects" || parts[2] != "conversations" {
                    let _ = request.respond(with_cors(json_response(r#"{"ok":false,"error":"Not found"}"#.to_string(), 404)));
                    continue;
                }

                let response = dispatch_json_request(&app, BridgeJsonRequestPayload {
                    request_id: next_request_id(),
                    kind: "create_conversation".to_string(),
                    project_id: parts[1].to_string(),
                    project_path: None,
                    conversation_id: None,
                });
                let _ = request.respond(with_cors(json_response(response.body.to_string(), response.status)));
                continue;
            }

            if method == Method::Get && url.contains("/conversations/") && url.ends_with("/messages") {
                let parts: Vec<&str> = url.trim_matches('/').split('/').collect();
                if parts.len() != 5 || parts[0] != "projects" || parts[2] != "conversations" || parts[4] != "messages" {
                    let _ = request.respond(with_cors(json_response(r#"{"ok":false,"error":"Not found"}"#.to_string(), 404)));
                    continue;
                }

                let response = dispatch_json_request(&app, BridgeJsonRequestPayload {
                    request_id: next_request_id(),
                    kind: "list_messages".to_string(),
                    project_id: parts[1].to_string(),
                    project_path: None,
                    conversation_id: Some(parts[3].to_string()),
                });
                let _ = request.respond(with_cors(json_response(response.body.to_string(), response.status)));
                continue;
            }

            if method == Method::Post && url.contains("/messages/stream") {
                let mut body = String::new();
                if let Err(error) = request.as_reader().read_to_string(&mut body) {
                    let response = json_response(
                        serde_json::json!({"ok": false, "error": format!("Failed to read body: {error}")}).to_string(),
                        400,
                    );
                    let _ = request.respond(with_cors(response));
                    continue;
                }

                let incoming: IncomingStreamBody = match serde_json::from_str(&body) {
                    Ok(value) => value,
                    Err(error) => {
                        let response = json_response(
                            serde_json::json!({"ok": false, "error": format!("Invalid JSON: {error}")}).to_string(),
                            400,
                        );
                        let _ = request.respond(with_cors(response));
                        continue;
                    }
                };

                let parts: Vec<&str> = url.trim_matches('/').split('/').collect();
                if parts.len() != 6 || parts[0] != "projects" || parts[2] != "conversations" || parts[4] != "messages" || parts[5] != "stream" {
                    let _ = request.respond(with_cors(json_response(r#"{"ok":false,"error":"Not found"}"#.to_string(), 404)));
                    continue;
                }

                let request_id = next_request_id();
                let (sender, receiver) = mpsc::channel::<BridgeStreamEvent>();
                if let Ok(mut guard) = streams().lock() {
                    guard.insert(request_id.clone(), sender);
                }

                let payload = BridgeChatRequestPayload {
                    request_id: request_id.clone(),
                    project_id: parts[1].to_string(),
                    project_path: incoming.project_path,
                    conversation_id: parts[3].to_string(),
                    message: incoming.message,
                };

                if let Err(error) = app.emit("web-bridge:chat-request", payload) {
                    let _ = send_to_stream(
                        &request_id,
                        BridgeStreamEvent::Error {
                            code: "BRIDGE_EVENT_ERROR".to_string(),
                            message: format!("无法发送桌面端事件: {error}"),
                        },
                    );
                }

                let mut response = Response::from_reader(SseReceiverReader::new(receiver));
                response.add_header(Header::from_bytes("Content-Type", "text/event-stream; charset=utf-8").unwrap());
                response.add_header(Header::from_bytes("Cache-Control", "no-cache").unwrap());
                response.add_header(Header::from_bytes("Connection", "keep-alive").unwrap());
                let _ = request.respond(with_cors(response));
                continue;
            }

            let _ = request.respond(with_cors(json_response(r#"{"ok":false,"error":"Not found"}"#.to_string(), 404)));
        }
    });
}

fn dispatch_json_request(app: &AppHandle, payload: BridgeJsonRequestPayload) -> BridgeJsonResponse {
    let (sender, receiver) = mpsc::channel::<BridgeJsonResponse>();
    if let Ok(mut guard) = json_requests().lock() {
        guard.insert(payload.request_id.clone(), sender);
    }

    if let Err(error) = app.emit("web-bridge:json-request", payload.clone()) {
        if let Ok(mut guard) = json_requests().lock() {
            guard.remove(&payload.request_id);
        }
        return BridgeJsonResponse {
            status: 500,
            body: serde_json::json!({
                "ok": false,
                "error": format!("无法发送桌面端 JSON 事件: {error}")
            }),
        };
    }

    match receiver.recv_timeout(std::time::Duration::from_secs(10)) {
        Ok(response) => response,
        Err(error) => {
            if let Ok(mut guard) = json_requests().lock() {
                guard.remove(&payload.request_id);
            }
            BridgeJsonResponse {
                status: 504,
                body: serde_json::json!({
                    "ok": false,
                    "error": format!("桌面端 JSON 响应超时: {error}")
                }),
            }
        }
    }
}

fn json_response(body: String, status: u16) -> Response<std::io::Cursor<Vec<u8>>> {
    let mut response = Response::from_string(body).with_status_code(status);
    response.add_header(Header::from_bytes("Content-Type", "application/json").unwrap());
    response
}

fn with_cors<R: Read + Send + 'static>(mut response: Response<R>) -> Response<R> {
    response.add_header(Header::from_bytes("Access-Control-Allow-Origin", "http://localhost:52060").unwrap());
    response.add_header(Header::from_bytes("Access-Control-Allow-Methods", "GET, POST, OPTIONS").unwrap());
    response.add_header(Header::from_bytes("Access-Control-Allow-Headers", "Content-Type").unwrap());
    response
}
```

- [ ] **Step 6: 注册模块和 commands**

在 `src-tauri/src/lib.rs` 顶部加入：

```rust
mod web_bridge;
```

在 `.setup(|app| { ... })` 中 `Ok(())` 前加入：

```rust
            web_bridge::start_web_bridge(app.handle().clone());
```

在 `tauri::generate_handler![...]` 中加入：

```rust
            web_bridge::web_bridge_emit_token,
            web_bridge::web_bridge_emit_references,
            web_bridge::web_bridge_emit_done,
            web_bridge::web_bridge_emit_error,
            web_bridge::web_bridge_respond_json,
```

- [ ] **Step 7: 验证**

Run:

```bash
cd src-tauri
cargo test web_bridge --lib
cargo check
cd ..
```

Expected: Rust 测试通过，`cargo check` 通过。

- [ ] **Step 8: 提交**

Run:

```bash
git add src-tauri/src/web_bridge.rs src-tauri/src/lib.rs
git commit -m "feat: add desktop web bridge server"
```

---

### Task 4: Desktop 前端 Bridge Handler

**Files:**
- Create: `src/lib/web-bridge-handler.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: 创建 handler**

创建 `src/lib/web-bridge-handler.ts`：

```ts
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { invoke } from "@tauri-apps/api/core"

import { sendProjectChatMessage } from "@/lib/project-chat-service"
import { useChatStore, type Conversation, type DisplayMessage, type MessageReference } from "@/stores/chat-store"

interface WebBridgeChatRequest {
  requestId: string
  projectId: string
  projectPath: string
  conversationId: string
  message: string
}

interface WebBridgeJsonRequest {
  requestId: string
  kind: "list_conversations" | "create_conversation" | "list_messages"
  projectId: string
  projectPath?: string
  conversationId?: string
}

let unlisten: UnlistenFn | null = null
let unlistenJson: UnlistenFn | null = null

export async function startWebBridgeHandler(): Promise<void> {
  if (unlisten && unlistenJson) return

  unlisten = await listen<WebBridgeChatRequest>("web-bridge:chat-request", async (event) => {
    const request = event.payload

    await sendProjectChatMessage(
      {
        projectId: request.projectId,
        projectPath: request.projectPath,
        conversationId: request.conversationId,
        message: request.message,
      },
      {
        onToken: (token) => {
          void invoke("web_bridge_emit_token", {
            requestId: request.requestId,
            text: token,
          })
        },
        onReferences: (references) => {
          void invoke("web_bridge_emit_references", {
            requestId: request.requestId,
            references: references.map(toBridgeReference),
          })
        },
        onDone: (message) => {
          void invoke("web_bridge_emit_done", {
            requestId: request.requestId,
            message: toBridgeMessage(message),
          })
        },
        onError: (error) => {
          void invoke("web_bridge_emit_error", {
            requestId: request.requestId,
            code: "PROJECT_CHAT_ERROR",
            message: error.message,
          })
        },
      },
    )
  })

  unlistenJson = await listen<WebBridgeJsonRequest>("web-bridge:json-request", async (event) => {
    const request = event.payload
    try {
      const body = handleJsonRequest(request)
      await invoke("web_bridge_respond_json", {
        requestId: request.requestId,
        status: 200,
        body,
      })
    } catch (error) {
      await invoke("web_bridge_respond_json", {
        requestId: request.requestId,
        status: 500,
        body: {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
      })
    }
  })
}

export function stopWebBridgeHandler(): void {
  unlisten?.()
  unlistenJson?.()
  unlisten = null
  unlistenJson = null
}

function handleJsonRequest(request: WebBridgeJsonRequest) {
  const chat = useChatStore.getState()

  if (request.kind === "list_conversations") {
    return {
      ok: true,
      conversations: [...chat.conversations].sort((left, right) => right.updatedAt - left.updatedAt),
    }
  }

  if (request.kind === "create_conversation") {
    const id = chat.createConversation()
    const conversation = useChatStore.getState().conversations.find((item) => item.id === id)
    return {
      ok: true,
      conversation: conversation ?? makeFallbackConversation(id),
    }
  }

  if (request.kind === "list_messages") {
    if (!request.conversationId) {
      return {
        ok: false,
        messages: [],
        error: "conversationId is required",
      }
    }

    return {
      ok: true,
      messages: chat.messages.filter((message) => message.conversationId === request.conversationId),
    }
  }

  return {
    ok: false,
    error: `Unsupported bridge JSON request: ${request.kind}`,
  }
}

function makeFallbackConversation(id: string): Conversation {
  const now = Date.now()
  return {
    id,
    title: "New Conversation",
    createdAt: now,
    updatedAt: now,
  }
}

function toBridgeReference(reference: MessageReference) {
  return {
    title: reference.title,
    path: reference.path,
  }
}

function toBridgeMessage(message: DisplayMessage) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
    conversationId: message.conversationId,
    references: message.references?.map(toBridgeReference) ?? [],
  }
}
```

- [ ] **Step 2: 在 App 启动 handler**

在 `src/App.tsx` imports 加入：

```ts
import { startWebBridgeHandler } from "@/lib/web-bridge-handler"
```

在顶层初始化 effect 中加入：

```ts
  useEffect(() => {
    startWebBridgeHandler().catch((error) => {
      console.error("Failed to start web bridge handler:", error)
    })
  }, [])
```

如果 `App.tsx` 已有只运行一次的初始化 effect，把这段放入那个 effect 内，避免多次注册 listener。

- [ ] **Step 3: 验证**

Run:

```bash
npm run typecheck
```

Expected: `typecheck` 通过。

- [ ] **Step 4: 手动 smoke test**

Run desktop:

```bash
npm run tauri dev
```

Then in another terminal:

```bash
curl http://127.0.0.1:19828/health
```

Expected:

```json
{"ok":true,"service":"llm-wiki-web-bridge","version":"0.1.0"}
```

- [ ] **Step 5: 提交**

Run:

```bash
git add src/lib/web-bridge-handler.ts src/App.tsx
git commit -m "feat: connect desktop web bridge handler"
```

---

### Task 5: Web Bridge 类型与服务端 Client

**Files:**
- Modify: `web/src/lib/types.ts`
- Create: `web/src/lib/server/desktop-bridge-client.ts`
- Create: `web/src/lib/server/__tests__/desktop-bridge-client.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `web/src/lib/server/__tests__/desktop-bridge-client.test.ts`：

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DesktopBridgeUnavailableError,
  fetchDesktopBridgeJson,
  getDesktopBridgeBaseUrl,
} from "../desktop-bridge-client";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getDesktopBridgeBaseUrl", () => {
  it("默认使用本机 19828", () => {
    expect(getDesktopBridgeBaseUrl({})).toBe("http://127.0.0.1:19828");
  });

  it("允许通过环境变量覆盖", () => {
    expect(
      getDesktopBridgeBaseUrl({
        LLM_WIKI_DESKTOP_BRIDGE_URL: "http://127.0.0.1:29999/",
      }),
    ).toBe("http://127.0.0.1:29999");
  });
});

describe("fetchDesktopBridgeJson", () => {
  it("返回 bridge JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true, value: 1 }))),
    );

    await expect(fetchDesktopBridgeJson("/health")).resolves.toEqual({
      ok: true,
      value: 1,
    });
  });

  it("连接失败时抛出 DESKTOP_BRIDGE_UNAVAILABLE", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));

    await expect(fetchDesktopBridgeJson("/health")).rejects.toBeInstanceOf(
      DesktopBridgeUnavailableError,
    );
  });

  it("bridge 返回非 2xx 时保留状态码", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: false, error: "bad" }), { status: 409 })),
    );

    await expect(fetchDesktopBridgeJson("/bad")).rejects.toMatchObject({
      code: "DESKTOP_BRIDGE_ERROR",
      status: 409,
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd web
npm run test -- src/lib/server/__tests__/desktop-bridge-client.test.ts
cd ..
```

Expected: 失败，提示模块不存在。

- [ ] **Step 3: 新增 Web 类型**

在 `web/src/lib/types.ts` 追加：

```ts
export interface DesktopBridgeReference {
  title: string;
  path: string;
}

export interface DesktopBridgeConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface DesktopBridgeMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  conversationId: string;
  references?: DesktopBridgeReference[];
}

export type DesktopBridgeStreamEvent =
  | { type: "token"; text: string }
  | { type: "references"; references: DesktopBridgeReference[] }
  | { type: "done"; message: DesktopBridgeMessage }
  | { type: "error"; code: string; message: string };
```

- [ ] **Step 4: 实现 bridge client**

创建 `web/src/lib/server/desktop-bridge-client.ts`：

```ts
import { AppError } from "./app-error";

const DEFAULT_DESKTOP_BRIDGE_URL = "http://127.0.0.1:19828";

type EnvironmentLike = Readonly<Record<string, string | undefined>>;

export class DesktopBridgeUnavailableError extends AppError {
  constructor(cause?: unknown) {
    super(
      "DESKTOP_BRIDGE_UNAVAILABLE",
      503,
      "桌面端问答服务未连接。请先打开桌面端应用，并确认 Web Bridge 已运行。",
      { cause },
    );
  }
}

export function getDesktopBridgeBaseUrl(env: EnvironmentLike = process.env): string {
  return (env.LLM_WIKI_DESKTOP_BRIDGE_URL?.trim() || DEFAULT_DESKTOP_BRIDGE_URL).replace(/\/+$/, "");
}

export async function fetchDesktopBridgeJson<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetchDesktopBridge(path, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new AppError("DESKTOP_BRIDGE_ERROR", response.status, "桌面端问答服务返回错误。", {
      publicDetails: {
        bridgeStatus: response.status,
        bridgeBody: errorText.slice(0, 500),
      },
    });
  }

  return response.json() as Promise<T>;
}

export async function fetchDesktopBridgeStream(path: string, init: RequestInit): Promise<Response> {
  const response = await fetchDesktopBridge(path, {
    ...init,
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new AppError("DESKTOP_BRIDGE_ERROR", response.status, "桌面端问答服务返回错误。", {
      publicDetails: {
        bridgeStatus: response.status,
        bridgeBody: errorText.slice(0, 500),
      },
    });
  }

  return response;
}

async function fetchDesktopBridge(path: string, init: RequestInit): Promise<Response> {
  const baseUrl = getDesktopBridgeBaseUrl();
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

  try {
    return await fetch(url, init);
  } catch (error) {
    throw new DesktopBridgeUnavailableError(error);
  }
}
```

- [ ] **Step 5: 验证**

Run:

```bash
cd web
npm run test -- src/lib/server/__tests__/desktop-bridge-client.test.ts
npm run typecheck
cd ..
```

Expected: 测试通过，`typecheck` 通过。

- [ ] **Step 6: 提交**

Run:

```bash
git add web/src/lib/types.ts web/src/lib/server/desktop-bridge-client.ts web/src/lib/server/__tests__/desktop-bridge-client.test.ts
git commit -m "feat: add web desktop bridge client"
```

---

### Task 6: Web API 代理 Routes

**Files:**
- Create: `web/src/app/api/projects/[projectId]/question/conversations/route.ts`
- Create: `web/src/app/api/projects/[projectId]/question/conversations/[conversationId]/messages/route.ts`
- Create: `web/src/app/api/projects/[projectId]/question/conversations/[conversationId]/messages/stream/route.ts`
- Create: `web/src/app/api/projects/[projectId]/question/conversations/__tests__/route.test.ts`

- [ ] **Step 1: 写 route 测试**

创建 `web/src/app/api/projects/[projectId]/question/conversations/__tests__/route.test.ts`：

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

const bridgeMocks = vi.hoisted(() => ({
  fetchDesktopBridgeJson: vi.fn(),
  fetchDesktopBridgeStream: vi.fn(),
}));

vi.mock("@/lib/server/desktop-bridge-client", () => ({
  fetchDesktopBridgeJson: bridgeMocks.fetchDesktopBridgeJson,
  fetchDesktopBridgeStream: bridgeMocks.fetchDesktopBridgeStream,
}));

vi.mock("@/lib/server/env", () => ({
  getProjectRootsFromEnv: () => ["F:/project"],
}));

vi.mock("@/lib/server/project-registry", () => ({
  resolveProjectById: async (_roots: string[], projectId: string) => {
    if (projectId !== "project_1") {
      const { AppError } = await import("@/lib/server/app-error");
      throw new AppError("PROJECT_NOT_FOUND", 404, "项目不存在。");
    }
    return {
      id: "project_1",
      rootDir: "F:/project",
      name: "项目",
    };
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("desktop bridge conversation routes", () => {
  it("GET conversations proxies to desktop bridge with project id", async () => {
    bridgeMocks.fetchDesktopBridgeJson.mockResolvedValue({
      ok: true,
      conversations: [{ id: "conv_1", title: "会话", createdAt: 1, updatedAt: 2 }],
    });
    const mod = await import("../route");

    const response = await mod.GET(new Request("http://localhost/api"), {
      params: Promise.resolve({ projectId: "project_1" }),
    });

    expect(response.status).toBe(200);
    expect(bridgeMocks.fetchDesktopBridgeJson).toHaveBeenCalledWith("/projects/project_1/conversations");
  });

  it("POST conversations proxies creation", async () => {
    bridgeMocks.fetchDesktopBridgeJson.mockResolvedValue({
      ok: true,
      conversation: { id: "conv_2", title: "新会话", createdAt: 1, updatedAt: 1 },
    });
    const mod = await import("../route");

    const response = await mod.POST(new Request("http://localhost/api", { method: "POST" }), {
      params: Promise.resolve({ projectId: "project_1" }),
    });

    expect(response.status).toBe(200);
    expect(bridgeMocks.fetchDesktopBridgeJson).toHaveBeenCalledWith(
      "/projects/project_1/conversations",
      { method: "POST" },
    );
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd web
npm run test -- "src/app/api/projects/[projectId]/question/conversations/__tests__/route.test.ts"
cd ..
```

Expected: 失败，route 文件不存在。

- [ ] **Step 3: 实现 conversations route**

创建 `web/src/app/api/projects/[projectId]/question/conversations/route.ts`：

```ts
import { getProjectRootsFromEnv } from "@/lib/server/env";
import { fetchDesktopBridgeJson } from "@/lib/server/desktop-bridge-client";
import { resolveProjectById } from "@/lib/server/project-registry";
import { errorJson, okJson } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

export async function GET(_request: Request, context: ProjectRouteContext) {
  try {
    const { projectId } = await context.params;
    await resolveProjectById(getProjectRootsFromEnv(), projectId);
    const response = await fetchDesktopBridgeJson(`/projects/${encodeURIComponent(projectId)}/conversations`);
    return okJson(response);
  } catch (error) {
    return errorJson(error);
  }
}

export async function POST(_request: Request, context: ProjectRouteContext) {
  try {
    const { projectId } = await context.params;
    await resolveProjectById(getProjectRootsFromEnv(), projectId);
    const response = await fetchDesktopBridgeJson(
      `/projects/${encodeURIComponent(projectId)}/conversations`,
      { method: "POST" },
    );
    return okJson(response);
  } catch (error) {
    return errorJson(error);
  }
}
```

- [ ] **Step 4: 实现 messages route**

创建 `web/src/app/api/projects/[projectId]/question/conversations/[conversationId]/messages/route.ts`：

```ts
import { getProjectRootsFromEnv } from "@/lib/server/env";
import { fetchDesktopBridgeJson } from "@/lib/server/desktop-bridge-client";
import { resolveProjectById } from "@/lib/server/project-registry";
import { errorJson, okJson } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

interface MessagesRouteContext {
  params: Promise<{ projectId: string; conversationId: string }>;
}

export async function GET(_request: Request, context: MessagesRouteContext) {
  try {
    const { projectId, conversationId } = await context.params;
    await resolveProjectById(getProjectRootsFromEnv(), projectId);
    const response = await fetchDesktopBridgeJson(
      `/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/messages`,
    );
    return okJson(response);
  } catch (error) {
    return errorJson(error);
  }
}
```

- [ ] **Step 5: 实现 stream route**

创建 `web/src/app/api/projects/[projectId]/question/conversations/[conversationId]/messages/stream/route.ts`：

```ts
import { AppError } from "@/lib/server/app-error";
import { getProjectRootsFromEnv } from "@/lib/server/env";
import { fetchDesktopBridgeStream } from "@/lib/server/desktop-bridge-client";
import { resolveProjectById } from "@/lib/server/project-registry";
import { errorJson } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

interface StreamRouteContext {
  params: Promise<{ projectId: string; conversationId: string }>;
}

export async function POST(request: Request, context: StreamRouteContext) {
  try {
    const { projectId, conversationId } = await context.params;
    const project = await resolveProjectById(getProjectRootsFromEnv(), projectId);
    const body = await parseBody(request);
    const bridgeResponse = await fetchDesktopBridgeStream(
      `/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/messages/stream`,
      {
        method: "POST",
        body: JSON.stringify({
          projectPath: project.rootDir,
          message: body.message,
        }),
      },
    );

    return new Response(bridgeResponse.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return errorJson(error);
  }
}

async function parseBody(request: Request): Promise<{ message: string }> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    throw new AppError("INVALID_REQUEST_BODY", 400, "请求内容格式无效。", { cause: error });
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AppError("INVALID_REQUEST_BODY", 400, "请求内容必须是对象。");
  }

  const message = (payload as { message?: unknown }).message;
  if (typeof message !== "string" || message.trim().length < 1) {
    throw new AppError("INVALID_REQUEST_BODY", 400, "消息不能为空。");
  }

  return { message: message.trim() };
}
```

- [ ] **Step 6: 验证**

Run:

```bash
cd web
npm run test -- "src/app/api/projects/[projectId]/question/conversations/__tests__/route.test.ts"
npm run typecheck
cd ..
```

Expected: 测试通过，`typecheck` 通过。

- [ ] **Step 7: 提交**

Run:

```bash
git add web/src/app/api/projects/[projectId]/question/conversations
git add web/src/app/api/projects/[projectId]/question/conversations/[conversationId]
git commit -m "feat: proxy web question routes to desktop bridge"
```

---

### Task 7: Web 浏览器端 Client 与聊天 UI

**Files:**
- Create: `web/src/lib/client/desktop-question-api.ts`
- Modify: `web/src/components/workbench/project-question-panel.tsx`
- Modify: `web/src/components/workbench/project-question-panel.test.tsx`
- Modify: `web/src/components/workbench/project-workbench.tsx`

- [ ] **Step 1: 实现浏览器端 API client**

创建 `web/src/lib/client/desktop-question-api.ts`：

```ts
import type {
  DesktopBridgeConversation,
  DesktopBridgeMessage,
  DesktopBridgeStreamEvent,
} from "@/lib/types";

import { requestJson } from "./api";

export async function listQuestionConversations(projectId: string): Promise<DesktopBridgeConversation[]> {
  const response = await requestJson<{ ok: true; conversations: DesktopBridgeConversation[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/question/conversations`,
  );
  return response.conversations;
}

export async function createQuestionConversation(projectId: string): Promise<DesktopBridgeConversation> {
  const response = await requestJson<{ ok: true; conversation: DesktopBridgeConversation }>(
    `/api/projects/${encodeURIComponent(projectId)}/question/conversations`,
    { method: "POST" },
  );
  return response.conversation;
}

export async function listQuestionMessages(
  projectId: string,
  conversationId: string,
): Promise<DesktopBridgeMessage[]> {
  const response = await requestJson<{ ok: true; messages: DesktopBridgeMessage[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/question/conversations/${encodeURIComponent(conversationId)}/messages`,
  );
  return response.messages;
}

export async function streamQuestionMessage(
  projectId: string,
  conversationId: string,
  message: string,
  handlers: {
    onEvent: (event: DesktopBridgeStreamEvent) => void;
    signal?: AbortSignal;
  },
): Promise<void> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/question/conversations/${encodeURIComponent(conversationId)}/messages/stream`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
      signal: handlers.signal,
    },
  );

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error(text || "桌面端问答请求失败。");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const event = parseSseBlock(block);
      if (event) handlers.onEvent(event);
    }
  }
}

export function parseSseBlock(block: string): DesktopBridgeStreamEvent | null {
  const dataLine = block
    .split(/\r?\n/)
    .find((line) => line.startsWith("data:"));

  if (!dataLine) return null;
  const raw = dataLine.slice("data:".length).trim();
  if (!raw) return null;

  const parsed = JSON.parse(raw) as DesktopBridgeStreamEvent;
  if (
    parsed.type === "token" ||
    parsed.type === "references" ||
    parsed.type === "done" ||
    parsed.type === "error"
  ) {
    return parsed;
  }
  return null;
}
```

如果 `requestJson` 当前没有 export，需要在 `web/src/lib/client/api.ts` 把它改为：

```ts
export async function requestJson<T>(...)
```

- [ ] **Step 2: 写 UI 测试**

更新 `web/src/components/workbench/project-question-panel.test.tsx`，核心 mock：

```ts
vi.mock("@/lib/client/desktop-question-api", () => ({
  listQuestionConversations: vi.fn(async () => [
    { id: "conv_1", title: "会话", createdAt: 1, updatedAt: 2 },
  ]),
  createQuestionConversation: vi.fn(async () => ({
    id: "conv_2",
    title: "新会话",
    createdAt: 3,
    updatedAt: 3,
  })),
  listQuestionMessages: vi.fn(async () => [
    {
      id: "m1",
      role: "user",
      content: "schema 在哪里？",
      timestamp: 1,
      conversationId: "conv_1",
    },
  ]),
  streamQuestionMessage: vi.fn(async (_projectId, _conversationId, _message, handlers) => {
    handlers.onEvent({ type: "token", text: "回答" });
    handlers.onEvent({
      type: "references",
      references: [{ title: "Schema", path: "wiki/schema.md" }],
    });
    handlers.onEvent({
      type: "done",
      message: {
        id: "m2",
        role: "assistant",
        content: "回答",
        timestamp: 2,
        conversationId: "conv_1",
        references: [{ title: "Schema", path: "wiki/schema.md" }],
      },
    });
  }),
}));
```

测试断言：

```ts
it("加载桌面端会话和消息历史", async () => {
  render(<ProjectQuestionPanel projectId="project_1" onOpenFile={vi.fn()} />);

  expect(await screen.findByText("会话")).toBeInTheDocument();
  expect(await screen.findByText("schema 在哪里？")).toBeInTheDocument();
});

it("发送消息时展示流式回答和引用", async () => {
  const onOpenFile = vi.fn();
  render(<ProjectQuestionPanel projectId="project_1" onOpenFile={onOpenFile} />);

  await userEvent.type(await screen.findByLabelText("项目问答输入"), "schema 在哪里？");
  await userEvent.click(screen.getByRole("button", { name: "发送" }));

  expect(await screen.findByText("回答")).toBeInTheDocument();
  await userEvent.click(await screen.findByRole("button", { name: /Schema/ }));
  expect(onOpenFile).toHaveBeenCalledWith("wiki/schema.md");
});
```

- [ ] **Step 3: 重写 `ProjectQuestionPanel`**

在 `web/src/components/workbench/project-question-panel.tsx` 中改为聊天 UI。保留 props：

```ts
interface ProjectQuestionPanelProps {
  projectId: string;
  onOpenFile: (relativePath: string) => void;
}
```

核心状态：

```ts
const [conversations, setConversations] = useState<DesktopBridgeConversation[]>([]);
const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
const [messages, setMessages] = useState<DesktopBridgeMessage[]>([]);
const [input, setInput] = useState("");
const [streamingText, setStreamingText] = useState("");
const [streamingReferences, setStreamingReferences] = useState<DesktopBridgeReference[]>([]);
const [status, setStatus] = useState<"loading" | "ready" | "streaming" | "error">("loading");
const [errorMessage, setErrorMessage] = useState<string | null>(null);
const abortRef = useRef<AbortController | null>(null);
```

加载逻辑：

```ts
useEffect(() => {
  let cancelled = false;
  setStatus("loading");
  listQuestionConversations(projectId)
    .then(async (items) => {
      if (cancelled) return;
      setConversations(items);
      const first = items[0] ?? await createQuestionConversation(projectId);
      if (cancelled) return;
      setActiveConversationId(first.id);
      const loadedMessages = await listQuestionMessages(projectId, first.id);
      if (cancelled) return;
      setMessages(loadedMessages);
      setStatus("ready");
    })
    .catch((error: unknown) => {
      if (cancelled) return;
      setErrorMessage(error instanceof Error ? error.message : "桌面端问答服务不可用。");
      setStatus("error");
    });
  return () => {
    cancelled = true;
    abortRef.current?.abort();
  };
}, [projectId]);
```

发送逻辑：

```ts
async function handleSend() {
  const text = input.trim();
  if (!text || !activeConversationId || status === "streaming") return;

  const controller = new AbortController();
  abortRef.current = controller;
  setInput("");
  setStreamingText("");
  setStreamingReferences([]);
  setStatus("streaming");
  setMessages((current) => [
    ...current,
    {
      id: `local_user_${Date.now()}`,
      role: "user",
      content: text,
      timestamp: Date.now(),
      conversationId: activeConversationId,
    },
  ]);

  try {
    await streamQuestionMessage(projectId, activeConversationId, text, {
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === "token") {
          setStreamingText((current) => current + event.text);
        } else if (event.type === "references") {
          setStreamingReferences(event.references);
        } else if (event.type === "done") {
          setMessages((current) => [...current, event.message]);
          setStreamingText("");
          setStreamingReferences([]);
          setStatus("ready");
        } else if (event.type === "error") {
          setErrorMessage(event.message);
          setStatus("error");
        }
      },
    });
  } catch (error) {
    if (!controller.signal.aborted) {
      setErrorMessage(error instanceof Error ? error.message : "桌面端问答请求失败。");
      setStatus("error");
    }
  } finally {
    if (abortRef.current === controller) abortRef.current = null;
  }
}
```

UI 文案必须是中文：

- 标题：`项目问答`
- 新会话按钮：`新会话`
- 输入 aria-label：`项目问答输入`
- 发送按钮：`发送`
- 停止按钮：`停止`
- 错误：`桌面端问答服务不可用`

- [ ] **Step 4: 确认 ProjectWorkbench 打开引用**

检查 `web/src/components/workbench/project-workbench.tsx` 中 `ProjectQuestionPanel` 调用保持：

```tsx
<ProjectQuestionPanel
  projectId={projectId}
  onOpenFile={(relativePath) => {
    void requestOpenRelativePath(relativePath, "Files");
  }}
/>
```

- [ ] **Step 5: 验证**

Run:

```bash
cd web
npm run test -- src/components/workbench/project-question-panel.test.tsx
npm run typecheck
cd ..
```

Expected: 测试通过，`typecheck` 通过。

- [ ] **Step 6: 提交**

Run:

```bash
git add web/src/lib/client/desktop-question-api.ts web/src/lib/client/api.ts web/src/components/workbench/project-question-panel.tsx web/src/components/workbench/project-question-panel.test.tsx web/src/components/workbench/project-workbench.tsx
git commit -m "feat: render web qa from desktop bridge"
```

---

### Task 8: 文档、清理与端到端验证

**Files:**
- Modify: `web/README.md`
- Modify: `web/docs/web-roadmap-next-phases.md`

- [ ] **Step 1: 更新 README**

在 `web/README.md` 的问答或环境变量部分加入：

```md
### 桌面端问答 Bridge

Web 项目问答默认通过桌面端本地服务完成。使用前需要先启动桌面端应用，并打开同一个项目。

默认 bridge 地址：

```bash
http://127.0.0.1:19828
```

Web 服务端会通过该 bridge 获取会话、消息历史和流式回答。可以用环境变量覆盖 bridge 地址：

```bash
LLM_WIKI_DESKTOP_BRIDGE_URL=http://127.0.0.1:19828
```

Web 端不再使用自己的 `LLM_WIKI_OPENAI_*` 配置生成项目问答回答；模型配置以桌面端设置为准。
```

- [ ] **Step 2: 更新 roadmap**

在 `web/docs/web-roadmap-next-phases.md` 问答相关阶段说明中追加：

```md
> 架构调整：Web 项目问答将迁移为桌面端 Bridge 模式。Web 端只做代理和展示，问答逻辑、模型配置、流式输出和历史记录由桌面端共享问答 service 负责。
```

- [ ] **Step 3: 全量验证**

Run:

```bash
npm run test:mocks -- src/lib/__tests__/project-chat-service.test.ts
npm run typecheck
cd src-tauri
cargo test web_bridge --lib
cargo check
cd ..
cd web
npm run test
npm run typecheck
npm run lint
cd ..
```

Expected:

- Desktop mock tests pass.
- Desktop TypeScript typecheck pass.
- Rust `web_bridge` tests pass.
- Rust `cargo check` pass.
- Web tests pass.
- Web typecheck pass.
- Web lint exits 0.

- [ ] **Step 4: 手工联调**

Run desktop:

```bash
npm run tauri dev
```

Verify bridge:

```bash
curl http://127.0.0.1:19828/health
```

Run web:

```bash
cd web
npm run dev
```

手工验证：

1. 打开 Web 项目页。
2. 进入 `项目问答`。
3. 创建或选择会话。
4. 输入一个能命中 wiki 的问题。
5. 确认 Web 端流式输出。
6. 确认 assistant 消息显示来源引用。
7. 点击来源引用，确认 Web 文件面板打开对应文件。
8. 回到桌面端聊天面板，确认同一会话历史可见。
9. 关闭桌面端应用后刷新 Web 问答，确认显示“桌面端问答服务未连接”。

- [ ] **Step 5: 提交**

Run:

```bash
git add web/README.md web/docs/web-roadmap-next-phases.md
git commit -m "docs: document desktop bridge qa flow"
```

---

## 执行顺序

1. Task 1 必须先完成，建立桌面共享问答 service。
2. Task 2 让桌面 ChatPanel 改用共享 service，确保桌面 UI 行为不分叉。
3. Task 3 增加 Rust 本地 bridge 和 SSE 基础设施。
4. Task 4 接通桌面前端 handler，让 bridge 真正调用共享 service。
5. Task 5 增加 Web 服务端 bridge client 和类型。
6. Task 6 增加 Web API 代理 routes。
7. Task 7 改造 Web 问答 UI。
8. Task 8 做文档、清理和端到端验证。

## Subagent 切分建议

- Worker A：Task 1 和 Task 2，负责 desktop TypeScript 问答 service 与 ChatPanel 接入。
- Worker B：Task 3 和 Task 4，负责 Rust bridge 与 Tauri event handler。
- Worker C：Task 5 和 Task 6，负责 Web 服务端 bridge client 与 API routes。
- Worker D：Task 7，负责 Web 问答 UI。
- 主线程：Task 8，负责整合、冲突处理、全量验证和文档。

执行时这些 worker 不应互相覆盖文件。每个 worker 完成后列出修改文件和验证结果，由主线程统一 review 和集成。

## 完成定义

- Web 问答默认使用桌面端 bridge，不再调用 Web 独立 LLM provider。
- 桌面端 ChatPanel 和 Web bridge 共用 `project-chat-service`。
- Web 端支持会话列表、消息历史、流式输出、停止生成和来源引用。
- Web 端发送的问题写入桌面端聊天历史。
- 来源引用可以打开 Web 文件面板中的对应文件。
- 现有 `127.0.0.1:19827` 剪藏服务行为不变。
- 新增 `127.0.0.1:19828` bridge 只绑定本机。
- desktop TS tests、desktop typecheck、Rust tests、Rust check、Web tests、Web typecheck、Web lint 均已运行并记录结果。
