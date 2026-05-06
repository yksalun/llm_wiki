import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { sendProjectChatMessage } from "@/lib/project-chat-service"

const mocks = vi.hoisted(() => ({
  listen: vi.fn(),
  invoke: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  listDirectory: vi.fn(),
  sendProjectChatMessage: vi.fn(),
}))

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}))

vi.mock("@/lib/project-chat-service", () => ({
  sendProjectChatMessage: mocks.sendProjectChatMessage,
}))

vi.mock("@/commands/fs", () => ({
  readFile: mocks.readFile,
  writeFile: mocks.writeFile,
  listDirectory: mocks.listDirectory,
}))

type BridgeChatRequest = {
  requestId: string
  projectId: string
  projectPath: string
  conversationId: string
  message: string
}

type BridgeJsonRequest = {
  requestId: string
  kind: string
  projectId: string
  projectPath?: string
  conversationId?: string | null
  messageId?: string
  body?: unknown
}

type ChatCallbacks = Parameters<typeof sendProjectChatMessage>[1]
type ChatRequest = Parameters<typeof sendProjectChatMessage>[0]

const project = {
  id: "project-1",
  name: "Demo Wiki",
  path: "C:/demo/project",
}

const baseRequest: BridgeChatRequest = {
  requestId: "request-1",
  projectId: project.id,
  projectPath: project.path,
  conversationId: "conv-1",
  message: "What is in this wiki?",
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function flushPromises() {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve()
  }
}

async function importTestModules() {
  vi.resetModules()
  const [handler, wikiStore, chatStore] = await Promise.all([
    import("@/lib/web-bridge-handler"),
    import("@/stores/wiki-store"),
    import("@/stores/chat-store"),
  ])
  return {
    ...handler,
    useWikiStore: wikiStore.useWikiStore,
    useChatStore: chatStore.useChatStore,
  }
}

function resetStores(
  useWikiStore: Awaited<ReturnType<typeof importTestModules>>["useWikiStore"],
  useChatStore: Awaited<ReturnType<typeof importTestModules>>["useChatStore"],
) {
  useWikiStore.setState({
    project: null,
    fileTree: [],
    selectedFile: null,
    fileContent: "",
    chatExpanded: false,
    activeView: "wiki",
    providerConfigs: {},
    activePresetId: null,
    dataVersion: 0,
  })
  useChatStore.setState({
    conversations: [],
    activeConversationId: null,
    messages: [],
    isStreaming: false,
    streamingContent: "",
    mode: "chat",
    ingestSource: null,
    maxHistoryMessages: 10,
  })
}

function setupListeners() {
  const handlers = new Map<string, (event: { payload: unknown }) => void>()
  const unlisteners = new Map<string, ReturnType<typeof vi.fn>>()
  mocks.listen.mockImplementation(async (eventName: string, handler: (event: { payload: unknown }) => void) => {
    handlers.set(eventName, handler)
    const unlisten = vi.fn()
    unlisteners.set(eventName, unlisten)
    return unlisten
  })
  return { handlers, unlisteners }
}

async function emitChat(payload: BridgeChatRequest) {
  const chatHandler = handlersForTest.get("web-bridge:chat-request")
  expect(chatHandler).toBeDefined()
  chatHandler?.({ payload })
  await Promise.resolve()
}

async function emitJson(payload: BridgeJsonRequest) {
  const jsonHandler = handlersForTest.get("web-bridge:json-request")
  expect(jsonHandler).toBeDefined()
  jsonHandler?.({ payload })
  await Promise.resolve()
}

async function emitCancel(payload: { requestId: string }) {
  const cancelHandler = handlersForTest.get("web-bridge:stream-cancel")
  expect(cancelHandler).toBeDefined()
  cancelHandler?.({ payload })
  await Promise.resolve()
}

let handlersForTest: Map<string, (event: { payload: unknown }) => void>

