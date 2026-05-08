import { afterEach, describe, expect, it, vi } from "vitest"

import { useChatStore } from "@/stores/chat-store"
import { useReviewStore } from "@/stores/review-store"
import { useWikiStore } from "@/stores/wiki-store"

import { setupAutoSave } from "./auto-save"
import { saveChatHistory, saveReviewItems } from "./persist"

vi.mock("./persist", () => ({
  saveReviewItems: vi.fn(async () => {}),
  saveChatHistory: vi.fn(async () => {}),
}))

describe("setupAutoSave", () => {
  let stopAutoSave: (() => void) | null = null

  afterEach(() => {
    stopAutoSave?.()
    stopAutoSave = null
    vi.useRealTimers()
    vi.clearAllMocks()
    useWikiStore.setState({ project: null })
    useChatStore.setState({
      conversations: [],
      messages: [],
      activeConversationId: null,
      isStreaming: false,
      streamingContent: "",
    })
  })

  it("does not save a chat reset into a project selected after the reset", async () => {
    vi.useFakeTimers()
    stopAutoSave = setupAutoSave()

    useWikiStore.setState({ project: null })
    useChatStore.setState({
      conversations: [],
      messages: [],
      activeConversationId: null,
      isStreaming: false,
      streamingContent: "",
    })
    useWikiStore.setState({
      project: { id: "project-1", name: "Project One", path: "F:/projects/one" },
    })

    await vi.advanceTimersByTimeAsync(2000)

    expect(saveChatHistory).not.toHaveBeenCalled()
  })

  it("does not save a review reset into a project selected after the reset", async () => {
    vi.useFakeTimers()
    stopAutoSave = setupAutoSave()

    useWikiStore.setState({ project: null })
    useReviewStore.setState({ items: [] })
    useWikiStore.setState({
      project: { id: "project-1", name: "Project One", path: "F:/projects/one" },
    })

    await vi.advanceTimersByTimeAsync(1000)

    expect(saveReviewItems).not.toHaveBeenCalled()
  })
})
