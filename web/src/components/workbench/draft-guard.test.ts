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

    expect(message).toBe(
      "你有未保存修改。请先保存或放弃草稿，再打开 docs/overview.md。",
    );
  });

  it("includes the localized section and target path for open-section-file intents", () => {
    const message = buildPendingDraftMessage({
      type: "open-section-file",
      path: "docs/overview.md",
      section: "Purpose",
    });

    expect(message).toBe(
      "你有未保存修改。请先保存或放弃草稿，再打开目标 docs/overview.md。",
    );
  });

  it("describes reload semantics for reload-project intents", () => {
    const intent: PendingWorkbenchIntent = { type: "reload-project" };

    expect(buildPendingDraftMessage(intent)).toBe(
      "你有未保存修改。请先保存或放弃草稿，再重新加载项目。",
    );
  });

  it("describes replacing a conflicted draft with the remote file", () => {
    const message = buildPendingDraftMessage({
      type: "open-section-file",
      path: "purpose.md",
      section: "Purpose",
    });

    expect(message).toBe(
      "你有未保存修改。请先保存或放弃草稿，再打开目标 purpose.md。",
    );
  });

  it("describes showing a missing section file notice without opening the file", () => {
    const message = buildPendingDraftMessage({
      type: "show-missing-section-file",
      path: "schema.md",
      section: "Schema",
      title: "Schema file unavailable",
      message: "schema.md is not available for this project.",
    });

    expect(message).toBe(
      "你有未保存修改。请先保存或放弃草稿，再打开结构。schema.md 不可用。",
    );
  });
});
