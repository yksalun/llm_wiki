import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { sendProjectChatMessage } from "@/lib/project-chat-service"

const mocks = vi.hoisted(() => ({
  listen: vi.fn(),
  invoke: vi.fn(),
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

type BridgeChatRequest = {
  requestId: string
  projectId: string
  projectPath: string
  conversationId: string
  message: string
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

let handlersForTest: Map<string, (event: { payload: unknown }) => void>

beforeEach(() => {
  mocks.listen.mockReset()
  mocks.invoke.mockReset()
  mocks.sendProjectChatMessage.mockReset()
  mocks.invoke.mockResolvedValue(undefined)
  const setup = setupListeners()
  handlersForTest = setup.handlers
})

afterEach(async () => {
  const mod = await import("@/lib/web-bridge-handler").catch(() => null)
  mod?.stopWebBridgeHandler()
})

describe("startWebBridgeHandler", () => {
  it("cleans up an already registered listener when a later listener fails and can retry", async () => {
    const firstUnlisten = vi.fn()
    const secondUnlisten = vi.fn()
    mocks.listen
      .mockResolvedValueOnce(firstUnlisten)
      .mockRejectedValueOnce(new Error("listen failed"))
      .mockResolvedValueOnce(firstUnlisten)
      .mockResolvedValueOnce(secondUnlisten)

    const { startWebBridgeHandler } = await importTestModules()

    await expect(startWebBridgeHandler()).rejects.toThrow("listen failed")
    expect(firstUnlisten).toHaveBeenCalledTimes(1)

    await expect(startWebBridgeHandler()).resolves.toBeUndefined()
    expect(mocks.listen).toHaveBeenCalledTimes(4)
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
})
