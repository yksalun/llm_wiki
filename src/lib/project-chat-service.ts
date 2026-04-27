import { readFile } from "@/commands/fs"
import { streamChat, type ChatMessage } from "@/lib/llm-client"
import { searchWiki, tokenizeQuery, type SearchResult } from "@/lib/search"
import {
  buildRetrievalGraph,
  getRelatedNodes,
  type RetrievalGraph,
  type RetrievalNode,
} from "@/lib/graph-relevance"
import { buildLanguageReminder, getOutputLanguage } from "@/lib/output-language"
import { isGreeting } from "@/lib/greeting-detector"
import { getFileName, getRelativePath, normalizePath } from "@/lib/path-utils"
import {
  chatMessagesToLLM,
  useChatStore,
  type Conversation,
  type DisplayMessage,
  type MessageReference,
} from "@/stores/chat-store"
import { useWikiStore, type LlmConfig } from "@/stores/wiki-store"
import type { WikiProject } from "@/types/wiki"

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
  messages: ChatMessage[]
  references: MessageReference[]
}

export interface ProjectChatDependencies {
  readFile: (path: string) => Promise<string>
  searchWiki: (projectPath: string, query: string) => Promise<SearchResult[]>
  buildRetrievalGraph: (
    projectPath: string,
    dataVersion?: number,
  ) => Promise<RetrievalGraph>
  getRelatedNodes: (
    nodeId: string,
    graph: RetrievalGraph,
    limit?: number,
  ) => ReadonlyArray<{ node: RetrievalNode; relevance: number }>
  streamChat: typeof streamChat
  isGreeting: (text: string) => boolean
  getOutputLanguage: (fallbackText?: string) => string
  buildLanguageReminder: (fallbackText?: string) => string
  tokenizeQuery: (query: string) => string[]
  getState: () => {
    project: WikiProject | null
    llmConfig: LlmConfig
    dataVersion: number
    messages: DisplayMessage[]
    conversations: Conversation[]
    maxHistoryMessages: number
  }
  addMessage: (message: DisplayMessage) => void
  upsertConversation: (conversation: Conversation) => void
  now: () => number
  createAbortController: () => AbortController
}

type PageEntry = {
  title: string
  path: string
  content: string
}

let messageCounter = 0

export function createDefaultProjectChatDependencies(): ProjectChatDependencies {
  return {
    readFile,
    searchWiki,
    buildRetrievalGraph,
    getRelatedNodes,
    streamChat,
    isGreeting,
    getOutputLanguage,
    buildLanguageReminder,
    tokenizeQuery,
    getState: () => {
      const wikiState = useWikiStore.getState()
      const chatState = useChatStore.getState()
      return {
        project: wikiState.project,
        llmConfig: wikiState.llmConfig,
        dataVersion: wikiState.dataVersion,
        messages: chatState.messages,
        conversations: chatState.conversations,
        maxHistoryMessages: chatState.maxHistoryMessages,
      }
    },
    addMessage: (message) => {
      useChatStore.setState((state) => ({
        messages: [...state.messages, message],
        conversations: state.conversations.map((conversation) =>
          conversation.id === message.conversationId
            ? { ...conversation, updatedAt: message.timestamp }
            : conversation,
        ),
      }))
    },
    upsertConversation: (conversation) => {
      useChatStore.setState((state) => {
        const exists = state.conversations.some((item) => item.id === conversation.id)
        return {
          activeConversationId:
            state.activeConversationId ?? conversation.id,
          conversations: exists
            ? state.conversations.map((item) =>
                item.id === conversation.id ? conversation : item,
              )
            : [conversation, ...state.conversations],
        }
      })
    },
    now: () => Date.now(),
    createAbortController: () => new AbortController(),
  }
}

