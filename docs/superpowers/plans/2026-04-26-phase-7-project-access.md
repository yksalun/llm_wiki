# 阶段 7 项目访问权限基础层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为当前单用户自部署工作台新增全局项目访问模式，让部署者可以把项目切换为只读，并由服务端强制禁止写入。

**Architecture:** 新增 `project-access` 服务端模块解析 `LLM_WIKI_PROJECT_ACCESS_MODE`，并提供 access policy、写权限断言和 file read result 转换。项目详情 API 返回 access policy；file route 在 GET 时应用只读转换，在 PUT 时强制写权限。前端工作台只展示 access mode，文件是否可编辑继续由 file route 的 `mode/editable` 驱动。

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, existing AppError / route helpers / workbench components.

---

## 文件结构

- Modify: `web/src/lib/types.ts`  
  新增 `ProjectAccessMode`、`ProjectAccessPolicy`，并让 `ProjectDetail` 暴露 `access`。
- Create: `web/src/lib/server/project-access.ts`  
  解析环境变量、生成 policy、断言写权限、把 editable file 转成 read-only preview。
- Create: `web/src/lib/server/__tests__/project-access.test.ts`  
  覆盖默认模式、read-only、无效配置、写权限拒绝、file read result 转换。
- Modify: `web/src/app/api/projects/[projectId]/route.ts`  
  在项目详情响应中加入 access policy。
- Modify: `web/src/app/api/projects/[projectId]/file/route.ts`  
  GET 应用 read-only file 转换；PUT 在 read-only 模式下返回 403。
- Modify: `web/src/app/api/projects/__tests__/route.test.ts`  
  断言 project detail 返回 access policy。
- Modify: `web/src/app/api/projects/[projectId]/file/__tests__/route.test.ts`  
  覆盖 read-only GET 和 PUT。
- Modify: `web/src/components/workbench/project-workbench.tsx`  
  在 Workbench State 和 Project Info 中展示 access mode / write access。
- Modify: `web/src/components/workbench/project-workbench.test.tsx`  
  mock detail 增加 access policy，覆盖 read-only access mode 展示。
- Modify: `web/docs/web-roadmap-next-phases.md`  
  阶段完成后标记 Phase 7。

---

### Task 1: 共享类型与 project access 服务

**Files:**
- Modify: `web/src/lib/types.ts`
- Create: `web/src/lib/server/project-access.ts`
- Create: `web/src/lib/server/__tests__/project-access.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `web/src/lib/server/__tests__/project-access.test.ts`：

```ts
import { describe, expect, it } from "vitest";

import type { FileReadResult } from "@/lib/types";

import {
  applyProjectAccessToFile,
  getProjectAccessPolicyFromEnv,
  requireProjectWriteAccess,
} from "../project-access";