beforeEach(() => {
  mocks.listen.mockReset()
  mocks.invoke.mockReset()
  mocks.readFile.mockReset()
  mocks.writeFile.mockReset()
  mocks.listDirectory.mockReset()
  mocks.sendProjectChatMessage.mockReset()
  mocks.invoke.mockResolvedValue(undefined)
  mocks.readFile.mockRejectedValue(new Error("missing file"))
  mocks.writeFile.mockResolvedValue(undefined)
  mocks.listDirectory.mockResolvedValue([])
  const setup = setupListeners()
  handlersForTest = setup.handlers
})

afterEach(async () => {
  const mod = await import("@/lib/web-bridge-handler").catch(() => null)
  mod?.stopWebBridgeHandler()
  vi.unstubAllGlobals()
})

describe("startWebBridgeHandler", () => {
  it("cleans up an already registered listener when a later listener fails and can retry", async () => {
    const firstUnlisten = vi.fn()
    const secondUnlisten = vi.fn()
    const thirdUnlisten = vi.fn()
    mocks.listen
      .mockResolvedValueOnce(firstUnlisten)
      .mockRejectedValueOnce(new Error("listen failed"))
      .mockResolvedValueOnce(firstUnlisten)
      .mockResolvedValueOnce(secondUnlisten)
      .mockResolvedValueOnce(thirdUnlisten)

    const { startWebBridgeHandler } = await importTestModules()

    await expect(startWebBridgeHandler()).rejects.toThrow("listen failed")
    expect(firstUnlisten).toHaveBeenCalledTimes(1)

    await expect(startWebBridgeHandler()).resolves.toBeUndefined()
    expect(mocks.listen).toHaveBeenCalledTimes(5)
  })

  it("cleans up listeners registered before stop during a pending registration", async () => {
    const firstUnlisten = vi.fn()
    const secondUnlisten = vi.fn()
    const thirdUnlisten = vi.fn()
    const secondListen = createDeferred<() => void>()
    mocks.listen
      .mockResolvedValueOnce(firstUnlisten)
      .mockReturnValueOnce(secondListen.promise)
      .mockResolvedValueOnce(firstUnlisten)
      .mockResolvedValueOnce(secondUnlisten)
      .mockResolvedValueOnce(thirdUnlisten)

    const { startWebBridgeHandler, stopWebBridgeHandler } = await importTestModules()

    const startPromise = startWebBridgeHandler()
    await flushPromises()
    expect(mocks.listen).toHaveBeenCalledTimes(2)

    stopWebBridgeHandler()
    expect(firstUnlisten).toHaveBeenCalledTimes(1)

    secondListen.resolve(secondUnlisten)
    await expect(startPromise).resolves.toBeUndefined()
    expect(secondUnlisten).toHaveBeenCalledTimes(1)

    await expect(startWebBridgeHandler()).resolves.toBeUndefined()
    expect(mocks.listen).toHaveBeenCalledTimes(6)
  })
})

