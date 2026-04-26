import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../app-error";
import { generateProjectAnswer, parseOpenAIResponseText } from "../llm-provider";

const config = {
  apiKey: "test-key",
  model: "gpt-test",
  baseUrl: "https://gateway.example.test/v1/responses",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseOpenAIResponseText", () => {
  it("reads non-empty output_text first", () => {
    expect(
      parseOpenAIResponseText({
        output_text: "  direct answer  ",
        output: [
          {
            content: [{ text: "fallback answer" }],
          },
        ],
      }),
    ).toBe("direct answer");
  });

  it("falls back to concatenating output content text values", () => {
    expect(
      parseOpenAIResponseText({
        output: [
          {
            content: [{ text: "first " }, { text: "" }],
          },
          {
            content: [{ type: "output_text", text: "second" }],
          },
        ],
      }),
    ).toBe("first second");
  });

  it("returns null when no answer text can be parsed", () => {
    expect(parseOpenAIResponseText({ output_text: "   ", output: [] })).toBeNull();
    expect(parseOpenAIResponseText(null)).toBeNull();
  });
});

describe("generateProjectAnswer", () => {
  it("posts a non-streaming OpenAI Responses API request and returns the answer", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ output_text: "project answer" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateProjectAnswer({
        question: "What changed?",
        prompt: "Answer from project context.",
        config,
      }),
    ).resolves.toEqual({ answer: "project answer", model: "gpt-test" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://gateway.example.test/v1/responses",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer test-key",
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          model: "gpt-test",
          input: [
            { role: "system", content: "Answer from project context." },
            { role: "user", content: "What changed?" },
          ],
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("wraps non-2xx responses as provider errors with status details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: vi.fn(),
      }),
    );

    await expect(
      generateProjectAnswer({ question: "Q", prompt: "P", config }),
    ).rejects.toThrow(
      expect.objectContaining({
        code: "PROJECT_QA_PROVIDER_ERROR",
        status: 502,
        publicDetails: { providerStatus: 429 },
      }),
    );
  });

  it("throws invalid response when the provider JSON has no answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ output: [] }),
      }),
    );

    await expect(
      generateProjectAnswer({ question: "Q", prompt: "P", config }),
    ).rejects.toThrow(
      expect.objectContaining({
        code: "PROJECT_QA_PROVIDER_INVALID_RESPONSE",
        status: 502,
      }),
    );
  });

  it("throws invalid response when provider JSON parsing fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockRejectedValue(new SyntaxError("invalid json")),
      }),
    );

    await expect(
      generateProjectAnswer({ question: "Q", prompt: "P", config }),
    ).rejects.toThrow(
      expect.objectContaining({
        code: "PROJECT_QA_PROVIDER_INVALID_RESPONSE",
        status: 502,
      }),
    );
  });

  it("wraps fetch failures and aborts as provider errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("timed out", "AbortError")),
    );

    await expect(
      generateProjectAnswer({ question: "Q", prompt: "P", config }),
    ).rejects.toThrow(AppError);
    await expect(
      generateProjectAnswer({ question: "Q", prompt: "P", config }),
    ).rejects.toThrow(
      expect.objectContaining({
        code: "PROJECT_QA_PROVIDER_ERROR",
        status: 502,
      }),
    );
  });
});
