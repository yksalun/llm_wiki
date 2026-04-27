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
  type DisplayMessage,
  type MessageReference,
} from "@/stores/chat-store"
import { useWikiStore, type LlmConfig } from "@/stores/wiki-store"
import type { WikiProject } from "@/types/wiki"

export interface ProjectChatRequest {
  question: string
  project?: WikiProject | null
  llmConfig?: LlmConfig
  dataVersion?: number
  historyMessages?: DisplayMessage[]
  maxHistoryMessages?: number
  signal?: AbortSignal
}

export interface ProjectChatCallbacks {
  onToken?: (token: string) => void
  onDone?: (content: string, references: MessageReference[]) => void
  onError?: (error: Error) => void
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
  getWikiState: () => {
    project: WikiProject | null
    llmConfig: LlmConfig
    dataVersion: number
  }
  getChatState: () => {
    activeConversationId: string | null
    maxHistoryMessages: number
    getActiveMessages: () => DisplayMessage[]
    createConversation: () => string
    addMessage: (role: DisplayMessage["role"], content: string) => void
    setStreaming: (streaming: boolean) => void
    appendStreamToken: (token: string) => void
    finalizeStream: (content: string, references?: MessageReference[]) => void
  }
  createAbortController: () => AbortController
}

type PageEntry = {
  title: string
  path: string
  content: string
  priority: number
}

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
    getWikiState: () => {
      const state = useWikiStore.getState()
      return {
        project: state.project,
        llmConfig: state.llmConfig,
        dataVersion: state.dataVersion,
      }
    },
    getChatState: () => useChatStore.getState(),
    createAbortController: () => new AbortController(),
  }
}

export async function buildProjectChatContext(
  request: ProjectChatRequest,
  dependencies: ProjectChatDependencies = createDefaultProjectChatDependencies(),
): Promise<ProjectChatContext> {
  const wikiState = dependencies.getWikiState()
  const chatState = dependencies.getChatState()
  const project = request.project ?? wikiState.project
  const llmConfig = request.llmConfig ?? wikiState.llmConfig
  const dataVersion = request.dataVersion ?? wikiState.dataVersion
  const maxHistoryMessages =
    request.maxHistoryMessages ?? chatState.maxHistoryMessages

  const systemMessages: ChatMessage[] = []
  let references: MessageReference[] = []
  let languageReminder: string | undefined

  if (project && dependencies.isGreeting(request.question)) {
    const outLang = dependencies.getOutputLanguage(request.question)
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
  } else if (project) {
    const context = await buildRetrievalContext({
      question: request.question,
      project,
      llmConfig,
      dataVersion,
      dependencies,
    })
    systemMessages.push(context.systemMessage)
    references = context.references
    languageReminder = dependencies.buildLanguageReminder(request.question)
  }

  const historyMessages = buildHistoryMessages({
    request,
    dependencies,
    maxHistoryMessages,
  })

  const currentUserMessage: ChatMessage = {
    role: "user",
    content: languageReminder
      ? `[${languageReminder}]\n\n${request.question}`
      : request.question,
  }

  return {
    messages: [...systemMessages, ...historyMessages, currentUserMessage],
    references,
  }
}

export async function sendProjectChatMessage(
  request: ProjectChatRequest,
  callbacks: ProjectChatCallbacks = {},
  dependencies: ProjectChatDependencies = createDefaultProjectChatDependencies(),
): Promise<ProjectChatContext> {
  const context = await buildProjectChatContext(request, dependencies)
  const wikiState = dependencies.getWikiState()
  const llmConfig = request.llmConfig ?? wikiState.llmConfig
  const chatState = dependencies.getChatState()

  if (!chatState.activeConversationId) {
    chatState.createConversation()
  }

  chatState.addMessage("user", request.question)
  chatState.setStreaming(true)

  const controller = dependencies.createAbortController()
  const signal = request.signal ?? controller.signal
  let accumulated = ""

  const handleError = (error: Error) => {
    chatState.finalizeStream(`Error: ${error.message}`, undefined)
    callbacks.onError?.(error)
  }

  try {
    await dependencies.streamChat(
      llmConfig,
      context.messages,
      {
        onToken: (token) => {
          accumulated += token
          chatState.appendStreamToken(token)
          callbacks.onToken?.(token)
        },
        onDone: () => {
          chatState.finalizeStream(accumulated, context.references)
          callbacks.onDone?.(accumulated, context.references)
        },
        onError: handleError,
      },
      signal,
    )
  } catch (err) {
    handleError(err instanceof Error ? err : new Error(String(err)))
  }

  return context
}

function buildHistoryMessages({
  request,
  dependencies,
  maxHistoryMessages,
}: {
  request: ProjectChatRequest
  dependencies: ProjectChatDependencies
  maxHistoryMessages: number
}): ChatMessage[] {
  const sourceMessages =
    request.historyMessages ?? dependencies.getChatState().getActiveMessages()

  const conversational = sourceMessages.filter(
    (m) => m.role === "user" || m.role === "assistant",
  )

  if (
    conversational.length > 0 &&
    conversational[conversational.length - 1].role === "user" &&
    conversational[conversational.length - 1].content === request.question
  ) {
    conversational.pop()
  }

  return chatMessagesToLLM(conversational.slice(-maxHistoryMessages))
}

async function buildRetrievalContext({
  question,
  project,
  llmConfig,
  dataVersion,
  dependencies,
}: {
  question: string
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

  const searchResults = await dependencies.searchWiki(projectPath, question)
  const topSearchResults = searchResults.slice(0, 10)
  const index = trimIndexToBudget(rawIndex, question, indexBudget, dependencies)
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
      priority: 3,
      pageBudget,
      maxPageSize,
      dependencies,
      getUsedChars: () => relevantPages.reduce((sum, page) => sum + page.content.length, 0),
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
  const outLang = dependencies.getOutputLanguage(question)

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
  question: string,
  indexBudget: number,
  dependencies: ProjectChatDependencies,
): string {
  if (rawIndex.length <= indexBudget) {
    return rawIndex
  }

  const tokens = dependencies.tokenizeQuery(question)
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

  const addPage = async (title: string, filePath: string, priority: number) => {
    const added = await tryAddPage({
      pages,
      projectPath,
      title,
      filePath,
      priority,
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
    await addPage(result.title, result.path, 0)
  }

  for (const result of topSearchResults.filter((result) => !result.titleMatch)) {
    await addPage(result.title, result.path, 1)
  }

  for (const expansion of graphExpansions) {
    await addPage(expansion.title, expansion.path, 2)
  }

  return pages
}

async function tryAddPage({
  pages,
  projectPath,
  title,
  filePath,
  priority,
  pageBudget,
  maxPageSize,
  dependencies,
  getUsedChars,
}: {
  pages: PageEntry[]
  projectPath: string
  title: string
  filePath: string
  priority: number
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

    pages.push({ title, path: relativePath, content: truncated, priority })
    return true
  } catch {
    return false
  }
}
