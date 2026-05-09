import { beforeEach, describe, expect, it, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"

const mockHttpFetch = vi.hoisted(() =>
  vi.fn<(url: string, opts?: RequestInit) => Promise<Response>>(),
)

vi.mock("../tauri-fetch", () => ({
  getHttpFetch: () => Promise.resolve(mockHttpFetch),
  isFetchNetworkError: (err: unknown) => err instanceof TypeError,
}))

import { streamChat } from "../llm-client"

const openAiConfig: LlmConfig = {
  provider: "openai",
  apiKey: "test-key",
  model: "gpt-4o",
  ollamaUrl: "",
  customEndpoint: "",
  maxContextSize: 128000,
}

function sseResponse(lines: string[]): Response {
  return new Response(lines.join("\n"), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  })
}

describe("streamChat usage events", () => {
  beforeEach(() => {
    mockHttpFetch.mockReset()
  })

  it("emits official OpenAI token usage from usage-only SSE chunks", async () => {
    mockHttpFetch.mockResolvedValueOnce(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"hello"}}]}',
        "",
        'data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":7,"total_tokens":18}}',
        "",
        "data: [DONE]",
        "",
      ]),
    )
    const tokens: string[] = []
    const usages: Array<{ inputTokens?: number; outputTokens?: number; totalTokens?: number }> = []
    let done = false
    let error: Error | null = null

    await streamChat(
      openAiConfig,
      [{ role: "user", content: "hi" }],
      {
        onToken: (token) => {
          tokens.push(token)
        },
        onUsage: (usage) => {
          usages.push(usage)
        },
        onDone: () => {
          done = true
        },
        onError: (err) => {
          error = err
        },
      },
    )

    expect(error).toBeNull()
    expect(done).toBe(true)
    expect(tokens.join("")).toBe("hello")
    expect(usages).toEqual([
      { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
    ])
  })
})
