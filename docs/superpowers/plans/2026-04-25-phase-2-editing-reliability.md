# 阶段 2 编辑可靠性补强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Web 工作台的手动编辑链路补强到不会无提示丢草稿，并能清楚区分保存成功、保存失败、保存冲突和刷新失败。

**Architecture:** 保留现有 Next API、Zustand store、`ProjectWorkbench` 编排和 `FilePanel` 展示边界。服务端只补强错误 payload 与 JSON 解析语义；客户端新增明确的编辑会话状态、草稿保护 guard、beforeunload 保护和冲突恢复入口。

**Tech Stack:** Next.js 16 App Router, React 19, Zustand, TypeScript, Vitest, shadcn/base-ui components.

---

## 文件结构

- Modify: `web/src/lib/server/app-error.ts`  
  为 `AppError` 增加可选 `details`，让 API 错误能返回冲突恢复信息。
- Modify: `web/src/lib/server/route-helpers.ts`  
  将 `details` 序列化到错误响应。
- Modify: `web/src/lib/server/file-writer.ts`  
  在 `FILE_WRITE_CONFLICT` 中返回 `relativePath` 与 `currentLastModified`。
- Modify: `web/src/app/api/projects/[projectId]/file/route.ts`  
  把 malformed JSON 映射为 400 `INVALID_REQUEST_BODY`。
- Modify: `web/src/app/api/projects/[projectId]/file/__tests__/route.test.ts`  
  覆盖 malformed JSON 与冲突 details。
- Modify: `web/src/lib/client/api.ts`  
  让 `ClientApiError` 暴露可选 `details`。
- Modify: `web/src/stores/workbench-store.ts`  
  扩展编辑会话状态和保存结果 action。
- Modify: `web/src/stores/workbench-store.test.ts`  
  覆盖保存成功、失败、冲突和 reset 状态。
- Create: `web/src/components/workbench/draft-guard.ts`  
  放置纯函数 guard，避免保护判断散落在组件里。
- Create: `web/src/components/workbench/draft-guard.test.ts`  
  覆盖 dirty/saving/file mode 与 pending intent 文案。
- Modify: `web/src/components/workbench/project-workbench.tsx`  
  接入 pending intent、保存后继续、冲突分支、beforeunload。
- Modify: `web/src/components/workbench/file-panel.tsx`  
  展示成功、失败、冲突、刷新失败和草稿保护操作。
- Modify: `web/docs/web-roadmap-next-phases.md`  
  阶段完成后标记阶段 2 已完成，并链接 spec/plan。

---

### Task 1: 服务端错误语义和冲突恢复信息

**Files:**
- Modify: `web/src/lib/server/app-error.ts`
- Modify: `web/src/lib/server/route-helpers.ts`
- Modify: `web/src/lib/server/file-writer.ts`
- Modify: `web/src/app/api/projects/[projectId]/file/route.ts`
- Test: `web/src/app/api/projects/[projectId]/file/__tests__/route.test.ts`

- [ ] **Step 1: 写失败测试**

在 `web/src/app/api/projects/[projectId]/file/__tests__/route.test.ts` 追加两个测试：

