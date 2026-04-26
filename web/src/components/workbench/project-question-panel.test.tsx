// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProjectQuestionResponse } from "@/lib/types";

import { ProjectQuestionPanel } from "./project-question-panel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }

  container?.remove();
  container = null;
  root = null;
  vi.clearAllMocks();
});

describe("ProjectQuestionPanel", () => {
  it("disables Ask for questions shorter than two trimmed characters", () => {
    renderProjectQuestionPanel();

    updateQuestion(" a ");

    expect(requiredButton("Ask").disabled).toBe(true);
  });

  it("submits a project question with history and an abort signal", async () => {
    const askFn = vi.fn().mockResolvedValue(createQuestionResponse());

    renderProjectQuestionPanel({ projectId: "project/a", askFn });
    updateQuestion("Where is the schema?");

    await clickButton("Ask");

    expect(askFn).toHaveBeenCalledWith(
      "project/a",
      { question: "Where is the schema?", history: [] },
      expect.any(AbortSignal),
    );
  });

  it("renders the answer and source details after success", async () => {
    const askFn = vi.fn().mockResolvedValue(
      createQuestionResponse({
        answer: "The schema is documented in the wiki.",
        sources: [
          {
            id: 1,
            relativePath: "wiki/schema.md",
            lineNumber: 1,
            preview: "Schema overview",
          },
        ],
      }),
    );

    renderProjectQuestionPanel({ askFn });
    updateQuestion("Where is the schema?");

    await clickButton("Ask");

    expect(container?.textContent).toContain("The schema is documented in the wiki.");
    expect(container?.textContent).toContain("wiki/schema.md");
    expect(container?.textContent).toContain("Line 1");
    expect(container?.textContent).toContain("Schema overview");
  });

  it("opens a source by relative path", async () => {
    const onOpenFile = vi.fn();
    const askFn = vi.fn().mockResolvedValue(
      createQuestionResponse({
        sources: [
          {
            id: 1,
            relativePath: "wiki/schema.md",
            lineNumber: 1,
            preview: "Schema overview",
          },
        ],
      }),
    );

    renderProjectQuestionPanel({ onOpenFile, askFn });
    updateQuestion("Where is the schema?");
    await clickButton("Ask");

    await clickButton("Open source");

    expect(onOpenFile).toHaveBeenCalledWith("wiki/schema.md");
    expect(onOpenFile).toHaveBeenCalledTimes(1);
  });

  it("renders an error and retries the last question", async () => {
    const askFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("Question service unavailable"))
      .mockResolvedValueOnce(createQuestionResponse({ answer: "Retry answer" }));

    renderProjectQuestionPanel({ askFn });
    updateQuestion("Where is the schema?");

    await clickButton("Ask");

    expect(container?.textContent).toContain("Question service unavailable");
    expect(container?.textContent).toContain("Retry");

    await clickButton("Retry");

    expect(askFn).toHaveBeenCalledTimes(2);
    expect(askFn).toHaveBeenLastCalledWith(
      "project-1",
      { question: "Where is the schema?", history: [] },
      expect.any(AbortSignal),
    );
    expect(container?.textContent).toContain("Retry answer");
  });

  it("includes prior user and assistant messages in a second submission", async () => {
    const askFn = vi
      .fn()
      .mockResolvedValueOnce(
        createQuestionResponse({
          question: "Where is the schema?",
          answer: "The schema is in wiki/schema.md.",
        }),
      )
      .mockResolvedValueOnce(
        createQuestionResponse({
          question: "What owns it?",
          answer: "The architecture page owns it.",
        }),
      );

    renderProjectQuestionPanel({ askFn });
    updateQuestion("Where is the schema?");
    await clickButton("Ask");

    updateQuestion("What owns it?");
    await clickButton("Ask");

    expect(askFn).toHaveBeenLastCalledWith(
      "project-1",
      {
        question: "What owns it?",
        history: [
          { role: "user", content: "Where is the schema?" },
          { role: "assistant", content: "The schema is in wiki/schema.md." },
        ],
      },
      expect.any(AbortSignal),
    );
  });
});

function renderProjectQuestionPanel({
  projectId = "project-1",
  onOpenFile = vi.fn(),
  askFn = vi.fn(),
}: {
  projectId?: string;
  onOpenFile?: (relativePath: string) => void;
  askFn?: ComponentProps<typeof ProjectQuestionPanel>["askFn"];
} = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  act(() => {
    root?.render(
      <ProjectQuestionPanel projectId={projectId} onOpenFile={onOpenFile} askFn={askFn} />,
    );
  });
}

function updateQuestion(value: string) {
  const textarea = container?.querySelector("textarea");

  if (!textarea) {
    throw new Error("Expected question textarea.");
  }

  act(() => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")
      ?.set;
    valueSetter?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function clickButton(name: string) {
  await act(async () => {
    requiredButton(name).click();
    await Promise.resolve();
  });
}

function createQuestionResponse(
  overrides: Partial<ProjectQuestionResponse> = {},
): ProjectQuestionResponse {
  return {
    question: "Where is the schema?",
    answer: "The schema is in wiki/schema.md.",
    sources: [
      {
        id: 1,
        relativePath: "wiki/schema.md",
        lineNumber: 1,
        preview: "Schema overview",
      },
    ],
    retrieval: {
      queries: ["schema"],
      totalMatches: 1,
      truncated: false,
    },
    model: "test-model",
    ...overrides,
  };
}

function requiredButton(name: string) {
  const button = Array.from(container?.querySelectorAll("button") ?? []).find(
    (candidate) => candidate.textContent?.trim() === name,
  );

  if (!button) {
    throw new Error(`Expected button named ${name}.`);
  }

  return button;
}
