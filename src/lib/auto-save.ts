import { useReviewStore } from "@/stores/review-store"
import { useChatStore } from "@/stores/chat-store"
import { useWikiStore } from "@/stores/wiki-store"
import { saveReviewItems, saveChatHistory } from "./persist"

let reviewTimer: ReturnType<typeof setTimeout> | null = null
let chatTimer: ReturnType<typeof setTimeout> | null = null
let cleanupAutoSave: (() => void) | null = null

export function setupAutoSave(): () => void {
  cleanupAutoSave?.()

  // Auto-save review items (debounced 1s)
  const unsubscribeReview = useReviewStore.subscribe((state) => {
    const project = useWikiStore.getState().project
    if (!project) return
    if (reviewTimer) clearTimeout(reviewTimer)
    reviewTimer = setTimeout(() => {
      const currentProject = useWikiStore.getState().project
      if (currentProject?.path !== project.path) return
      saveReviewItems(project.path, state.items).catch(() => {})
    }, 1000)
  })

  // Auto-save chat conversations and messages (debounced 2s, skip during streaming)
  const unsubscribeChat = useChatStore.subscribe((state) => {
    if (state.isStreaming) return
    const project = useWikiStore.getState().project
    if (!project) return
    if (chatTimer) clearTimeout(chatTimer)
    chatTimer = setTimeout(() => {
      const currentProject = useWikiStore.getState().project
      if (currentProject?.path !== project.path) return
      saveChatHistory(project.path, state.conversations, state.messages).catch(() => {})
    }, 2000)
  })

  const cleanup = () => {
    unsubscribeReview()
    unsubscribeChat()
    if (reviewTimer) clearTimeout(reviewTimer)
    if (chatTimer) clearTimeout(chatTimer)
    reviewTimer = null
    chatTimer = null
    if (cleanupAutoSave === cleanup) cleanupAutoSave = null
  }

  cleanupAutoSave = cleanup
  return cleanup
}