```ts
  it("PUT returns 400 when the request body is malformed JSON", async () => {
    const { projectId } = await createProjectContext("write-malformed-json");

    const { PUT } = await import("../route");
    const response = await PUT(
      new Request(`http://localhost/api/projects/${projectId}/file`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: "{",
      }),
      {
        params: Promise.resolve({ projectId }),
      },
    );
    const payload = (await response.json()) as {
      error: {
        code: string;
        message: string;
      };
    };

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("INVALID_REQUEST_BODY");
    expect(payload.error.message).toBe("Request body must be valid JSON.");
  });

  it("PUT returns conflict details when the file changed since it was read", async () => {
    const { projectId } = await createProjectContext("write-conflict-detail");

    const { PUT } = await import("../route");
    const response = await PUT(
      new Request(`http://localhost/api/projects/${projectId}/file`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          relativePath: "purpose.md",
          content: "# Purpose\n\nStale write.\n",
          lastModified: "2020-01-01T00:00:00.000Z",
        }),
      }),
      {
        params: Promise.resolve({ projectId }),
      },
    );
    const payload = (await response.json()) as {
      error: {
        code: string;
        details: {
          relativePath: string;
          currentLastModified: string | null;
        };
      };
    };

    expect(response.status).toBe(409);
    expect(payload.error.code).toBe("FILE_WRITE_CONFLICT");
    expect(payload.error.details.relativePath).toBe("purpose.md");
    expect(payload.error.details.currentLastModified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm run test -- "src/app/api/projects/[projectId]/file/__tests__/route.test.ts"
```

Expected: 新增 malformed JSON 或 conflict details 断言失败。

- [ ] **Step 3: 实现 `AppError.details`**

将 `web/src/lib/server/app-error.ts` 改成：

```ts
export type AppErrorDetails = Record<string, string | number | boolean | null>;

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly publicMessage: string;
  readonly details?: AppErrorDetails;

  constructor(
    code: string,
    status: number,
    publicMessage: string,
    options?: ErrorOptions & { details?: AppErrorDetails },
  ) {
    super(publicMessage, options);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.publicMessage = publicMessage;
    this.details = options?.details;
  }
}
```

- [ ] **Step 4: 序列化错误 details**

在 `web/src/lib/server/route-helpers.ts` 的 `errorJson` 中构造 payload：

```ts
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.publicMessage,
          ...(error.details ? { details: error.details } : {}),
        },
      },
      { status: error.status },
    );
```

- [ ] **Step 5: 给冲突错误增加 details**

在 `web/src/lib/server/file-writer.ts` 中替换冲突抛错：

```ts
    if (request.lastModified !== currentLastModified) {
      throw new AppError("FILE_WRITE_CONFLICT", 409, "File changed since it was last read.", {
        details: {
          relativePath: normalizedPath,
          currentLastModified,
        },
      });
    }
