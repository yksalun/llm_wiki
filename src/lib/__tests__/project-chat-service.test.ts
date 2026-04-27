import { describe, expect, it, vi } from "vitest"
import type { ChatMessage } from "@/lib/llm-client"
import type { LlmConfig } from "@/stores/wiki-store"
import type { DisplayMessage } from "@/stores/chat-store"
import {
  buildProjectChatContext,
  sendProjectChatMessage,
  type ProjectChatDependencies,
} from "../project-chat-service"

const project = {
  id: "project-1",
  name: "Demo Wiki",
  path: "C:/demo/project",
}

const llmConfig: LlmConfig = {
  provider: "openai",
  apiKey: "test-key",
  model: "test-model",
  ollamaUrl: "",
  customEndpoint: "",
  maxContextSize: 20_000,
}

function message(role: DisplayMessage["role"], content: string): DisplayMessage {
  return {
    id: `${role}-${content}`,
    role,
    content,
    timestamp: 1,
    conversationId: "conv-1",
  }
}

function createDependencies(
  overrides: Partial<ProjectChatDependencies> = {},
): ProjectChatDependencies {
  return {
    readFile: vi.fn(async () => ""),
    searchWiki: vi.fn(async () => []),
    buildRetrievalGraph: vi.fn(async () => ({ nodes: new Map(), dataVersion: 7 })),
    getRelatedNodes: vi.fn(() => []),
    streamChat: vi.fn(async () => undefined),
    isGreeting: vi.fn(() => false),
    getOutputLanguage: vi.fn(() => "English"),
    buildLanguageReminder: vi.fn(() => "REMINDER: All output must be in English."),
    tokenizeQuery: vi.fn((query: string) => query.toLowerCase().split(/\s+/)),
    getWikiState: vi.fn(() => ({
      project,
      llmConfig,
      dataVersion: 7,
    })),
    getChatState: vi.fn(() => ({
      activeConversationId: "conv-1",
      maxHistoryMessages: 10,
      getActiveMessages: () => [],
      createConversation: vi.fn(() => "conv-1"),
      addMessage: vi.fn(),
      setStreaming: vi.fn(),
      appendStreamToken: vi.fn(),
      finalizeStream: vi.fn(),
    })),
    createAbortController: () => new AbortController(),
    ...overrides,
  }
}

describe("buildProjectChatContext", () => {
  it("skips retrieval for greetings and builds a lightweight system prompt", async () => {
    const deps = createDependencies({
      isGreeting: vi.fn(() => true),
      getChatState: vi.fn(() => ({
        activeConversationId: "conv-1",
        maxHistoryMessages: 10,
        getActiveMessages: () => [message("user", "previous question")],
        createConversation: vi.fn(() => "conv-1"),
        addMessage: vi.fn(),
        setStreaming: vi.fn(),
        appendStreamToken: vi.fn(),
        finalizeStream: vi.fn(),
      })),
    })

    const context = await buildProjectChatContext({ question: "hello" }, deps)

    expect(deps.searchWiki).not.toHaveBeenCalled()
    expect(deps.readFile).not.toHaveBeenCalled()
    expect(deps.buildRetrievalGraph).not.toHaveBeenCalled()
    expect(context.references).toEqual([])
    expect(context.messages).toHaveLength(3)
    expect(context.messages[0]).toMatchObject({ role: "system" })
    expect(context.messages[0].content).toContain('project "Demo Wiki"')
    expect(context.messages[0].content).toContain("casual greeting")
    expect(context.messages[1]).toEqual({ role: "user", content: "previous question" })
    expect(context.messages[2]).toEqual({ role: "user", content: "hello" })
  })

  it("retrieves wiki context for ordinary questions and returns page references", async () => {
    const readFile = vi.fn(async (path: string) => {
      const files: Record<string, string> = {
        "C:/demo/project/wiki/index.md": "# Index\n- [[Attention]]",
        "C:/demo/project/purpose.md": "Explain transformer internals.",
        "C:/demo/project/wiki/concepts/attention.md": "# Attention\nAttention mixes token context.",
      }
      return files[path] ?? ""
    })
    const searchWiki = vi.fn(async () => [
      {
        path: "C:/demo/project/wiki/concepts/attention.md",
        title: "Attention",
        snippet: "Attention mixes token context.",
        titleMatch: true,
        score: 10,
      },
    ])
    const deps = createDependencies({ readFile, searchWiki })

    const context = await buildProjectChatContext(
      { question: "How does attention work?" },
      deps,
    )

    expect(searchWiki).toHaveBeenCalledWith("C:/demo/project", "How does attention work?")
    expect(readFile).toHaveBeenCalledWith("C:/demo/project/wiki/index.md")
    expect(readFile).toHaveBeenCalledWith("C:/demo/project/purpose.md")
    expect(readFile).toHaveBeenCalledWith("C:/demo/project/wiki/concepts/attention.md")
    expect(context.references).toEqual([
      { title: "Attention", path: "wiki/concepts/attention.md" },
    ])
    expect(context.messages[context.messages.length - 1]).toEqual({
      role: "user",
      content: "[REMINDER: All output must be in English.]\n\nHow does attention work?",
    })
    const systemPrompt = context.messages[0].content
    expect(systemPrompt).toContain("## Wiki Purpose\nExplain transformer internals.")
    expect(systemPrompt).toContain("## Wiki Index\n# Index\n- [[Attention]]")
    expect(systemPrompt).toContain("## Wiki Pages")
    expect(systemPrompt).toContain("### [1] Attention")
    expect(systemPrompt).toContain("# Attention\nAttention mixes token context.")
    expect(systemPrompt).toContain("Use [[wikilink]] syntax")
    expect(systemPrompt).toContain("use the page number in brackets")
  })
})