describe("web bridge chat requests", () => {
  it("rejects a second bridge request for the same active conversation", async () => {
    const pending = createDeferred()
    mocks.sendProjectChatMessage.mockReturnValue(pending.promise)

    const { startWebBridgeHandler, useWikiStore, useChatStore } = await importTestModules()
    resetStores(useWikiStore, useChatStore)
    useWikiStore.setState({ project })
    await startWebBridgeHandler()

    await emitChat(baseRequest)
    await emitChat({ ...baseRequest, requestId: "request-2" })

    expect(mocks.sendProjectChatMessage).toHaveBeenCalledTimes(1)
    expect(mocks.invoke).toHaveBeenCalledWith("web_bridge_emit_error", {
      requestId: "request-2",
      code: "CONVERSATION_BUSY",
      message: expect.stringContaining("正在"),
    })

    pending.resolve()
    await pending.promise
  })

  it("aborts the service signal on project switch and emits only one terminal error", async () => {
    let capturedRequest!: ChatRequest
    let capturedCallbacks!: ChatCallbacks
    const pending = createDeferred()
    mocks.sendProjectChatMessage.mockImplementation((request: ChatRequest, callbacks: ChatCallbacks) => {
      capturedRequest = request
      capturedCallbacks = callbacks
      return pending.promise
    })

    const { startWebBridgeHandler, useWikiStore, useChatStore } = await importTestModules()
    resetStores(useWikiStore, useChatStore)
    useWikiStore.setState({ project })
    await startWebBridgeHandler()
    await emitChat(baseRequest)

    useWikiStore.setState({
      project: { ...project, id: "project-2", path: "C:/demo/other" },
    })
    await flushPromises()

    expect(capturedRequest.signal?.aborted).toBe(true)
    expect(mocks.invoke).toHaveBeenCalledWith("web_bridge_emit_error", {
      requestId: baseRequest.requestId,
      code: "PROJECT_MISMATCH",
      message: expect.any(String),
    })

    capturedCallbacks.onError(new Error("aborted by service"))
    pending.resolve()
    await pending.promise
    await Promise.resolve()

    const terminalErrors = mocks.invoke.mock.calls.filter(
      ([command]) => command === "web_bridge_emit_error",
    )
    expect(terminalErrors).toHaveLength(1)
  })

  it("waits for references invoke to resolve before emitting done", async () => {
    const referencesDeferred = createDeferred()
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "web_bridge_emit_references") {
        return referencesDeferred.promise
      }
      return Promise.resolve()
    })
    mocks.sendProjectChatMessage.mockImplementation(async (_request: ChatRequest, callbacks: ChatCallbacks) => {
      callbacks.onReferences?.([{ title: "Overview", path: "wiki/overview.md" }])
      callbacks.onDone({
        id: "msg-1",
        role: "assistant",
        content: "Done",
        timestamp: 1,
        conversationId: baseRequest.conversationId,
        references: [{ title: "Overview", path: "wiki/overview.md" }],
      })
    })

    const { startWebBridgeHandler, useWikiStore, useChatStore } = await importTestModules()
    resetStores(useWikiStore, useChatStore)
    useWikiStore.setState({ project })
    await startWebBridgeHandler()
    await emitChat(baseRequest)
    await Promise.resolve()

    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual([
      "web_bridge_emit_references",
    ])

    referencesDeferred.resolve()
    await referencesDeferred.promise
    await flushPromises()

    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual([
      "web_bridge_emit_references",
      "web_bridge_emit_done",
    ])
  })

  it("aborts immediately on project switch while references invoke is pending", async () => {
    let capturedRequest!: ChatRequest
    const servicePending = createDeferred()
    const referencesDeferred = createDeferred()
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "web_bridge_emit_references") {
        return referencesDeferred.promise
      }
      return Promise.resolve()
    })
    mocks.sendProjectChatMessage.mockImplementation((request: ChatRequest, callbacks: ChatCallbacks) => {
      capturedRequest = request
      callbacks.onReferences?.([{ title: "Overview", path: "wiki/overview.md" }])
      return servicePending.promise
    })

    const { startWebBridgeHandler, useWikiStore, useChatStore } = await importTestModules()
    resetStores(useWikiStore, useChatStore)
    useWikiStore.setState({ project })
    await startWebBridgeHandler()
    await emitChat(baseRequest)
    await flushPromises()

    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual([
      "web_bridge_emit_references",
    ])

    useWikiStore.setState({
      project: { ...project, id: "project-2", path: "C:/demo/other" },
    })

    expect(capturedRequest.signal?.aborted).toBe(true)

    referencesDeferred.resolve()
    await referencesDeferred.promise
    servicePending.resolve()
    await servicePending.promise
    await flushPromises()

    const commands = mocks.invoke.mock.calls.map(([command]) => command)
    expect(commands).toEqual([
      "web_bridge_emit_references",
      "web_bridge_emit_error",
    ])
  })

  it("aborts the matching service signal when the HTTP stream is canceled", async () => {
    let capturedRequest!: ChatRequest
    const servicePending = createDeferred()
    mocks.sendProjectChatMessage.mockImplementation((request: ChatRequest) => {
      capturedRequest = request
      return servicePending.promise
    })

    const { startWebBridgeHandler, useWikiStore, useChatStore } = await importTestModules()
    resetStores(useWikiStore, useChatStore)
    useWikiStore.setState({ project })
    await startWebBridgeHandler()
    await emitChat(baseRequest)

    expect(capturedRequest.signal?.aborted).toBe(false)

    await emitCancel({ requestId: baseRequest.requestId })

    expect(capturedRequest.signal?.aborted).toBe(true)

    servicePending.resolve()
    await servicePending.promise
  })
})

