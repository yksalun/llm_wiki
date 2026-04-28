import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { normalizePath } from "@/lib/path-utils"
import { sendProjectChatMessage } from "@/lib/project-chat-service"
import {
  useChatStore,
  type Conversation,
  type DisplayMessage,
  type MessageReference,
} from "@/stores/chat-store"
import { useWikiStore } from "@/stores/wiki-store"

interface BridgeChatRequest {
  requestId: string
  projectId: string
  projectPath: string
  conversationId: string
  message: string
}

interface BridgeJsonRequest {
  requestId: string
  kind: "list_conversations" | "create_conversation" | "list_messages" | string
  projectId: string
  projectPath?: string
  conversationId?: string | null
  body?: unknown
}

interface BridgeMessage {
  id: string
  role: string
  content: string
  timestamp: number
  conversationId: string
  references: BridgeReference[]
}

interface BridgeReference {
  title: string
  path: string
}

const PROJECT_NOT_OPEN = "PROJECT_NOT_OPEN"
const PROJECT_MISMATCH = "PROJECT_MISMATCH"
const PROJECT_CHAT_ERROR = "PROJECT_CHAT_ERROR"

let unlistenFns: UnlistenFn[] = []
let registrationPromise: Promise<void> | null = null
let registrationGeneration = 0

export async function startWebBridgeHandler(): Promise<void> {
  if (registrationPromise || unlistenFns.length > 0) {
    return registrationPromise ?? undefined
  }

  const generation = ++registrationGeneration
  registrationPromise = Promise.all([
    listen<BridgeChatRequest>("web-bridge:chat-request", (event) => {
      void handleChatRequest(event.payload)
    }),
    listen<BridgeJsonRequest>("web-bridge:json-request", (event) => {
      void handleJsonRequest(event.payload)
    }),
  ])
    .then((registered) => {
      if (generation !== registrationGeneration) {
        for (const unlisten of registered) {
          unlisten()
        }
        return
      }
      unlistenFns = registered
    })
    .catch((error) => {
      if (generation === registrationGeneration) {
        registrationPromise = null
      }
      throw error
    })

  return registrationPromise
}

export function stopWebBridgeHandler(): void {
  registrationGeneration += 1
  for (const unlisten of unlistenFns) {
    unlisten()
  }
  unlistenFns = []
  registrationPromise = null
}

async function handleChatRequest(request: BridgeChatRequest): Promise<void> {
  const validation = validateOpenProject(request.projectId)
  if (!validation.ok) {
    await emitBridgeError(request.requestId, validation.code, validation.error)
    return
  }

  if (normalizePath(validation.projectPath) !== normalizePath(request.projectPath)) {
    await emitBridgeError(
      request.requestId,
      PROJECT_MISMATCH,
      "\u5f53\u524d\u6253\u5f00\u9879\u76ee\u4e0e\u8bf7\u6c42\u9879\u76ee\u8def\u5f84\u4e0d\u4e00\u81f4\u3002",
    )
    return
  }

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
        }).catch((error) => console.error("Failed to emit web bridge token:", error))
      },
      onReferences: (references) => {
        void emitBridgeReferences(request.requestId, references)
      },
      onDone: (message) => {
        void invoke("web_bridge_emit_done", {
          requestId: request.requestId,
          message: toBridgeMessage(message),
        }).catch((error) => console.error("Failed to emit web bridge done:", error))
      },
      onError: (error) => {
        void emitBridgeError(request.requestId, PROJECT_CHAT_ERROR, error.message)
      },
    },
  ).catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    void emitBridgeError(request.requestId, PROJECT_CHAT_ERROR, message)
  })
}

