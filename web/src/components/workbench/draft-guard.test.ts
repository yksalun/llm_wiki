import { describe, expect, it } from "vitest";

import {
  buildPendingDraftMessage,
  hasBlockingDraft,
  type PendingWorkbenchIntent,
} from "./draft-guard";

describe("hasBlockingDraft", () => {
  it("only blocks when a dirty editable draft is not saving", () => {
    const states = [
      { dirty: true, saving: false, fileMode: "editable" as const, expected: true },
      { dirty: false, saving: false, fileMode: "editable" as const, expected: false },
      { dirty: true, saving: true, fileMode: "editable" as const, expected: false },
      { dirty: true, saving: false, fileMode: "preview" as const, expected: false },
      { dirty: true, saving: false, fileMode: "metadata" as const, expected: false },
      { dirty: true, saving: false, fileMode: "unsupported" as const, expected: false },
      { dirty: true, saving: false, fileMode: null, expected: false },
    ];

    for (const state of states) {
      expect(
        hasBlockingDraft({
          dirty: state.dirty,
          saving: state.saving,
          fileMode: state.fileMode,
        }),
      ).toBe(state.expected);
    }
  });
});

describe("buildPendingDraftMessage", () => {
  it("includes the target path for open-file intents", () => {
    const message = buildPendingDraftMessage({
      type: "open-file",
      path: "docs/overview.md",
    });

    expect(message).toContain("docs/overview.md");
  });

  it("includes the target path and section for open-section-file intents", () => {
    const message = buildPendingDraftMessage({
      type: "open-section-file",
      path: "docs/overview.md",
      section: "Quick Start",
    });

    expect(message).toContain("docs/overview.md");
    expect(message).toContain("Quick Start");
  });

  it("describes reload semantics for reload-project intents", () => {
    const intent: PendingWorkbenchIntent = { type: "reload-project" };

    expect(buildPendingDraftMessage(intent).toLowerCase()).toContain("reload");
  });
});