export async function buildProjectChatContext(
  request: ProjectChatRequest,
  dependencies: ProjectChatDependencies = createDefaultProjectChatDependencies(),
): Promise<ProjectChatContext> {
  const state = dependencies.getState()
  const projectPath = normalizePath(request.projectPath)
  const projectName =
    state.project?.id === request.projectId ? state.project.name : getFileName(projectPath)
  const project: WikiProject = {
    id: request.projectId,
    name: projectName || "Project",
    path: projectPath,
  }

  const systemMessages: ChatMessage[] = []
  let references: MessageReference[] = []
  let languageReminder: string | undefined

  if (dependencies.isGreeting(request.message)) {
    const outLang = dependencies.getOutputLanguage(request.message)
    systemMessages.push({
      role: "system",
      content: [
        `You are a wiki assistant for the project "${project.name}".`,
        "The user sent a casual greeting - reply briefly and naturally, in one or two sentences.",
        "Do NOT invent wiki content or pretend to have retrieved pages. Invite the user to ask a concrete question if they want information from the wiki.",
        "",
        `Respond in ${outLang}.`,
      ].join("\n"),
    })
  } else {
    const context = await buildRetrievalContext({
      message: request.message,
      project,
      llmConfig: state.llmConfig,
      dataVersion: state.dataVersion,
      dependencies,
    })
    systemMessages.push(context.systemMessage)
    references = context.references
    languageReminder = dependencies.buildLanguageReminder(request.message)
  }

  const historyMessages = buildHistoryMessages({
    request,
    messages: state.messages,
    maxHistoryMessages: state.maxHistoryMessages,
  })

  const currentUserMessage: ChatMessage = {
    role: "user",
    content: languageReminder
      ? `[${languageReminder}]\n\n${request.message}`
      : request.message,
  }

  return {
    messages: [...systemMessages, ...historyMessages, currentUserMessage],
    references,
  }
}

export async function sendProjectChatMessage(
  request: ProjectChatRequest,
  callbacks: ProjectChatCallbacks,
  dependencies: ProjectChatDependencies = createDefaultProjectChatDependencies(),
): Promise<ProjectChatContext | null> {
  const message = request.message.trim()
  if (!message) {
    callbacks.onError(new Error("消息不能为空。"))
    return null
  }

  const initialState = dependencies.getState()
  const now = dependencies.now()
  const existingConversation = initialState.conversations.find(
    (conversation) => conversation.id === request.conversationId,
  )
  dependencies.upsertConversation(
    existingConversation
      ? { ...existingConversation, updatedAt: now }
      : {
          id: request.conversationId,
          title: message.slice(0, 50),
          createdAt: now,
          updatedAt: now,
        },
  )

  let context: ProjectChatContext
  try {
    context = await buildProjectChatContext(
      { ...request, message },
      dependencies,
    )
  } catch (err) {
    callbacks.onError(toError(err))
    return null
  }

  const userMessage = createDisplayMessage({
    role: "user",
    content: message,
    conversationId: request.conversationId,
    now: dependencies.now,
  })
  dependencies.addMessage(userMessage)

  const controller = dependencies.createAbortController()
  const signal = request.signal ?? controller.signal
  let accumulated = ""
  let terminalCallbackCalled = false

  const callError = (error: Error) => {
    if (terminalCallbackCalled) return
    terminalCallbackCalled = true
    callbacks.onError(error)
  }

  try {
    await dependencies.streamChat(
      initialState.llmConfig,
      context.messages,
      {
        onToken: (token) => {
          accumulated += token
          callbacks.onToken(token)
        },
        onDone: () => {
          if (terminalCallbackCalled) return
          terminalCallbackCalled = true
          const assistantMessage = createDisplayMessage({
            role: "assistant",
            content: accumulated,
            conversationId: request.conversationId,
            references: context.references,
            now: dependencies.now,
          })
          dependencies.addMessage(assistantMessage)
          callbacks.onReferences?.(context.references)
          callbacks.onDone(assistantMessage)
        },
        onError: callError,
      },
      signal,
    )
  } catch (err) {
    callError(toError(err))
  }

  return context
}

