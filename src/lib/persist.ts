import { writeFile, readFile, createDirectory, listDirectory } from "@/commands/fs"
import type { ReviewItem } from "@/stores/review-store"
import type { DisplayMessage, Conversation } from "@/stores/chat-store"
import { normalizePath } from "@/lib/path-utils"

async function ensureDir(projectPath: string): Promise<void> {
  await createDirectory(`${projectPath}/.llm-wiki`).catch(() => {})
  await createDirectory(`${projectPath}/.llm-wiki/chats`).catch(() => {})
}

export async function saveReviewItems(projectPath: string, items: ReviewItem[]): Promise<void> {
  const pp = normalizePath(projectPath)
  await ensureDir(pp)
  await writeFile(`${pp}/.llm-wiki/review.json`, JSON.stringify(items, null, 2))
}

export async function loadReviewItems(projectPath: string): Promise<ReviewItem[]> {
  const pp = normalizePath(projectPath)
  try {
    const content = await readFile(`${pp}/.llm-wiki/review.json`)
    return parseJson<ReviewItem[]>(content)
  } catch {
    return []
  }
}

interface PersistedChatData {
  conversations: Conversation[]
  messages: DisplayMessage[]
}

export async function saveChatHistory(
  projectPath: string,
  conversations: Conversation[],
  messages: DisplayMessage[]
): Promise<void> {
  const pp = normalizePath(projectPath)
  await ensureDir(pp)

  // Save conversation list
  await writeFile(
    `${pp}/.llm-wiki/conversations.json`,
    JSON.stringify(conversations, null, 2)
  )

  // Save each conversation's messages separately
  const byConversation = new Map<string, DisplayMessage[]>()
  for (const msg of messages) {
    const list = byConversation.get(msg.conversationId) ?? []
    list.push(msg)
    byConversation.set(msg.conversationId, list)
  }

  for (const [convId, msgs] of byConversation) {
    // Keep last 100 messages per conversation
    const toSave = msgs.slice(-100)
    await writeFile(
      `${pp}/.llm-wiki/chats/${convId}.json`,
      JSON.stringify(toSave, null, 2)
    )
  }
}

export async function loadChatHistory(projectPath: string): Promise<PersistedChatData> {
  const pp = normalizePath(projectPath)
  const newFormatData = await loadNewFormatChatHistory(pp)
  if (newFormatData) return newFormatData

  const recovered = await recoverOrphanChatFiles(pp)
  if (recovered.conversations.length > 0) return recovered

  return loadLegacyChatHistory(pp)
}

async function loadNewFormatChatHistory(
  projectPath: string
): Promise<PersistedChatData | null> {
  try {
    // Try new format: separate files per conversation
    const convContent = await readFile(`${projectPath}/.llm-wiki/conversations.json`)
    const conversations = parseJson<Conversation[]>(convContent)

    const allMessages = await loadMessagesForConversations(projectPath, conversations)
    if (conversations.length === 0 && allMessages.length === 0) {
      const recovered = await recoverOrphanChatFiles(projectPath)
      if (recovered.conversations.length > 0) return recovered
    }

    return { conversations, messages: allMessages }
  } catch {
    return null
  }
}

async function loadLegacyChatHistory(projectPath: string): Promise<PersistedChatData> {
  try {
    const content = await readFile(`${projectPath}/.llm-wiki/chat-history.json`)
    const parsed = parseJson<PersistedChatData | DisplayMessage[]>(content)

    if (Array.isArray(parsed)) {
      // Very old format: flat array
      const legacyMessages = parsed as DisplayMessage[]
      const defaultConv: Conversation = {
        id: "default",
        title: "Previous Conversations",
        createdAt: legacyMessages[0]?.timestamp ?? Date.now(),
        updatedAt: legacyMessages[legacyMessages.length - 1]?.timestamp ?? Date.now(),
      }
      const migratedMessages = legacyMessages.map((m) => ({
        ...m,
        conversationId: "default",
      }))
      return { conversations: [defaultConv], messages: migratedMessages }
    }

    // Old combined format
    return parsed
  } catch {
    return { conversations: [], messages: [] }
  }
}

async function loadMessagesForConversations(
  projectPath: string,
  conversations: Conversation[]
): Promise<DisplayMessage[]> {
  const allMessages: DisplayMessage[] = []
  for (const conv of conversations) {
    try {
      const msgContent = await readFile(`${projectPath}/.llm-wiki/chats/${conv.id}.json`)
      const msgs = parseJson<DisplayMessage[]>(msgContent)
      allMessages.push(...msgs)
    } catch {
      // Conversation file missing, skip
    }
  }
  return allMessages
}

async function recoverOrphanChatFiles(projectPath: string): Promise<PersistedChatData> {
  const conversations: Conversation[] = []
  const messages: DisplayMessage[] = []

  try {
    const chatFiles = await listDirectory(`${projectPath}/.llm-wiki/chats`)
    for (const node of chatFiles) {
      if (node.is_dir || !node.name.endsWith(".json")) continue

      try {
        const content = await readFile(node.path)
        const parsed = parseJson<unknown>(content)
        if (!Array.isArray(parsed) || parsed.length === 0) continue

        const conversationId = node.name.replace(/\.json$/i, "")
        const recoveredMessages = (parsed as DisplayMessage[]).map((message) => ({
          ...message,
          conversationId,
        }))
        conversations.push(buildRecoveredConversation(conversationId, recoveredMessages))
        messages.push(...recoveredMessages)
      } catch {
        // Ignore a single unreadable chat file and keep recovering others.
      }
    }
  } catch {
    return { conversations: [], messages: [] }
  }

  conversations.sort((left, right) => right.updatedAt - left.updatedAt)
  return { conversations, messages }
}

function buildRecoveredConversation(
  id: string,
  messages: DisplayMessage[]
): Conversation {
  const timestamps = messages.map((message) => message.timestamp).filter(Number.isFinite)
  const firstUserMessage = messages.find((message) => message.role === "user")
  const firstMessage = firstUserMessage ?? messages[0]
  const title = firstMessage?.content.trim().slice(0, 50) || "Recovered Conversation"

  return {
    id,
    title,
    createdAt: timestamps.length > 0 ? Math.min(...timestamps) : Date.now(),
    updatedAt: timestamps.length > 0 ? Math.max(...timestamps) : Date.now(),
  }
}

function parseJson<T>(content: string): T {
  return JSON.parse(content.replace(/^\uFEFF/, "")) as T
}