async function handleJsonRequest(request: BridgeJsonRequest): Promise<void> {
  const validation = validateOpenProject(request.projectId)
  if (!validation.ok) {
    await respondJson(request.requestId, 409, {
      ok: false,
      code: validation.code,
      error: validation.error,
    })
    return
  }

  try {
    const chatState = useChatStore.getState()
    switch (request.kind) {
      case "list_conversations":
        await respondJson(request.requestId, 200, {
          ok: true,
          conversations: [...chatState.conversations].sort((a, b) => b.updatedAt - a.updatedAt),
        })
        return

      case "create_conversation": {
        const conversation = createBridgeConversation(request.body)
        useChatStore.setState((state) => ({
          conversations: [conversation, ...state.conversations],
        }))
        await respondJson(request.requestId, 200, { ok: true, conversation })
        return
      }

      case "list_messages": {
        if (!request.conversationId) {
          await respondJson(request.requestId, 400, {
            ok: false,
            code: "MISSING_CONVERSATION_ID",
            error: "\u7f3a\u5c11 conversationId\u3002",
          })
          return
        }
        await respondJson(request.requestId, 200, {
          ok: true,
          messages: chatState.messages
            .filter((message) => message.conversationId === request.conversationId)
            .map(toBridgeMessage),
        })
        return
      }

      default:
        await respondJson(request.requestId, 400, {
          ok: false,
          code: "UNSUPPORTED_KIND",
          error: `\u4e0d\u652f\u6301\u7684\u8bf7\u6c42\u7c7b\u578b\uff1a${request.kind}`,
        })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await respondJson(request.requestId, 500, {
      ok: false,
      code: "INTERNAL_ERROR",
      error: message,
    })
  }
}

function validateOpenProject(projectId: string):
  | { ok: true; projectPath: string }
  | { ok: false; code: typeof PROJECT_NOT_OPEN | typeof PROJECT_MISMATCH; error: string } {
  const project = useWikiStore.getState().project
  if (!project) {
    return {
      ok: false,
      code: PROJECT_NOT_OPEN,
      error: "\u5f53\u524d\u684c\u9762\u7aef\u672a\u6253\u5f00\u9879\u76ee\u3002",
    }
  }
  if (project.id !== projectId) {
    return {
      ok: false,
      code: PROJECT_MISMATCH,
      error: "\u5f53\u524d\u6253\u5f00\u9879\u76ee\u4e0e\u8bf7\u6c42\u9879\u76ee\u4e0d\u4e00\u81f4\u3002",
    }
  }
  return { ok: true, projectPath: project.path }
}

function createBridgeConversation(body: unknown): Conversation {
  const now = Date.now()
  const requestedTitle =
    body && typeof body === "object" && "title" in body && typeof body.title === "string"
      ? body.title.trim()
      : ""

  return {
    id: `conv_${now}_${Math.random().toString(36).slice(2, 8)}`,
    title: requestedTitle || "New Conversation",
    createdAt: now,
    updatedAt: now,
  }
}

function toBridgeMessage(message: DisplayMessage): BridgeMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
    conversationId: message.conversationId,
    references: toBridgeReferences(message.references ?? []),
  }
}

function toBridgeReferences(references: MessageReference[]): BridgeReference[] {
  return references.map((reference) => ({
    title: reference.title,
    path: reference.path,
  }))
}

async function emitBridgeReferences(
  requestId: string,
  references: MessageReference[],
): Promise<void> {
  await invoke("web_bridge_emit_references", {
    requestId,
    references: toBridgeReferences(references),
  }).catch((error) => console.error("Failed to emit web bridge references:", error))
}

async function emitBridgeError(
  requestId: string,
  code: string,
  message: string,
): Promise<void> {
  await invoke("web_bridge_emit_error", {
    requestId,
    code,
    message,
  }).catch((error) => console.error("Failed to emit web bridge error:", error))
}

async function respondJson(requestId: string, status: number, body: unknown): Promise<void> {
  await invoke("web_bridge_respond_json", {
    requestId,
    status,
    body,
  }).catch((error) => console.error("Failed to respond web bridge JSON request:", error))
}
