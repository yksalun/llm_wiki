import { describe, expect, it, vi } from "vitest"
import type { ChatMessage } from "@/lib/llm-client"
import type { LlmConfig } from "@/stores/wiki-store"
import { useChatStore, type Conversation, type DisplayMessage } from "@/stores/chat-store"
import {
  buildProjectChatContext,
  createDefaultProjectChatDependencies,
  sendProjectChatMessage,
  type ProjectChatCallbacks,
  type ProjectChatDependencies,
  type ProjectChatRequest,
} from "../project-chat-service"

const project = {
  id: "project-1",
  name: "Demo Wiki",
  path: "C:/demo/project",
}

const request: ProjectChatRequest = {
  projectId: "project-1",
  projectPath: "C:/demo/project",
  conversationId: "conv-1",
  message: "How does attention work?",
}

const llmConfig: LlmConfig = {
  provider: "openai",
  apiKey: "test-key",
  model: "test-model",
  ollamaUrl: "",
  customEndpoint: "",
  maxContextSize: 20_000,
}

function message(
  role: DisplayMessage["role"],
  content: string,
  conversationId = "conv-1",
): DisplayMessage {
  return {
    id: `${conversationId}-${role}-${content}`,
    role,
    content,
    timestamp: 1,
    conversationId,
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
    getState: vi.fn(() => ({
      project,
      llmConfig,
      dataVersion: 7,
      messages: [],
      conversations: [],
      maxHistoryMessages: 10,
    })),
    addMessage: vi.fn(),
    upsertConversation: vi.fn(),
    now: vi.fn(() => 1_700_000_000_000),
    createAbortController: () => new AbortController(),
    ...overrides,
  }
}