function buildHistoryMessages({
  request,
  messages,
  maxHistoryMessages,
}: {
  request: ProjectChatRequest
  messages: DisplayMessage[]
  maxHistoryMessages: number
}): ChatMessage[] {
  const conversational = messages.filter(
    (message) =>
      message.conversationId === request.conversationId &&
      (message.role === "user" || message.role === "assistant"),
  )

  if (
    conversational.length > 0 &&
    conversational[conversational.length - 1].role === "user" &&
    conversational[conversational.length - 1].content === request.message
  ) {
    conversational.pop()
  }

  return chatMessagesToLLM(conversational.slice(-maxHistoryMessages))
}

async function buildRetrievalContext({
  message,
  project,
  llmConfig,
  dataVersion,
  dependencies,
}: {
  message: string
  project: WikiProject
  llmConfig: LlmConfig
  dataVersion: number
  dependencies: ProjectChatDependencies
}): Promise<{ systemMessage: ChatMessage; references: MessageReference[] }> {
  const projectPath = normalizePath(project.path)
  const maxContextSize = llmConfig.maxContextSize || 204_800
  const indexBudget = Math.floor(maxContextSize * 0.05)
  const pageBudget = Math.floor(maxContextSize * 0.6)
  const maxPageSize = Math.min(Math.floor(pageBudget * 0.3), 30_000)

  const [rawIndex, purpose] = await Promise.all([
    dependencies.readFile(`${projectPath}/wiki/index.md`).catch(() => ""),
    dependencies.readFile(`${projectPath}/purpose.md`).catch(() => ""),
  ])

  const searchResults = await dependencies.searchWiki(projectPath, message)
  const topSearchResults = searchResults.slice(0, 10)
  const index = trimIndexToBudget(rawIndex, message, indexBudget, dependencies)
  const graphExpansions = await buildGraphExpansions({
    projectPath,
    dataVersion,
    topSearchResults,
    dependencies,
  })

  const relevantPages = await collectRelevantPages({
    projectPath,
    topSearchResults,
    graphExpansions,
    pageBudget,
    maxPageSize,
    dependencies,
  })

  if (relevantPages.length === 0) {
    await tryAddPage({
      pages: relevantPages,
      projectPath,
      title: "Overview",
      filePath: `${projectPath}/wiki/overview.md`,
      pageBudget,
      maxPageSize,
      dependencies,
      getUsedChars: () =>
        relevantPages.reduce((sum, page) => sum + page.content.length, 0),
    })
  }

  const pagesContext =
    relevantPages.length > 0
      ? relevantPages
          .map(
            (page, index) =>
              `### [${index + 1}] ${page.title}\nPath: ${page.path}\n\n${page.content}`,
          )
          .join("\n\n---\n\n")
      : "(No wiki pages found)"

  const pageList = relevantPages
    .map((page, index) => `[${index + 1}] ${page.title} (${page.path})`)
    .join("\n")
  const outLang = dependencies.getOutputLanguage(message)

  return {
    systemMessage: {
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
        "The wiki content above may be in a different language, but this is IRRELEVANT to your output language.",
        `Ignore the language of the wiki content. Write in ${outLang} only.`,
        `Even proper nouns should use standard ${outLang} transliteration when appropriate.`,
        "DO NOT use any other language. This overrides all other instructions.",
      ]
        .filter(Boolean)
        .join("\n"),
    },
    references: relevantPages.map((page) => ({
      title: page.title,
      path: page.path,
    })),
  }
}

function trimIndexToBudget(
  rawIndex: string,
  message: string,
  indexBudget: number,
  dependencies: ProjectChatDependencies,
): string {
  if (rawIndex.length <= indexBudget) {
    return rawIndex
  }

  const tokens = dependencies.tokenizeQuery(message)
  const lines = rawIndex.split("\n")
  const keptLines: string[] = []
  let keptSize = 0

  for (const line of lines) {
    const isHeader = line.startsWith("##")
    const lower = line.toLowerCase()
    const isRelevant = tokens.some((token) => lower.includes(token))

    if ((isHeader || isRelevant) && keptSize + line.length + 1 <= indexBudget) {
      keptLines.push(line)
      keptSize += line.length + 1
    }
  }

  let trimmed = keptLines.join("\n")
  if (trimmed.length < rawIndex.length) {
    trimmed += "\n\n[...index trimmed to relevant entries...]"
  }
  return trimmed
}

