import { afterEach, describe, expect, it, vi } from "vitest";

import { createQuestionConversation } from "@/lib/client/desktop-question-api";

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
});