function createCallbacks(
  overrides: Partial<ProjectChatCallbacks> = {},
): ProjectChatCallbacks {
  return {
    onToken: vi.fn(),
    onDone: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  }
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe("buildProjectChatContext", () => {
  it("skips retrieval for greetings and builds a lightweight system prompt", async () => {
    const deps = createDependencies({
      isGreeting: vi.fn(() => true),
      getState: vi.fn(() => ({
        project,
        llmConfig,
        dataVersion: 7,
        messages: [message("user", "previous question")],
        conversations: [],
        maxHistoryMessages: 10,
      })),
    })

    const context = await buildProjectChatContext(
      { ...request, message: "hello" },
      deps,
    )

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

  it("retrieves wiki context using explicit projectPath and returns page references", async () => {
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

    const context = await buildProjectChatContext(request, deps)

    expect(searchWiki).toHaveBeenCalledWith("C:/demo/project", request.message)
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

  it("filters history by explicit conversationId and excludes an already-added current user turn", async () => {
    const deps = createDependencies({
      isGreeting: vi.fn(() => true),
      getState: vi.fn(() => ({
        project,
        llmConfig,
        dataVersion: 7,
        messages: [
          message("user", "include this", "conv-1"),
          message("assistant", "include this too", "conv-1"),
          message("user", "other conversation", "conv-2"),
          message("user", "hello", "conv-1"),
        ],
        conversations: [],
        maxHistoryMessages: 10,
      })),
    })

    const context = await buildProjectChatContext(
      { ...request, message: "hello" },
      deps,
    )

    expect(context.messages.map((m) => m.content)).toEqual([
      context.messages[0].content,
      "include this",
      "include this too",
      "hello",
    ])
  })
})

describe("sendProjectChatMessage", () => {
  it("adds explicit conversation messages, streams tokens, and returns the assistant message with references", async () => {
    const events: string[] = []
    const addedMessages: DisplayMessage[] = []
    const upserted: Conversation[] = []
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
      getState: vi.fn(() => ({
        project,
        llmConfig,
        dataVersion: 7,
        messages: [message("assistant", "Earlier answer", "conv-1")],
        conversations: [],
        maxHistoryMessages: 10,
      })),
      upsertConversation: vi.fn((conversation: Conversation) => {
        events.push(`upsert:${conversation.id}:${conversation.title}`)
        upserted.push(conversation)
      }),
      addMessage: vi.fn((msg: DisplayMessage) => {
        events.push(`add:${msg.role}:${msg.content}`)
        addedMessages.push(msg)
      }),
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
    const onReferences = vi.fn()
    const onDone = vi.fn()
    const callbacks = createCallbacks({ onReferences, onDone })

    await sendProjectChatMessage(
      { ...request, message: "What is attention?" },
      callbacks,
      deps,
    )

    expect(events).toEqual([
      "upsert:conv-1:What is attention?",
      "add:user:What is attention?",
      "llm:[REMINDER: All output must be in English.]\n\nWhat is attention?",
      "add:assistant:Hello world",
    ])
    expect(callbacks.onToken).toHaveBeenCalledTimes(2)
    expect(onReferences).toHaveBeenCalledWith([
      { title: "Attention", path: "wiki/concepts/attention.md" },
    ])
    expect(onDone).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "assistant",
        content: "Hello world",
        conversationId: "conv-1",
        references: [{ title: "Attention", path: "wiki/concepts/attention.md" }],
      }),
    )
    expect(addedMessages).toEqual([
      expect.objectContaining({
        role: "user",
        content: "What is attention?",
        conversationId: "conv-1",
      }),
      expect.objectContaining({
        role: "assistant",
        content: "Hello world",
        conversationId: "conv-1",
        references: [{ title: "Attention", path: "wiki/concepts/attention.md" }],
      }),
    ])
    expect(streamChat).toHaveBeenCalledWith(
      llmConfig,
      expect.any(Array),
      expect.any(Object),
      expect.any(AbortSignal),
    )
    expect(upserted[0]).toMatchObject({
      id: "conv-1",
      title: "What is attention?",
    })
  })

  it("adds user and assistant error messages to the request conversation when context building fails", async () => {
    const error = new Error("graph unavailable")
    const addedMessages: DisplayMessage[] = []
    const deps = createDependencies({
      addMessage: vi.fn((msg: DisplayMessage) => {
        addedMessages.push(msg)
      }),
      searchWiki: vi.fn(async () => {
        throw error
      }),
    })
    const callbacks = createCallbacks()

    await sendProjectChatMessage(request, callbacks, deps)

    expect(callbacks.onError).toHaveBeenCalledWith(error)
    expect(callbacks.onDone).not.toHaveBeenCalled()
    expect(deps.streamChat).not.toHaveBeenCalled()
    expect(addedMessages).toEqual([
      expect.objectContaining({
        role: "user",
        content: request.message,
        conversationId: "conv-1",
      }),
      expect.objectContaining({
        role: "assistant",
        content: "Error: graph unavailable",
        conversationId: "conv-1",
      }),
    ])
  })

  it("adds assistant error to the request conversation for stream errors", async () => {
    const streamError = new Error("stream failed")
    const addedMessages: DisplayMessage[] = []
    const deps = createDependencies({
      isGreeting: vi.fn(() => true),
      addMessage: vi.fn((msg: DisplayMessage) => {
        addedMessages.push(msg)
      }),
      streamChat: vi.fn(async (_config, _messages, callbacks) => {
        callbacks.onError(streamError)
      }),
    })
    const callbacks = createCallbacks()

    await sendProjectChatMessage(
      { ...request, message: "hello" },
      callbacks,
      deps,
    )

    expect(callbacks.onError).toHaveBeenCalledTimes(1)
    expect(callbacks.onError).toHaveBeenCalledWith(streamError)
    expect(callbacks.onDone).not.toHaveBeenCalled()
    expect(addedMessages).toEqual([
      expect.objectContaining({
        role: "user",
        content: "hello",
        conversationId: "conv-1",
      }),
      expect.objectContaining({
        role: "assistant",
        content: "Error: stream failed",
        conversationId: "conv-1",
      }),
    ])
  })

  it("does not add a blank assistant message when aborted before streaming", async () => {
    const addedMessages: DisplayMessage[] = []
    const controller = new AbortController()
    const deps = createDependencies({
      addMessage: vi.fn((msg: DisplayMessage) => {
        addedMessages.push(msg)
      }),
      searchWiki: vi.fn(async () => {
        controller.abort()
        return []
      }),
      streamChat: vi.fn(async (_config, _messages, callbacks) => {
        callbacks.onDone()
      }),
    })
    const callbacks = createCallbacks()

    await sendProjectChatMessage(
      { ...request, message: "hello", signal: controller.signal },
      callbacks,
      deps,
    )

    expect(deps.streamChat).not.toHaveBeenCalled()
    expect(callbacks.onError).toHaveBeenCalledTimes(1)
    expect(callbacks.onDone).not.toHaveBeenCalled()
    expect(addedMessages).toEqual([
      expect.objectContaining({
        role: "user",
        content: "hello",
        conversationId: "conv-1",
      }),
    ])
    expect(addedMessages).not.toContainEqual(
      expect.objectContaining({
        role: "assistant",
        content: "",
      }),
    )
  })

  it("terminates promptly when aborted while context building is still pending", async () => {
    const pendingRead = createDeferred<string>()
    const addedMessages: DisplayMessage[] = []
    const controller = new AbortController()
    const deps = createDependencies({
      readFile: vi.fn(() => pendingRead.promise),
      addMessage: vi.fn((msg: DisplayMessage) => {
        addedMessages.push(msg)
      }),
      streamChat: vi.fn(async (_config, _messages, callbacks) => {
        callbacks.onDone()
      }),
    })
    const callbacks = createCallbacks()

    const sendPromise = sendProjectChatMessage(
      { ...request, signal: controller.signal },
      callbacks,
      deps,
    )

    expect(deps.readFile).toHaveBeenCalled()

    controller.abort()

    expect(callbacks.onError).toHaveBeenCalledTimes(1)
    expect(callbacks.onError).toHaveBeenCalledWith(
      expect.objectContaining({ name: "AbortError" }),
    )
    expect(callbacks.onDone).not.toHaveBeenCalled()

    pendingRead.resolve("")
    await sendPromise

    expect(deps.streamChat).not.toHaveBeenCalled()
    expect(callbacks.onError).toHaveBeenCalledTimes(1)
    expect(addedMessages).toEqual([
      expect.objectContaining({
        role: "user",
        content: request.message,
        conversationId: "conv-1",
      }),
    ])
  })

  it("does not add a blank assistant message when aborted during streaming before any token", async () => {
    const addedMessages: DisplayMessage[] = []
    const controller = new AbortController()
    const deps = createDependencies({
      isGreeting: vi.fn(() => true),
      addMessage: vi.fn((msg: DisplayMessage) => {
        addedMessages.push(msg)
      }),
      streamChat: vi.fn(async (_config, _messages, callbacks) => {
        controller.abort()
        callbacks.onDone()
      }),
    })
    const callbacks = createCallbacks()

    await sendProjectChatMessage(
      { ...request, message: "hello", signal: controller.signal },
      callbacks,
      deps,
    )

    expect(deps.streamChat).toHaveBeenCalled()
    expect(callbacks.onError).toHaveBeenCalledTimes(1)
    expect(callbacks.onError).toHaveBeenCalledWith(
      expect.objectContaining({ name: "AbortError" }),
    )
    expect(callbacks.onDone).not.toHaveBeenCalled()
    expect(addedMessages).toEqual([
      expect.objectContaining({
        role: "user",
        content: "hello",
        conversationId: "conv-1",
      }),
    ])
  })

  it("treats a plain Error abort reason as an abort instead of an assistant error", async () => {
    const addedMessages: DisplayMessage[] = []
    const controller = new AbortController()
    const deps = createDependencies({
      isGreeting: vi.fn(() => true),
      addMessage: vi.fn((msg: DisplayMessage) => {
        addedMessages.push(msg)
      }),
      streamChat: vi.fn(async (_config, _messages, callbacks) => {
        controller.abort(new Error("cancelled"))
        callbacks.onDone()
      }),
    })
    const callbacks = createCallbacks()

    await sendProjectChatMessage(
      { ...request, message: "hello", signal: controller.signal },
      callbacks,
      deps,
    )

    expect(callbacks.onError).toHaveBeenCalledTimes(1)
    expect(callbacks.onError).toHaveBeenCalledWith(
      expect.objectContaining({ name: "AbortError", message: "cancelled" }),
    )
    expect(callbacks.onDone).not.toHaveBeenCalled()
    expect(addedMessages).toEqual([
      expect.objectContaining({
        role: "user",
        content: "hello",
        conversationId: "conv-1",
      }),
    ])
  })

  it("renames an untouched placeholder conversation to the first user message", async () => {
    const existing: Conversation = {
      id: "conv-1",
      title: "New Conversation",
      createdAt: 100,
      updatedAt: 200,
    }
    const upsertConversation = vi.fn()
    const deps = createDependencies({
      isGreeting: vi.fn(() => true),
      now: vi.fn(() => 300),
      getState: vi.fn(() => ({
        project,
        llmConfig,
        dataVersion: 7,
        messages: [],
        conversations: [existing],
        maxHistoryMessages: 10,
      })),
      upsertConversation,
      streamChat: vi.fn(async (_config, _messages, callbacks) => {
        callbacks.onDone()
      }),
    })
    const firstMessage = "Explain the transformer attention mechanism in plain language"

    await sendProjectChatMessage(
      { ...request, message: firstMessage },
      createCallbacks(),
      deps,
    )

    expect(upsertConversation).toHaveBeenCalledWith({
      id: "conv-1",
      title: firstMessage.slice(0, 50),
      createdAt: 100,
      updatedAt: 300,
    })
  })

  it("preserves an existing conversation title while updating updatedAt", async () => {
    const existing: Conversation = {
      id: "conv-1",
      title: "Keep this title",
      createdAt: 100,
      updatedAt: 200,
    }
    const upsertConversation = vi.fn()
    const deps = createDependencies({
      isGreeting: vi.fn(() => true),
      now: vi.fn(() => 300),
      getState: vi.fn(() => ({
        project,
        llmConfig,
        dataVersion: 7,
        messages: [],
        conversations: [existing],
        maxHistoryMessages: 10,
      })),
      upsertConversation,
      streamChat: vi.fn(async (_config, _messages, callbacks) => {
        callbacks.onDone()
      }),
    })

    await sendProjectChatMessage(
      { ...request, message: "hello" },
      createCallbacks(),
      deps,
    )

    expect(upsertConversation).toHaveBeenCalledWith({
      id: "conv-1",
      title: "Keep this title",
      createdAt: 100,
      updatedAt: 300,
    })
  })

  it("preserves a placeholder title when the conversation already has user messages", async () => {
    const existing: Conversation = {
      id: "conv-1",
      title: "New Conversation",
      createdAt: 100,
      updatedAt: 200,
    }
    const upsertConversation = vi.fn()
    const deps = createDependencies({
      isGreeting: vi.fn(() => true),
      now: vi.fn(() => 300),
      getState: vi.fn(() => ({
        project,
        llmConfig,
        dataVersion: 7,
        messages: [message("user", "Earlier user message", "conv-1")],
        conversations: [existing],
        maxHistoryMessages: 10,
      })),
      upsertConversation,
      streamChat: vi.fn(async (_config, _messages, callbacks) => {
        callbacks.onDone()
      }),
    })

    await sendProjectChatMessage(
      { ...request, message: "hello" },
      createCallbacks(),
      deps,
    )

    expect(upsertConversation).toHaveBeenCalledWith({
      id: "conv-1",
      title: "New Conversation",
      createdAt: 100,
      updatedAt: 300,
    })
  })
})

describe("createDefaultProjectChatDependencies", () => {
  it("upsertConversation does not mutate activeConversationId", () => {
    const previous = useChatStore.getState()
    try {
      useChatStore.setState({
        activeConversationId: null,
        conversations: [],
        messages: [],
      })

      createDefaultProjectChatDependencies().upsertConversation({
        id: "conv-new",
        title: "New conversation",
        createdAt: 10,
        updatedAt: 20,
      })

      const state = useChatStore.getState()
      expect(state.activeConversationId).toBeNull()
      expect(state.conversations).toEqual([
        {
          id: "conv-new",
          title: "New conversation",
          createdAt: 10,
          updatedAt: 20,
        },
      ])
    } finally {
      useChatStore.setState({
        activeConversationId: previous.activeConversationId,
        conversations: previous.conversations,
        messages: previous.messages,
      })
    }
  })
})