describe("web bridge JSON requests", () => {
  it("rejects answer actions missing messageId or body with 400", async () => {
    const { startWebBridgeHandler, useWikiStore, useChatStore } = await importTestModules()
    resetStores(useWikiStore, useChatStore)
    useWikiStore.setState({ project })
    await startWebBridgeHandler()

    await emitJson({
      requestId: "json-action-no-message",
      kind: "copy_answer",
      projectId: project.id,
      conversationId: "conv-1",
      body: { content: "answer", references: [] },
    })
    await emitJson({
      requestId: "json-action-no-body",
      kind: "copy_answer",
      projectId: project.id,
      conversationId: "conv-1",
      messageId: "msg-1",
    })
    await flushPromises()

    expect(mocks.invoke).toHaveBeenCalledWith("web_bridge_respond_json", {
      requestId: "json-action-no-message",
      status: 400,
      body: {
        ok: false,
        code: "INVALID_MESSAGE_ACTION_REQUEST",
        error: expect.any(String),
      },
    })
    expect(mocks.invoke).toHaveBeenCalledWith("web_bridge_respond_json", {
      requestId: "json-action-no-body",
      status: 400,
      body: {
        ok: false,
        code: "INVALID_MESSAGE_ACTION_REQUEST",
        error: expect.any(String),
      },
    })
  })

  it("copies a cleaned answer to the clipboard and responds success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { clipboard: { writeText } })

    const { startWebBridgeHandler, useWikiStore, useChatStore } = await importTestModules()
    resetStores(useWikiStore, useChatStore)
    useWikiStore.setState({ project })
    await startWebBridgeHandler()

    await emitJson({
      requestId: "json-copy-answer",
      kind: "copy_answer",
      projectId: project.id,
      conversationId: "conv-1",
      messageId: "msg-1",
      body: {
        content: "Answer<!-- sources: hidden --><think>private</think>",
        references: [],
      },
    })
    await flushPromises()

    expect(writeText).toHaveBeenCalledWith("Answer")
    expect(mocks.invoke).toHaveBeenCalledWith("web_bridge_respond_json", {
      requestId: "json-copy-answer",
      status: 200,
      body: { ok: true },
    })
  })

  it("regenerates an answer from the preceding user message and returns updated conversation messages", async () => {
    let capturedRequest!: ChatRequest
    let capturedCallbacks!: ChatCallbacks

    const { startWebBridgeHandler, useWikiStore, useChatStore } = await importTestModules()
    mocks.sendProjectChatMessage.mockImplementation(async (request: ChatRequest, callbacks: ChatCallbacks) => {
      capturedRequest = request
      capturedCallbacks = callbacks
      useChatStore.setState((state) => ({
        messages: [
          ...state.messages,
          {
            id: "user-new",
            role: "user",
            content: request.message,
            timestamp: 3,
            conversationId: request.conversationId,
          },
        ],
      }))
      callbacks.onDone({
        id: "assistant-new",
        role: "assistant",
        content: "new answer",
        timestamp: 4,
        conversationId: "conv-1",
        references: [{ title: "Doc", path: "wiki/doc.md" }],
      })
    })
    resetStores(useWikiStore, useChatStore)
    useWikiStore.setState({ project })
    useChatStore.setState({
      activeConversationId: "conv-1",
      conversations: [{ id: "conv-1", title: "Question", createdAt: 1, updatedAt: 1 }],
      messages: [
        { id: "user-old", role: "user", content: "old question", timestamp: 1, conversationId: "conv-1" },
        { id: "assistant-old", role: "assistant", content: "old answer", timestamp: 2, conversationId: "conv-1" },
      ],
    })
    await startWebBridgeHandler()

    await emitJson({
      requestId: "json-regenerate-answer",
      kind: "regenerate_answer",
      projectId: project.id,
      conversationId: "conv-1",
      messageId: "assistant-old",
      body: { content: "old answer", references: [] },
    })
    await flushPromises()

    expect(capturedRequest).toMatchObject({
      projectId: project.id,
      projectPath: project.path,
      conversationId: "conv-1",
      message: "old question",
    })
    expect(capturedRequest.signal).toBeInstanceOf(AbortSignal)
    expect(capturedCallbacks).toBeDefined()
    expect(useChatStore.getState().messages).toEqual([
      {
        id: "user-new",
        role: "user",
        content: "old question",
        timestamp: 3,
        conversationId: "conv-1",
      },
      {
        id: "assistant-new",
        role: "assistant",
        content: "new answer",
        timestamp: 4,
        conversationId: "conv-1",
        references: [{ title: "Doc", path: "wiki/doc.md" }],
      },
    ])
    expect(mocks.invoke).toHaveBeenCalledWith("web_bridge_respond_json", {
      requestId: "json-regenerate-answer",
      status: 200,
      body: {
        ok: true,
        messages: [
          {
            id: "user-new",
            role: "user",
            content: "old question",
            timestamp: 3,
            conversationId: "conv-1",
            references: [],
          },
          {
            id: "assistant-new",
            role: "assistant",
            content: "new answer",
            timestamp: 4,
            conversationId: "conv-1",
            references: [{ title: "Doc", path: "wiki/doc.md" }],
          },
        ],
      },
    })
  })

  it("saves an answer to wiki queries and responds with the saved path", async () => {
    mocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith("/wiki/index.md")) return "# Wiki Index\n\n## Queries\n"
      if (path.endsWith("/wiki/log.md")) return "# Wiki Log\n\n"
      throw new Error(`unexpected read: ${path}`)
    })

    const { startWebBridgeHandler, useWikiStore, useChatStore } = await importTestModules()
    resetStores(useWikiStore, useChatStore)
    useWikiStore.setState({ project })
    await startWebBridgeHandler()

    await emitJson({
      requestId: "json-save-answer",
      kind: "save_answer_to_wiki",
      projectId: project.id,
      conversationId: "conv-1",
      messageId: "assistant-save",
      body: {
        content: "# Saved Answer\n\nBody<!-- sources: hidden --><think>private</think>",
        references: [],
      },
    })
    await flushPromises()

    const queryWrite = mocks.writeFile.mock.calls.find(([path]) =>
      String(path).startsWith("C:/demo/project/wiki/queries/saved-answer-"),
    )
    expect(queryWrite).toBeDefined()
    expect(String(queryWrite?.[1])).toContain('title: "Saved Answer"')
    expect(String(queryWrite?.[1])).toContain("Body")
    expect(String(queryWrite?.[1])).not.toContain("sources: hidden")
    expect(mocks.invoke).toHaveBeenCalledWith("web_bridge_respond_json", {
      requestId: "json-save-answer",
      status: 200,
      body: {
        ok: true,
        savedPath: expect.stringMatching(/^wiki\/queries\/saved-answer-\d{4}-\d{2}-\d{2}-\d{6}\.md$/),
      },
    })
  })

  it("rejects create_conversation with a mismatched projectPath without modifying conversations", async () => {
    const { startWebBridgeHandler, useWikiStore, useChatStore } = await importTestModules()
    resetStores(useWikiStore, useChatStore)
    useWikiStore.setState({ project })
    useChatStore.setState({
      conversations: [
        {
          id: "existing",
          title: "Existing",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    })
    await startWebBridgeHandler()

    await emitJson({
      requestId: "json-1",
      kind: "create_conversation",
      projectId: project.id,
      projectPath: "C:/demo/other",
      body: { title: "Should not exist" },
    })
    await flushPromises()

    expect(useChatStore.getState().conversations).toEqual([
      {
        id: "existing",
        title: "Existing",
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    expect(mocks.invoke).toHaveBeenCalledWith("web_bridge_respond_json", {
      requestId: "json-1",
      status: 409,
      body: {
        ok: false,
        code: "PROJECT_MISMATCH",
        error: expect.any(String),
      },
    })
  })
})