```

- [ ] **Step 6: 捕获 malformed JSON**

在 `web/src/app/api/projects/[projectId]/file/route.ts` 中新增 helper：

```ts
async function parseJsonRequestBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (error) {
    throw new AppError("INVALID_REQUEST_BODY", 400, "Request body must be valid JSON.", {
      cause: error instanceof Error ? error : undefined,
    });
  }
}
```

并将 PUT 内的：

```ts
const payload = validateFileWriteRequest(await request.json());
```

替换为：

```ts
const payload = validateFileWriteRequest(await parseJsonRequestBody(request));
```

- [ ] **Step 7: 运行目标测试**

Run:

```bash
npm run test -- "src/app/api/projects/[projectId]/file/__tests__/route.test.ts"
```

Expected: route 测试通过。

- [ ] **Step 8: 提交**

Run:

```bash
git add web/src/lib/server/app-error.ts web/src/lib/server/route-helpers.ts web/src/lib/server/file-writer.ts "web/src/app/api/projects/[projectId]/file/route.ts" "web/src/app/api/projects/[projectId]/file/__tests__/route.test.ts"
git commit -m "fix: clarify file save conflict responses"
```

Expected: commit 成功。

---

### Task 2: 客户端 API 与 workbench store 保存状态

**Files:**
- Modify: `web/src/lib/client/api.ts`
- Modify: `web/src/stores/workbench-store.ts`
- Test: `web/src/stores/workbench-store.test.ts`

- [ ] **Step 1: 写 store 失败测试**

在 `web/src/stores/workbench-store.test.ts` 追加：

```ts
  it("tracks save success feedback and clears it when a new file opens", () => {
    const store = createWorkbenchStore();

    store.getState().openFile(createFile());
    store.getState().setDraft("# Updated");
    store.getState().markSaveSuccess("2026-04-25T12:00:00.000Z");

    expect(store.getState()).toMatchObject({
      dirty: false,
      saving: false,
      refreshing: false,
      lastSaveStatus: "success",
      lastSavedAt: "2026-04-25T12:00:00.000Z",
      conflict: null,
    });

    store.getState().openFile(createFile({ relativePath: "schema.md", content: "# Schema" }));

    expect(store.getState()).toMatchObject({
      selectedPath: "schema.md",
      lastSaveStatus: "idle",
      lastSavedAt: null,
      conflict: null,
    });
  });

  it("preserves the draft when save fails or conflicts", () => {
    const store = createWorkbenchStore();

    store.getState().openFile(createFile());
    store.getState().setDraft("# Local draft");
    store.getState().markSaveFailed();

    expect(store.getState()).toMatchObject({
      draft: "# Local draft",
      dirty: true,
      saving: false,
      lastSaveStatus: "failed",
    });

    store.getState().markSaveConflict({
      relativePath: "purpose.md",
      message: "File changed since it was last read.",
      currentLastModified: "2026-04-25T13:00:00.000Z",
    });

    expect(store.getState()).toMatchObject({
      draft: "# Local draft",
      dirty: true,
      saving: false,
      lastSaveStatus: "conflict",
      conflict: {
        relativePath: "purpose.md",
        currentLastModified: "2026-04-25T13:00:00.000Z",
      },
    });
  });

  it("clears extended save state on reset and clearFile", () => {
    const store = createWorkbenchStore();

    store.getState().openFile(createFile());
    store.getState().setDraft("# Local draft");
    store.getState().setRefreshing(true);
    store.getState().markSaveConflict({
      relativePath: "purpose.md",
      message: "Conflict.",
      currentLastModified: null,
    });
    store.getState().clearFile();

    expect(store.getState()).toMatchObject({
      file: null,
      draft: "",
      dirty: false,
      saving: false,
      refreshing: false,
      lastSaveStatus: "idle",
      lastSavedAt: null,
      conflict: null,
    });
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm run test -- src/stores/workbench-store.test.ts
```

Expected: TypeScript 编译或运行失败，因为新 action 和字段尚不存在。

- [ ] **Step 3: 扩展 `ClientApiError`**

在 `web/src/lib/client/api.ts` 中加入 details 类型：

```ts
interface ApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, string | number | boolean | null>;
  };
}
```

更新 class：

```ts
export class ClientApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: Record<string, string | number | boolean | null>;

  constructor(
    message: string,
    status: number,
    code?: string,
    details?: Record<string, string | number | boolean | null>,
  ) {
    super(message);
    this.name = "ClientApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
```

更新抛错：

```ts
    throw new ClientApiError(
      apiError?.error?.message ?? "Request failed.",
      response.status,
      apiError?.error?.code,
      apiError?.error?.details,
    );
```

- [ ] **Step 4: 扩展 store 类型与初始状态**

在 `web/src/stores/workbench-store.ts` 增加：

```ts
export type SaveStatus = "idle" | "success" | "failed" | "conflict" | "refresh_failed";

export interface FileConflictState {
  relativePath: string;
  message: string;
  currentLastModified: string | null;
}
```

在 `WorkbenchStoreState` 增加：

```ts
  refreshing: boolean;
  lastSaveStatus: SaveStatus;
  lastSavedAt: string | null;
  conflict: FileConflictState | null;
  setRefreshing: (refreshing: boolean) => void;
  markSaveSuccess: (savedAt: string) => void;
  markSaveFailed: () => void;
  markSaveConflict: (conflict: FileConflictState) => void;
  markRefreshFailed: (savedAt: string) => void;
  clearSaveFeedback: () => void;
```

在 `initialWorkbenchState` 增加：

```ts
  refreshing: false,
  lastSaveStatus: "idle" as SaveStatus,
  lastSavedAt: null,
  conflict: null,
```

- [ ] **Step 5: 实现 store action**

在 `createWorkbenchState` 返回对象中加入：

```ts
    setRefreshing: (refreshing) => {
      set({ refreshing });
    },
    markSaveSuccess: (savedAt) => {
      set((state) => ({
        file: state.file
          ? {
              ...state.file,
              content: state.draft,
              size: new TextEncoder().encode(state.draft).length,
            }
          : state.file,
        dirty: false,
        saving: false,
        refreshing: false,
        lastSaveStatus: "success",
        lastSavedAt: savedAt,
        conflict: null,
      }));
    },
    markSaveFailed: () => {
      set({
        saving: false,
        refreshing: false,
        lastSaveStatus: "failed",
      });
    },
    markSaveConflict: (conflict) => {
      set({
        saving: false,
        refreshing: false,
        lastSaveStatus: "conflict",
        conflict,
      });
    },
    markRefreshFailed: (savedAt) => {
      set({
        dirty: false,
        saving: false,
        refreshing: false,
        lastSaveStatus: "refresh_failed",
        lastSavedAt: savedAt,
        conflict: null,
      });
    },
    clearSaveFeedback: () => {
      set({
        lastSaveStatus: "idle",
        lastSavedAt: null,
        conflict: null,
      });
    },
```

同时让 `openFile()`、`clearFile()`、`reset()` 回到初始扩展状态。

- [ ] **Step 6: 运行 store 测试**

Run:

```bash
npm run test -- src/stores/workbench-store.test.ts
```

Expected: store 测试通过。

- [ ] **Step 7: 提交**

Run:

```bash
git add web/src/lib/client/api.ts web/src/stores/workbench-store.ts web/src/stores/workbench-store.test.ts
git commit -m "feat: track workbench save status"
```

Expected: commit 成功。

---

### Task 3: 草稿保护纯函数

**Files:**
- Create: `web/src/components/workbench/draft-guard.ts`
- Create: `web/src/components/workbench/draft-guard.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `web/src/components/workbench/draft-guard.test.ts`：

```ts
import { describe, expect, it } from "vitest";

import {
  buildPendingDraftMessage,
  hasBlockingDraft,
  type PendingWorkbenchIntent,
} from "./draft-guard";

describe("hasBlockingDraft", () => {
  it("blocks only dirty editable drafts that are not saving", () => {
    expect(hasBlockingDraft({ dirty: true, saving: false, fileMode: "editable" })).toBe(true);
    expect(hasBlockingDraft({ dirty: false, saving: false, fileMode: "editable" })).toBe(false);
    expect(hasBlockingDraft({ dirty: true, saving: true, fileMode: "editable" })).toBe(false);
    expect(hasBlockingDraft({ dirty: true, saving: false, fileMode: "preview" })).toBe(false);
    expect(hasBlockingDraft({ dirty: true, saving: false, fileMode: null })).toBe(false);
  });
});

describe("buildPendingDraftMessage", () => {
  it("explains file open, section open, and project reload intents", () => {
    const fileIntent: PendingWorkbenchIntent = {
      kind: "open-file",
      relativePath: "wiki/index.md",
      section: "Files",
    };
    const sectionIntent: PendingWorkbenchIntent = {
      kind: "open-section-file",
      relativePath: "purpose.md",
      section: "Purpose",
    };
    const reloadIntent: PendingWorkbenchIntent = { kind: "reload-project" };

    expect(buildPendingDraftMessage(fileIntent)).toContain("wiki/index.md");
    expect(buildPendingDraftMessage(sectionIntent)).toContain("Purpose");
    expect(buildPendingDraftMessage(reloadIntent)).toContain("reload");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm run test -- src/components/workbench/draft-guard.test.ts
```

Expected: 测试失败，因为 `draft-guard.ts` 尚不存在。

- [ ] **Step 3: 实现 helper**

创建 `web/src/components/workbench/draft-guard.ts`：

```ts
import type { FileViewMode, WorkbenchSection } from "@/lib/types";

export type PendingWorkbenchIntent =
  | {
      kind: "open-file";
      relativePath: string;
      section: WorkbenchSection;
    }
  | {
      kind: "open-section-file";
      relativePath: string;
      section: Extract<WorkbenchSection, "Purpose" | "Schema">;
    }
  | {
      kind: "reload-project";
    };

export function hasBlockingDraft({
  dirty,
  saving,
  fileMode,
}: {
  dirty: boolean;
  saving: boolean;
  fileMode: FileViewMode | null;
}) {
  return dirty && !saving && fileMode === "editable";
}

export function buildPendingDraftMessage(intent: PendingWorkbenchIntent) {
  if (intent.kind === "reload-project") {
    return "The project reload would discard the current unsaved draft unless you save or discard it first.";
  }

  if (intent.kind === "open-section-file") {
    return `${intent.section} opens ${intent.relativePath}, which would replace the current unsaved draft.`;
  }

  return `Opening ${intent.relativePath} would replace the current unsaved draft.`;
}
```

- [ ] **Step 4: 运行测试**

Run:

```bash
npm run test -- src/components/workbench/draft-guard.test.ts
```

Expected: draft guard 测试通过。

- [ ] **Step 5: 提交**

Run:

```bash
git add web/src/components/workbench/draft-guard.ts web/src/components/workbench/draft-guard.test.ts
git commit -m "feat: add workbench draft guard helpers"
```

Expected: commit 成功。

---

### Task 4: 保存结果、冲突处理和 beforeunload 接入

**Files:**
- Modify: `web/src/components/workbench/project-workbench.tsx`

- [ ] **Step 1: 接入 store 新字段**

在 `ProjectWorkbench` 的 `useWorkbenchStore()` 解构中加入：

```ts
    setRefreshing,
    markSaveSuccess,
    markSaveFailed,
    markSaveConflict,
    markRefreshFailed,
    clearSaveFeedback,
```

- [ ] **Step 2: 增加保存 outcome 类型**

在 `LoadState` 附近加入：

```ts
type SaveOutcome = "saved" | "failed" | "conflict" | "aborted" | "skipped";
```

- [ ] **Step 3: 更新 `handleSave` 返回 outcome**

将 `handleSave` 改为 `Promise<SaveOutcome>`。关键分支必须按下面语义返回：

```ts
  const handleSave = useCallback(async (): Promise<SaveOutcome> => {
    if (!file || !dirty) {
      return "skipped";
    }

    cancelSave();

    const abortController = new AbortController();
    const requestId = latestSaveRequestIdRef.current + 1;
    const fileSnapshot = file;
    const draftSnapshot = draft;

    latestSaveRequestIdRef.current = requestId;
    saveAbortRef.current = abortController;
    setSaving(true);
    setRefreshing(false);
    clearSaveFeedback();
    setPanelNotice(null);

    try {
      const writeResult = await saveProjectFile(
        projectId,
        {
          relativePath: fileSnapshot.relativePath,
          content: draftSnapshot,
          lastModified: fileSnapshot.lastModified,
        },
        abortController.signal,
      );

      if (abortController.signal.aborted || requestId !== latestSaveRequestIdRef.current) {
        return "aborted";
      }

      setRefreshing(true);

      try {
        const refreshedFile = await fetchProjectFile(
          projectId,
          fileSnapshot.relativePath,
          abortController.signal,
        );

        if (abortController.signal.aborted || requestId !== latestSaveRequestIdRef.current) {
          return "aborted";
        }

        openFile(refreshedFile);
        markSaveSuccess(new Date().toISOString());
        return "saved";
      } catch (error: unknown) {
        if (abortController.signal.aborted || requestId !== latestSaveRequestIdRef.current) {
          return "aborted";
        }

        openFile({
          ...fileSnapshot,
          content: draftSnapshot,
          lastModified: writeResult.lastModified,
          size: getContentSize(draftSnapshot),
        });
        markRefreshFailed(new Date().toISOString());
        setPanelNotice({
          tone: "warning",
          title: "File saved, refresh failed",
          message:
            error instanceof Error
              ? `${error.message} Local editor state was updated to the saved draft.`
              : "The file was saved, but the workbench could not reload it. Local draft state was preserved.",
        });
        return "saved";
      }
    } catch (error: unknown) {
      if (abortController.signal.aborted || requestId !== latestSaveRequestIdRef.current) {
        return "aborted";
      }

      const message =
        error instanceof ClientApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Unable to save this file.";

      if (error instanceof ClientApiError && error.code === "FILE_WRITE_CONFLICT") {
        markSaveConflict({
          relativePath:
            typeof error.details?.relativePath === "string"
              ? error.details.relativePath
              : fileSnapshot.relativePath,
          message,
          currentLastModified:
            typeof error.details?.currentLastModified === "string"
              ? error.details.currentLastModified
              : null,
        });
        setPanelNotice({
          tone: "warning",
          title: "File changed outside the workbench",
          message: "Your local draft is still here. Reload the remote file only when you are ready to discard this draft.",
        });
        return "conflict";
      }

      markSaveFailed();
      setPanelNotice({
        tone: "error",
        title: "Unable to save file",
        message,
      });
      return "failed";
    } finally {
      if (requestId === latestSaveRequestIdRef.current) {
        setSaving(false);
        setRefreshing(false);
      }

      if (saveAbortRef.current === abortController) {
        saveAbortRef.current = null;
      }
    }
  }, [
    cancelSave,
    clearSaveFeedback,
    dirty,
    draft,
    file,
    markRefreshFailed,
    markSaveConflict,
    markSaveFailed,
    markSaveSuccess,
    openFile,
    projectId,
    setRefreshing,
    setSaving,
  ]);
```

- [ ] **Step 4: 接入 beforeunload**

在组件中加入：

```ts
  const shouldBlockUnload = dirty && !saving && file?.mode === "editable";

  useEffect(() => {
    if (!shouldBlockUnload) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [shouldBlockUnload]);
```

- [ ] **Step 5: 确认保存按钮仍调用 `handleSave`**

保留 `FilePanel` 的保存入口，返回值暂时不需要在按钮点击处处理：

```tsx
                  onSave={() => {
                    void handleSave();
                  }}
```

- [ ] **Step 6: 运行 typecheck**

Run:

```bash
npm run typecheck
```

Expected: typecheck 通过。保存状态已经进入状态层，但完整 UI 展示由 Task 5 接上。

- [ ] **Step 7: 提交**

Run:

```bash
git add web/src/components/workbench/project-workbench.tsx
git commit -m "feat: handle explicit workbench save outcomes"
```

Expected: commit 成功。

---

### Task 5: 草稿保护 UI 与 pending intent 执行

**Files:**
- Modify: `web/src/components/workbench/project-workbench.tsx`
- Modify: `web/src/components/workbench/file-panel.tsx`
- Modify: `web/src/components/workbench/draft-guard.ts`

- [ ] **Step 1: 扩展 `FilePanel` props**

在 `web/src/components/workbench/file-panel.tsx` 中导入类型：

```ts
import type { FileConflictState, SaveStatus } from "@/stores/workbench-store";
```

新增 prompt 类型：

```ts
export interface DraftGuardPrompt {
  message: string;
  saving: boolean;
  onSaveAndContinue: () => void;
  onDiscardAndContinue: () => void;
  onCancel: () => void;
}
```

在 `FilePanelProps` 增加：

```ts
  refreshing: boolean;
  lastSaveStatus: SaveStatus;
  lastSavedAt: string | null;
  conflict: FileConflictState | null;
  draftGuardPrompt: DraftGuardPrompt | null;
  onReloadRemote: () => void;
```

- [ ] **Step 2: 渲染草稿保护提示**

在 `FilePanel` 有文件的返回分支中，`notice` 上方加入：

```tsx
        {draftGuardPrompt ? (
          <Alert className="border-amber-900/15 bg-amber-700/5 text-amber-950">
            <AlertCircle className="size-4" />
            <AlertTitle>Unsaved draft</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>{draftGuardPrompt.message}</p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={draftGuardPrompt.onSaveAndContinue} disabled={draftGuardPrompt.saving}>
                  <Save className="size-4" />
                  {draftGuardPrompt.saving ? "Saving..." : "Save and continue"}
                </Button>
                <Button
                  variant="destructive"
                  onClick={draftGuardPrompt.onDiscardAndContinue}
                  disabled={draftGuardPrompt.saving}
                >
                  Discard draft
                </Button>
                <Button variant="outline" onClick={draftGuardPrompt.onCancel} disabled={draftGuardPrompt.saving}>
                  Cancel
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : null}
```

- [ ] **Step 3: 渲染保存状态反馈**

在 `FileFacts` 下方加入：

```tsx
        <SaveStatusMessage
          status={lastSaveStatus}
          savedAt={lastSavedAt}
          conflict={conflict}
          refreshing={refreshing}
          onReloadRemote={onReloadRemote}
        />
```

在文件底部新增组件：

```tsx
function SaveStatusMessage({
  status,
  savedAt,
  conflict,
  refreshing,
  onReloadRemote,
}: {
  status: SaveStatus;
  savedAt: string | null;
  conflict: FileConflictState | null;
  refreshing: boolean;
  onReloadRemote: () => void;
}) {
  if (refreshing) {
    return <p className="text-sm text-muted-foreground">Refreshing the saved file...</p>;
  }

  if (status === "success" && savedAt) {
    return <p className="text-sm text-emerald-700">Saved at {formatTimestamp(savedAt)}.</p>;
  }

  if (status === "failed") {
    return <p className="text-sm text-destructive">Save failed. Your draft is still local and can be retried.</p>;
  }

  if (status === "refresh_failed" && savedAt) {
    return <p className="text-sm text-amber-800">Saved at {formatTimestamp(savedAt)}, but refresh failed.</p>;
  }

  if (status === "conflict" && conflict) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-900/15 bg-amber-700/5 px-3 py-2 text-sm text-amber-950">
        <span>
          Remote file changed after it was opened. Local draft is preserved.
          {conflict.currentLastModified ? ` Remote timestamp: ${formatTimestamp(conflict.currentLastModified)}.` : ""}
        </span>
        <Button variant="outline" size="sm" onClick={onReloadRemote}>
          Reload remote
        </Button>
      </div>
    );
  }

  return null;
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}
```

- [ ] **Step 4: 在 `ProjectWorkbench` 增加 pending intent 状态**

导入 helper：

```ts
import {
  buildPendingDraftMessage,
  hasBlockingDraft,
  type PendingWorkbenchIntent,
} from "@/components/workbench/draft-guard";
```

新增状态：

```ts
  const [pendingIntent, setPendingIntent] = useState<PendingWorkbenchIntent | null>(null);
```

新增判断：

```ts
  const blocksDraftReplacement = hasBlockingDraft({
    dirty,
    saving,
    fileMode: file?.mode ?? null,
  });
```

- [ ] **Step 5: 拆分执行函数与请求函数**

将现有 `reloadProject` 重命名为 `performReloadProject`。新增用户入口：

```ts
  const requestReloadProject = useCallback(() => {
    const intent: PendingWorkbenchIntent = { kind: "reload-project" };

    if (blocksDraftReplacement) {
      setPendingIntent(intent);
      return;
    }

    performReloadProject();
  }, [blocksDraftReplacement, performReloadProject]);
```

将现有 `openRelativePath` 重命名为 `performOpenRelativePath`。新增用户入口：

```ts
  const requestOpenRelativePath = useCallback(
    (relativePath: string, nextSection: WorkbenchSection = "Files") => {
      const intent: PendingWorkbenchIntent =
        nextSection === "Purpose" || nextSection === "Schema"
          ? { kind: "open-section-file", relativePath, section: nextSection }
          : { kind: "open-file", relativePath, section: nextSection };

      if (blocksDraftReplacement && relativePath !== file?.relativePath) {
        setPendingIntent(intent);
        return;
      }

      void performOpenRelativePath(relativePath, nextSection);
    },
    [blocksDraftReplacement, file?.relativePath, performOpenRelativePath],
  );
```

- [ ] **Step 6: 执行 pending intent**

在 `ProjectWorkbench` 中加入：

```ts
  const executeIntent = useCallback(
    (intent: PendingWorkbenchIntent) => {
      setPendingIntent(null);

      if (intent.kind === "reload-project") {
        performReloadProject();
        return;
      }

      void performOpenRelativePath(intent.relativePath, intent.section);
    },
    [performOpenRelativePath, performReloadProject],
  );

  const handleSaveAndContinue = useCallback(async () => {
    if (!pendingIntent) {
      return;
    }

    const outcome = await handleSave();

    if (outcome === "saved" || outcome === "skipped") {
      executeIntent(pendingIntent);
    }
  }, [executeIntent, handleSave, pendingIntent]);

  const handleDiscardAndContinue = useCallback(() => {
    if (!pendingIntent) {
      return;
    }

    executeIntent(pendingIntent);
  }, [executeIntent, pendingIntent]);

  const handleCancelPendingIntent = useCallback(() => {
    setPendingIntent(null);
  }, []);
```

- [ ] **Step 7: 更新 section、tree、reload 调用点**

替换调用：

```tsx
<WorkbenchAside loadState={loadState} saving={saving} onReload={requestReloadProject} />
```

`Purpose` / `Schema` 分支使用：

```ts
requestOpenRelativePath(purposePath, "Purpose");
```

文件树使用：

```tsx
onOpenFile={(relativePath) => {
  requestOpenRelativePath(relativePath, "Files");
}}
```

初始加载的 `useEffect` 应继续调用 `performReloadProject()`，不能触发草稿 guard。

- [ ] **Step 8: 传递 prompt 和 remote reload**

给 `FilePanel` 传入：

```tsx
                  draftGuardPrompt={
                    pendingIntent
                      ? {
                          message: buildPendingDraftMessage(pendingIntent),
                          saving,
                          onSaveAndContinue: () => {
                            void handleSaveAndContinue();
                          },
                          onDiscardAndContinue: handleDiscardAndContinue,
                          onCancel: handleCancelPendingIntent,
                        }
                      : null
                  }
                  onReloadRemote={() => {
                    if (!file) {
                      return;
                    }

                    setPendingIntent({
                      kind: "open-file",
                      relativePath: file.relativePath,
                      section,
                    });
                  }}
```

- [ ] **Step 9: 运行测试和 typecheck**

Run:

```bash
npm run test -- src/components/workbench/draft-guard.test.ts src/stores/workbench-store.test.ts
npm run typecheck
```

Expected: 测试和 typecheck 通过。

- [ ] **Step 10: 提交**

Run:

```bash
git add web/src/components/workbench/project-workbench.tsx web/src/components/workbench/file-panel.tsx web/src/components/workbench/draft-guard.ts
git commit -m "feat: protect unsaved workbench drafts"
```

Expected: commit 成功。

---

### Task 6: 全量验证与 roadmap 更新

**Files:**
- Modify: `web/docs/web-roadmap-next-phases.md`

- [ ] **Step 1: 运行阶段 2 验证命令**

Run:

```bash
npm run test
npm run typecheck
npm run lint
```

Expected: 三个命令通过。如果 `lint` 发现既有无关问题，只记录具体文件和规则，不修改无关文件。

- [ ] **Step 2: 更新 roadmap**

在 `web/docs/web-roadmap-next-phases.md` 的阶段 2 标题下方加入：

```md
> 状态：已完成。阶段 2 已按 [spec](../../docs/superpowers/specs/2026-04-25-phase-2-editing-reliability-design.md) 和 [implementation plan](../../docs/superpowers/plans/2026-04-25-phase-2-editing-reliability.md) 落地，覆盖未保存草稿保护、保存结果反馈、冲突恢复语义和关键测试。
```

- [ ] **Step 3: 检查 roadmap 链接和状态**

Run:

```bash
rg -n "状态：已完成|phase-2-editing-reliability" web/docs/web-roadmap-next-phases.md
```

Expected: 输出包含阶段 2 完成状态、spec 链接和 plan 链接。

- [ ] **Step 4: 提交**

Run:

```bash
git add web/docs/web-roadmap-next-phases.md
git commit -m "docs: mark phase 2 roadmap complete"
```

Expected: commit 成功。

---

## 执行顺序

1. Task 1 和 Task 3 可以并行执行。
2. Task 2 可以与 Task 1 并行执行，但 Task 4 依赖 Task 2。
3. Task 5 依赖 Task 3 和 Task 4。
4. Task 6 必须最后执行。

## 完成定义

- 阶段 2 spec 中的 7 条验收标准全部满足。
- `npm run test`、`npm run typecheck`、`npm run lint` 已运行并记录结果。
- roadmap 已标记阶段 2 完成。
- 每个任务的 commit 保持聚焦，没有混入阶段 3 或搜索/RAG 相关改动。