async function buildGraphExpansions({
  projectPath,
  dataVersion,
  topSearchResults,
  dependencies,
}: {
  projectPath: string
  dataVersion: number
  topSearchResults: SearchResult[]
  dependencies: ProjectChatDependencies
}): Promise<Array<{ title: string; path: string; relevance: number }>> {
  const graph = await dependencies.buildRetrievalGraph(projectPath, dataVersion)
  const expandedIds = new Set<string>()
  const searchHitPaths = new Set(topSearchResults.map((result) => result.path))
  const graphExpansions: Array<{ title: string; path: string; relevance: number }> =
    []

  for (const result of topSearchResults) {
    const fileName = getFileName(result.path)
    const nodeId = fileName.replace(/\.md$/, "")
    const related = dependencies.getRelatedNodes(nodeId, graph, 3)

    for (const { node, relevance } of related) {
      if (relevance < 2.0) continue
      if (searchHitPaths.has(node.path)) continue
      if (expandedIds.has(node.id)) continue
      expandedIds.add(node.id)
      graphExpansions.push({ title: node.title, path: node.path, relevance })
    }
  }

  graphExpansions.sort((a, b) => b.relevance - a.relevance)
  return graphExpansions
}

async function collectRelevantPages({
  projectPath,
  topSearchResults,
  graphExpansions,
  pageBudget,
  maxPageSize,
  dependencies,
}: {
  projectPath: string
  topSearchResults: SearchResult[]
  graphExpansions: Array<{ title: string; path: string }>
  pageBudget: number
  maxPageSize: number
  dependencies: ProjectChatDependencies
}): Promise<PageEntry[]> {
  const pages: PageEntry[] = []
  let usedChars = 0
  const getUsedChars = () => usedChars

  const addPage = async (title: string, filePath: string) => {
    const added = await tryAddPage({
      pages,
      projectPath,
      title,
      filePath,
      pageBudget,
      maxPageSize,
      dependencies,
      getUsedChars,
    })
    if (added) {
      usedChars += pages[pages.length - 1].content.length
    }
  }

  for (const result of topSearchResults.filter((result) => result.titleMatch)) {
    await addPage(result.title, result.path)
  }

  for (const result of topSearchResults.filter((result) => !result.titleMatch)) {
    await addPage(result.title, result.path)
  }

  for (const expansion of graphExpansions) {
    await addPage(expansion.title, expansion.path)
  }

  return pages
}

async function tryAddPage({
  pages,
  projectPath,
  title,
  filePath,
  pageBudget,
  maxPageSize,
  dependencies,
  getUsedChars,
}: {
  pages: PageEntry[]
  projectPath: string
  title: string
  filePath: string
  pageBudget: number
  maxPageSize: number
  dependencies: ProjectChatDependencies
  getUsedChars: () => number
}): Promise<boolean> {
  if (getUsedChars() >= pageBudget) {
    return false
  }

  try {
    const raw = await dependencies.readFile(filePath)
    const relativePath = getRelativePath(filePath, projectPath)
    const truncated =
      raw.length > maxPageSize ? `${raw.slice(0, maxPageSize)}\n\n[...truncated...]` : raw

    if (getUsedChars() + truncated.length > pageBudget) {
      return false
    }

    pages.push({ title, path: relativePath, content: truncated })
    return true
  } catch {
    return false
  }
}

function createDisplayMessage({
  role,
  content,
  conversationId,
  references,
  now,
}: {
  role: DisplayMessage["role"]
  content: string
  conversationId: string
  references?: MessageReference[]
  now: () => number
}): DisplayMessage {
  messageCounter += 1
  const timestamp = now()
  return {
    id: `msg_${timestamp}_${messageCounter}`,
    role,
    content,
    timestamp,
    conversationId,
    references,
  }
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err))
}
