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
      section: "Purpose",
    });

    expect(message).toContain("docs/overview.md");
    expect(message).toContain("Purpose");
  });

  it("describes reload semantics for reload-project intents", () => {
    const intent: PendingWorkbenchIntent = { type: "reload-project" };

    expect(buildPendingDraftMessage(intent).toLowerCase()).toContain("reload");
  });

  it("describes replacing a conflicted draft with the remote file", () => {
    const message = buildPendingDraftMessage({
      type: "open-section-file",
      path: "purpose.md",
      section: "Purpose",
    });

    expect(message).toContain("Save or discard");
    expect(message).toContain("purpose.md");
  });

  it("describes showing a missing section file notice without opening the file", () => {
    const message = buildPendingDraftMessage({
      type: "show-missing-section-file",
      path: "schema.md",
      section: "Schema",
      title: "Schema file unavailable",
      message: "schema.md is not available for this project.",
    });

    expect(message).toContain("Save or discard");
    expect(message).toContain("Schema");
    expect(message).toContain("schema.md");
  });
});