describe("sendProjectChatMessage", () => {
  it("adds the user message, streams tokens, and saves the assistant response with references", async () => {
    const events: string[] = []
    const chatState = {
      activeConversationId: "conv-1",
      maxHistoryMessages: 10,
      getActiveMessages: vi.fn(() => [message("assistant", "Earlier answer")]),
      createConversation: vi.fn(() => "conv-1"),
      addMessage: vi.fn((role: DisplayMessage["role"], content: string) => {
        events.push(`add:${role}:${content}`)
      }),
      setStreaming: vi.fn((streaming: boolean) => {
        events.push(`streaming:${streaming}`)
      }),
      appendStreamToken: vi.fn((token: string) => {
        events.push(`token:${token}`)
      }),
      finalizeStream: vi.fn((content: string) => {
        events.push(`finalize:${content}`)
      }),
    }
    const streamChat = vi.fn(
      async (
        _config: LlmConfig,
        messages: ChatMessage[],
        callbacks: {
          onToken: (token: string) => void
          onDone: () => void
          onError: (error: Error) => void
        },
      ) => {
        events.push(`llm:${messages[messages.length - 1]?.content}`)
        callbacks.onToken("Hello")
        callbacks.onToken(" world")
        callbacks.onDone()
      },
    )
    const deps = createDependencies({
      streamChat,
      getChatState: vi.fn(() => chatState),
      searchWiki: vi.fn(async () => [
        {
          path: "C:/demo/project/wiki/concepts/attention.md",
          title: "Attention",
          snippet: "Attention mixes token context.",
          titleMatch: true,
          score: 10,
        },
      ]),
      readFile: vi.fn(async (path: string) =>
        path.endsWith("attention.md") ? "# Attention\nAttention mixes token context." : "",
      ),
    })
    const onToken = vi.fn()

    await sendProjectChatMessage(
      { question: "What is attention?" },
      { onToken },
      deps,
    )

    expect(events).toEqual([
      "add:user:What is attention?",
      "streaming:true",
      "llm:[REMINDER: All output must be in English.]\n\nWhat is attention?",
      "token:Hello",
      "token: world",
      "finalize:Hello world",
    ])
    expect(onToken).toHaveBeenCalledTimes(2)
    expect(chatState.finalizeStream).toHaveBeenCalledWith("Hello world", [
      { title: "Attention", path: "wiki/concepts/attention.md" },
    ])
    expect(streamChat).toHaveBeenCalledWith(
      llmConfig,
      expect.any(Array),
      expect.any(Object),
      expect.any(AbortSignal),
    )
  })
})
