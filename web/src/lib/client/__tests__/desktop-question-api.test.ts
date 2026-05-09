import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createQuestionConversation,
  parseSseBlock,
} from "@/lib/client/desktop-question-api";

describe("desktop question client API", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the conversation created by the desktop bridge payload", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          conversation: {
            id: "conv-created",
            title: "Created conversation",
            createdAt: 1,
            updatedAt: 2,
          },
        }),
        { status: 200 },
      ),
    );

    await expect(createQuestionConversation("project/a b")).resolves.toEqual({
      id: "conv-created",
      title: "Created conversation",
      createdAt: 1,
      updatedAt: 2,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project%2Fa%20b/question/conversations",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
      }),
    );
  });

  it("parses answer metrics from a done stream event", () => {
    const event = parseSseBlock(
      [
        "data: {",
        'data:   "type": "done",',
        'data:   "message": {',
        'data:     "id": "msg-metrics",',
        'data:     "role": "assistant",',
        'data:     "content": "Measured answer",',
        'data:     "timestamp": 1,',
        'data:     "conversationId": "conv-a",',
        'data:     "metrics": {',
        'data:       "version": 1,',
        'data:       "totalDurationMs": 1432,',
        'data:       "stages": [',
        'data:         { "id": "search_wiki", "name": "Search wiki", "durationMs": 120 },',
        'data:         {',
        'data:           "id": "model_generation",',
        'data:           "name": "Model generation",',
        'data:           "durationMs": 980,',
        'data:           "tokenUsage": {',
        'data:             "inputTokens": 100,',
        'data:             "outputTokens": 20,',
        'data:             "totalTokens": 120',
        "data:           }",
        "data:         }",
        "data:       ]",
        "data:     }",
        "data:   }",
        "data: }",
      ].join("\n"),
    );

    expect(event).toEqual({
      type: "done",
      message: {
        id: "msg-metrics",
        role: "assistant",
        content: "Measured answer",
        timestamp: 1,
        conversationId: "conv-a",
        metrics: {
          version: 1,
          totalDurationMs: 1432,
          stages: [
            { id: "search_wiki", name: "Search wiki", durationMs: 120 },
            {
              id: "model_generation",
              name: "Model generation",
              durationMs: 980,
              tokenUsage: {
                inputTokens: 100,
                outputTokens: 20,
                totalTokens: 120,
              },
            },
          ],
        },
      },
    });
  });

  it("drops malformed answer metrics from a done stream event", () => {
    const event = parseSseBlock(
      [
        'data: {"type":"done","message":{',
        'data: "id":"msg-bad-metrics",',
        'data: "role":"assistant",',
        'data: "content":"Answer",',
        'data: "timestamp":1,',
        'data: "conversationId":"conv-a",',
        'data: "metrics":{"version":1,"totalDurationMs":-1,"stages":[]}',
        "data: }}",
      ].join("\n"),
    );

    expect(event).toEqual({
      type: "done",
      message: {
        id: "msg-bad-metrics",
        role: "assistant",
        content: "Answer",
        timestamp: 1,
        conversationId: "conv-a",
      },
    });
  });
});