describe("project access policy", () => {
  it("defaults to read-write access", () => {
    expect(getProjectAccessPolicyFromEnv({})).toEqual({
      mode: "read-write",
      canRead: true,
      canWrite: true,
    });
  });

  it("reads read-only access from the environment", () => {
    expect(
      getProjectAccessPolicyFromEnv({
        LLM_WIKI_PROJECT_ACCESS_MODE: "read-only",
      }),
    ).toEqual({
      mode: "read-only",
      canRead: true,
      canWrite: false,
    });
  });

  it("rejects invalid project access modes", () => {
    expect(() =>
      getProjectAccessPolicyFromEnv({
        LLM_WIKI_PROJECT_ACCESS_MODE: "locked",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "PROJECT_ACCESS_MODE_INVALID",
        status: 500,
      }),
    );
  });

  it("rejects writes when access is read-only", () => {
    expect(() =>
      requireProjectWriteAccess({
        mode: "read-only",
        canRead: true,
        canWrite: false,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "PROJECT_ACCESS_READ_ONLY",
        status: 403,
      }),
    );
  });

  it("converts editable file results to read-only preview results", () => {
    const file: FileReadResult = {
      relativePath: "wiki/index.md",
      mode: "editable",
      content: "# Home\n",
      editable: true,
      size: 7,
      lastModified: "2026-04-26T00:00:00.000Z",
      metadata: {},
    };

    expect(
      applyProjectAccessToFile(file, {
        mode: "read-only",
        canRead: true,
        canWrite: false,
      }),
    ).toEqual({
      ...file,
      mode: "preview",
      editable: false,
      metadata: {
        accessMode: "read-only",
      },
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm run test -- src/lib/server/__tests__/project-access.test.ts
```

Expected: 失败，原因是 `project-access` 模块不存在，access 类型也不存在。

- [ ] **Step 3: 增加共享类型**

在 `web/src/lib/types.ts` 的 project 类型附近新增：

```ts
export type ProjectAccessMode = "read-write" | "read-only";

export interface ProjectAccessPolicy {
  mode: ProjectAccessMode;
  canRead: true;
  canWrite: boolean;
}
```

把 `ProjectDetail` 改为：

```ts
export interface ProjectDetail extends ProjectSummary {
  sections: WorkbenchSection[];
  rootPathHint: string | null;
  access: ProjectAccessPolicy;
}
```

- [ ] **Step 4: 实现 project access 服务**

创建 `web/src/lib/server/project-access.ts`：

```ts
import type { FileReadResult, ProjectAccessPolicy } from "@/lib/types";

import { AppError } from "./app-error";

const PROJECT_ACCESS_MODE_ENV_KEY = "LLM_WIKI_PROJECT_ACCESS_MODE";

type EnvironmentLike = Readonly<Record<string, string | undefined>>;

export function getProjectAccessPolicyFromEnv(
  env: EnvironmentLike = process.env,
): ProjectAccessPolicy {
  const mode = env[PROJECT_ACCESS_MODE_ENV_KEY]?.trim() || "read-write";

  if (mode === "read-write") {
    return {
      mode,
      canRead: true,
      canWrite: true,
    };
  }

  if (mode === "read-only") {
    return {
      mode,
      canRead: true,
      canWrite: false,
    };
  }

  throw new AppError(
    "PROJECT_ACCESS_MODE_INVALID",
    500,
    "Server project access mode must be read-write or read-only.",
  );
}

export function requireProjectWriteAccess(policy: ProjectAccessPolicy): void {
  if (policy.canWrite) {
    return;
  }

  throw new AppError(
    "PROJECT_ACCESS_READ_ONLY",
    403,
    "This project is currently opened in read-only mode.",
  );
}

export function applyProjectAccessToFile(
  file: FileReadResult,
  policy: ProjectAccessPolicy,
): FileReadResult {
  if (policy.canWrite || !file.editable) {
    return file;
  }

  return {
    ...file,
    mode: "preview",
    editable: false,
    metadata: {
      ...file.metadata,
      accessMode: "read-only",
    },
  };
}
```

- [ ] **Step 5: 验证并提交**

Run:

```bash
npm run test -- src/lib/server/__tests__/project-access.test.ts
npm run typecheck
```

Commit:

```bash
git add web/src/lib/types.ts web/src/lib/server/project-access.ts web/src/lib/server/__tests__/project-access.test.ts
git commit -m "feat: add project access policy"
```

---

### Task 2: API route 权限集成

**Files:**
- Modify: `web/src/app/api/projects/[projectId]/route.ts`
- Modify: `web/src/app/api/projects/[projectId]/file/route.ts`
- Modify: `web/src/app/api/projects/__tests__/route.test.ts`
- Modify: `web/src/app/api/projects/[projectId]/file/__tests__/route.test.ts`

- [ ] **Step 1: 写失败测试**

在 `web/src/app/api/projects/__tests__/route.test.ts` 的 project detail 断言中新增：

```ts
access: {
  mode: "read-write",
  canRead: true,
  canWrite: true,
},
```

在 `web/src/app/api/projects/[projectId]/file/__tests__/route.test.ts` 新增两个测试：

```ts
it("GET returns editable markdown as preview when project access is read-only", async () => {
  const { projectId } = await createProjectContext("read-only-read");
  process.env.LLM_WIKI_PROJECT_ACCESS_MODE = "read-only";

  const { GET } = await import("../route");
  const response = await GET(
    new Request(`http://localhost/api/projects/${projectId}/file?path=purpose.md`),
    {
      params: Promise.resolve({ projectId }),
    },
  );
  const payload = (await response.json()) as {
    mode: string;
    editable: boolean;
    content: string | null;
    metadata: Record<string, string>;
  };

  expect(response.status).toBe(200);
  expect(payload.mode).toBe("preview");
  expect(payload.editable).toBe(false);
  expect(payload.content).toContain("Demo project");
  expect(payload.metadata.accessMode).toBe("read-only");
});

it("PUT returns 403 and leaves content unchanged when project access is read-only", async () => {
  const { projectId } = await createProjectContext("read-only-write");
  process.env.LLM_WIKI_PROJECT_ACCESS_MODE = "read-only";

  const { GET, PUT } = await import("../route");
  const readResponse = await GET(
    new Request(`http://localhost/api/projects/${projectId}/file?path=purpose.md`),
    {
      params: Promise.resolve({ projectId }),
    },
  );
  const readPayload = (await readResponse.json()) as {
    lastModified: string | null;
  };

  const response = await PUT(
    new Request(`http://localhost/api/projects/${projectId}/file`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        relativePath: "purpose.md",
        content: "# Purpose\n\nShould not write.\n",
        lastModified: readPayload.lastModified,
      }),
    }),
    {
      params: Promise.resolve({ projectId }),
    },
  );
  const payload = (await response.json()) as {
    error: { code: string };
  };
  const verifyResponse = await GET(
    new Request(`http://localhost/api/projects/${projectId}/file?path=purpose.md`),
    {
      params: Promise.resolve({ projectId }),
    },
  );
  const verifyPayload = (await verifyResponse.json()) as {
    content: string | null;
  };

  expect(response.status).toBe(403);
  expect(payload.error.code).toBe("PROJECT_ACCESS_READ_ONLY");
  expect(verifyPayload.content).toBe("# Purpose\n\nDemo project.\n");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm run test -- src/app/api/projects/__tests__/route.test.ts "src/app/api/projects/[projectId]/file/__tests__/route.test.ts"
```

Expected: 失败，原因是 project detail 没有 `access`，file route 尚未应用 read-only policy。

- [ ] **Step 3: 实现 project detail access**

在 `web/src/app/api/projects/[projectId]/route.ts` import：

```ts
import { getProjectAccessPolicyFromEnv } from "@/lib/server/project-access";
```

在 `GET` 中解析 project 后加入：

```ts
const access = getProjectAccessPolicyFromEnv();
```

并在 `okJson` payload 中加入：

```ts
access,
```

- [ ] **Step 4: 实现 file route access**

在 `web/src/app/api/projects/[projectId]/file/route.ts` import：

```ts
import {
  applyProjectAccessToFile,
  getProjectAccessPolicyFromEnv,
  requireProjectWriteAccess,
} from "@/lib/server/project-access";
```

在 `GET` 中改为：

```ts
const policy = getProjectAccessPolicyFromEnv();
const file = await readProjectFile(project.rootDir, relativePath);

return okJson(applyProjectAccessToFile(file, policy));
```

在 `PUT` 中解析 project 后、调用 `writeProjectFile` 前加入：

```ts
const policy = getProjectAccessPolicyFromEnv();
requireProjectWriteAccess(policy);
```

- [ ] **Step 5: 验证并提交**

Run:

```bash
npm run test -- src/app/api/projects/__tests__/route.test.ts "src/app/api/projects/[projectId]/file/__tests__/route.test.ts" src/lib/server/__tests__/project-access.test.ts
npm run typecheck
```

Commit:

```bash
git add "web/src/app/api/projects/[projectId]/route.ts" "web/src/app/api/projects/[projectId]/file/route.ts" web/src/app/api/projects/__tests__/route.test.ts "web/src/app/api/projects/[projectId]/file/__tests__/route.test.ts"
git commit -m "feat: enforce project read-only access"
```

---

### Task 3: Workbench access 展示

**Files:**
- Modify: `web/src/components/workbench/project-workbench.tsx`
- Modify: `web/src/components/workbench/project-workbench.test.tsx`

- [ ] **Step 1: 写失败测试**

在 `project-workbench.test.tsx` 的 mocked `fetchProjectDetail` 返回值中加入：

```ts
access: {
  mode: "read-write",
  canRead: true,
  canWrite: true,
},
```

新增测试：

```ts
it("shows read-only project access in the workbench", async () => {
  const { fetchProjectDetail } = await import("@/lib/client/api");
  vi.mocked(fetchProjectDetail).mockResolvedValueOnce({
    id: "project-1",
    name: "Project One",
    status: "ready",
    hasPurpose: true,
    hasSchema: true,
    hasWikiDirectory: true,
    hasRawSourcesDirectory: false,
    updatedAt: null,
    rootPathHint: null,
    sections: ["Overview", "Ask", "Insights", "Files", "Purpose", "Schema", "Project Info"],
    access: {
      mode: "read-only",
      canRead: true,
      canWrite: false,
    },
  });

  renderProjectWorkbench();

  await waitForText("read-only");
  await clickButton("Project Info");

  expect(container?.textContent).toContain("Access mode");
  expect(container?.textContent).toContain("Write access");
  expect(container?.textContent).toContain("No");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm run test -- src/components/workbench/project-workbench.test.tsx
```

Expected: 失败，原因是 Workbench 尚未展示 access mode / write access。

- [ ] **Step 3: 更新 Workbench 展示**

在 `WorkbenchAside` ready 状态区域加入一个 access badge 或文本：

```tsx
{loadState.status === "ready" ? (
  <p className="text-xs text-muted-foreground">
    Access: {loadState.detail.access.mode}
  </p>
) : null}
```

在 `ProjectInfoPanel` 中加入：

```tsx
<InfoBlock label="Access mode" value={detail.access.mode} />
<InfoBlock label="Write access" value={detail.access.canWrite ? "Yes" : "No"} />
```

- [ ] **Step 4: 验证并提交**

Run:

```bash
npm run test -- src/components/workbench/project-workbench.test.tsx src/components/workbench/file-panel.test.tsx
npm run typecheck
```

Commit:

```bash
git add web/src/components/workbench/project-workbench.tsx web/src/components/workbench/project-workbench.test.tsx
git commit -m "feat: show project access in workbench"
```

---

### Task 4: 全量验证与 roadmap 更新

**Files:**
- Modify: `web/docs/web-roadmap-next-phases.md`

- [ ] **Step 1: 全量验证**

Run:

```bash
npm run test
npm run typecheck
npm run lint
```

Expected:

- test 全部通过。
- typecheck 通过。
- lint exit 0；允许既有 5 个 warning，但不能新增 error。

- [ ] **Step 2: 更新 roadmap**

在 `web/docs/web-roadmap-next-phases.md` 的 `### 10.3 阶段 7：多用户 / 权限 / 协作` 下加入：

```md
> 状态：已完成。阶段 7 已按 [spec](../../docs/superpowers/specs/2026-04-26-phase-7-project-access-design.md) 和 [implementation plan](../../docs/superpowers/plans/2026-04-26-phase-7-project-access.md) 落地，采用符合当前单用户自部署前提的权限基础层方案，覆盖 read-write / read-only 项目访问模式、服务端写权限闸门、只读文件预览、工作台访问模式展示和关键测试。
```

- [ ] **Step 3: 检查 roadmap**

Run:

```bash
rg -n "阶段 7|phase-7-project-access|状态：已完成" web/docs/web-roadmap-next-phases.md
```

Expected: 输出包含阶段 7 状态、spec 链接和 plan 链接。

- [ ] **Step 4: 提交**

Run:

```bash
git add web/docs/web-roadmap-next-phases.md
git commit -m "docs: mark phase 7 roadmap complete"
```

---

## 执行顺序

1. Task 1 建立 access policy 类型和服务端模块。
2. Task 2 在项目详情和 file route 接入权限。
3. Task 3 在 Workbench 展示访问模式。
4. Task 4 全量验证并更新 roadmap。

## 完成定义

- `LLM_WIKI_PROJECT_ACCESS_MODE` 支持 `read-write` / `read-only`。
- 默认未配置时现有行为不变。
- 项目详情 API 返回 `access`。
- read-only 模式下 GET file 对 editable Markdown 返回 preview / non-editable。
- read-only 模式下 PUT file 返回 403 `PROJECT_ACCESS_READ_ONLY`。
- Workbench 展示 access mode / write access。
- 不引入用户账号、session、多用户数据库或协作机制。
- `npm run test`、`npm run typecheck`、`npm run lint` 已运行并记录结果。
- roadmap 已标记阶段 7 完成。
