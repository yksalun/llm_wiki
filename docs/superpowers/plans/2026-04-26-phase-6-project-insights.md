# 阶段 6 项目洞察基础层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Web 工作台新增当前项目范围内的 `Insights` section，展示确定性文件关系图、结构发现和研究问题建议。

**Architecture:** 服务端新增 `project-insights` 按需扫描当前项目，不持久化结果；API route 解析当前 `projectId` 后返回洞察响应；前端新增 client API 和 `ProjectInsightsPanel`，Workbench 把 `Insights` 插入 `Ask` 与 `Files` 之间，source 打开复用现有 draft guard。

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, Node fs/path, existing route helpers, existing shadcn/base-ui components, lucide-react.

---

## 文件结构

- Modify: `web/src/lib/types.ts`  
  新增 `Insights` section 和项目洞察响应类型。
- Create: `web/src/lib/server/project-insights.ts`  
  扫描项目文件、解析 Markdown 链接、生成 graph / findings / research prompts。
- Create: `web/src/lib/server/__tests__/project-insights.test.ts`  
  覆盖 graph、broken link、orphan、无边关系和 `.llm-wiki` 跳过。
- Create: `web/src/app/api/projects/[projectId]/insights/route.ts`  
  新增 insights API route。
- Create: `web/src/app/api/projects/[projectId]/insights/__tests__/route.test.ts`  
  覆盖成功和 unknown project。
- Modify: `web/src/lib/client/api.ts`  
  新增 `fetchProjectInsights()`。
- Create: `web/src/components/workbench/project-insights-panel.tsx`  
  新增 Insights 面板。
- Create: `web/src/components/workbench/project-insights-panel.test.tsx`  
  覆盖 loading/success/error retry/source open。
- Modify: `web/src/lib/server/project-registry.ts`  
  把 `Insights` 加入 sections。
- Modify: `web/src/lib/server/__tests__/project-registry.test.ts`  
  更新 sections 断言。
- Modify: `web/src/app/api/projects/__tests__/route.test.ts`  
  更新项目 detail sections 断言。
- Modify: `web/src/components/workbench/project-workbench.tsx`  
  渲染 `ProjectInsightsPanel` 并通过 `requestOpenRelativePath(relativePath, "Files")` 打开来源。
- Modify: `web/src/components/workbench/project-workbench.test.tsx`  
  补充 Insights source open + dirty draft guard 场景。
- Modify: `web/docs/web-roadmap-next-phases.md`  
  阶段完成后标记 Phase 6。

---

### Task 1: 共享类型与 section 枚举

**Files:**
- Modify: `web/src/lib/types.ts`
- Test: `web/src/lib/server/__tests__/project-registry.test.ts`

- [ ] **Step 1: 写失败测试**

先把 `project-registry.test.ts` 中 detail sections 期望改成：

```ts
sections: ["Overview", "Ask", "Insights", "Files", "Purpose", "Schema", "Project Info"],
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm run test -- src/lib/server/__tests__/project-registry.test.ts
```

Expected: 失败，原因是 registry 尚未返回 `Insights`。

- [ ] **Step 3: 增加类型**

在 `web/src/lib/types.ts` 中把 `WorkbenchSection` 改为：

```ts
export type WorkbenchSection =
  | "Overview"
  | "Ask"
  | "Insights"
  | "Files"
  | "Purpose"
  | "Schema"
  | "Project Info";
```

在问答类型之后新增：

```ts
export interface ProjectInsightNode {
  id: string;
  label: string;
  kind: "file";
  relativePath: string;
}

export interface ProjectInsightEdge {
  id: string;
  sourceId: string;
  targetId: string;
  kind: "links-to";
  label: string;
  sourceLineNumber: number;
}

export interface ProjectInsightFinding {
  id: string;
  severity: "info" | "warning" | "risk";
  title: string;
  message: string;
  relativePath?: string;
  lineNumber?: number;
}

export interface ProjectInsightResearchPrompt {
  id: string;
  title: string;
  question: string;
  reason: string;
  sourceIds: string[];
}

export interface ProjectInsightsResponse {
  summary: {
    analyzedFiles: number;
    markdownFiles: number;
    graphNodes: number;
    graphEdges: number;
    findings: number;
    researchPrompts: number;
  };
  graph: {
    nodes: ProjectInsightNode[];
    edges: ProjectInsightEdge[];
  };
  findings: ProjectInsightFinding[];
  researchPrompts: ProjectInsightResearchPrompt[];
}
```

- [ ] **Step 4: 更新 registry sections**

在 `web/src/lib/server/project-registry.ts` 的 `PROJECT_SECTIONS` 中插入 `"Insights"`：

```ts
const PROJECT_SECTIONS: ProjectDetail["sections"] = [
  "Overview",
  "Ask",
  "Insights",
  "Files",
  "Purpose",
  "Schema",
  "Project Info",
];
```

- [ ] **Step 5: 验证并提交**

Run:

```bash
npm run test -- src/lib/server/__tests__/project-registry.test.ts
npm run typecheck
```

Commit:

```bash
git add web/src/lib/types.ts web/src/lib/server/project-registry.ts web/src/lib/server/__tests__/project-registry.test.ts
git commit -m "feat: add project insights types"
```

---

### Task 2: 项目洞察 service

**Files:**
- Create: `web/src/lib/server/project-insights.ts`
- Create: `web/src/lib/server/__tests__/project-insights.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `project-insights.test.ts`，覆盖：

```ts
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildProjectInsights } from "../project-insights";

const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanupTasks.length > 0) {
    const cleanup = cleanupTasks.pop();
    if (cleanup) await cleanup();
  }
});

describe("buildProjectInsights", () => {
  it("builds graph edges from markdown links", async () => {
    const projectRoot = await createProject("graph-links");
    await writeProjectFile(projectRoot, "wiki/index.md", "See [Schema](schema.md).\n");
    await writeProjectFile(projectRoot, "wiki/schema.md", "# Schema\n");

    const response = await buildProjectInsights(projectRoot);

    expect(response.graph.nodes.map((node) => node.relativePath)).toEqual(
      expect.arrayContaining(["wiki/index.md", "wiki/schema.md"]),
    );
    expect(response.graph.edges).toEqual([
      expect.objectContaining({
        sourceId: "file:wiki/index.md",
        targetId: "file:wiki/schema.md",
        kind: "links-to",
        sourceLineNumber: 1,
      }),
    ]);
    expect(response.summary.graphEdges).toBe(1);
  });

  it("reports broken markdown links as risk findings", async () => {
    const projectRoot = await createProject("broken-link");
    await writeProjectFile(projectRoot, "wiki/index.md", "See [Missing](missing.md).\n");

    const response = await buildProjectInsights(projectRoot);

    expect(response.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "risk",
          relativePath: "wiki/index.md",
          lineNumber: 1,
        }),
      ]),
    );
  });

  it("reports orphan wiki pages and suggests research prompts", async () => {
    const projectRoot = await createProject("orphan");
    await writeProjectFile(projectRoot, "wiki/index.md", "# Home\n");
    await writeProjectFile(projectRoot, "wiki/orphan.md", "# Orphan\n");

    const response = await buildProjectInsights(projectRoot);

    expect(response.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warning",
          relativePath: "wiki/orphan.md",
        }),
      ]),
    );
    expect(response.researchPrompts.length).toBeGreaterThan(0);
  });

  it("skips .llm-wiki metadata files", async () => {
    const projectRoot = await createProject("skip-metadata");
    await writeProjectFile(projectRoot, "wiki/index.md", "# Home\n");
    await writeProjectFile(projectRoot, ".llm-wiki/hidden.md", "[Hidden](../wiki/index.md)\n");

    const response = await buildProjectInsights(projectRoot);

    expect(response.graph.nodes.map((node) => node.relativePath)).not.toContain(".llm-wiki/hidden.md");
  });
});

async function createProject(name: string) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "llm-wiki-web-insights-"));
  const projectRoot = path.join(tempRoot, name);
  await fs.mkdir(projectRoot, { recursive: true });
  cleanupTasks.push(() => fs.rm(tempRoot, { recursive: true, force: true }));
  return projectRoot;
}

async function writeProjectFile(projectRoot: string, relativePath: string, content: string) {
  const filePath = path.join(projectRoot, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm run test -- src/lib/server/__tests__/project-insights.test.ts
```

Expected: 失败，原因是 `project-insights` 模块不存在。

- [ ] **Step 3: 实现 service**

创建 `project-insights.ts`，导出：

```ts
export async function buildProjectInsights(projectRoot: string): Promise<ProjectInsightsResponse>
```

实现要点：

- 用 `fs.readdir(..., { withFileTypes: true })` 递归遍历，根目录跳过 `.llm-wiki`。
- 只分析 `isSearchableTextFileExtension(getFileExtension(relativePath))` 的文件。
- 只对 Markdown 文件解析链接。
- 用正则 `/\\[([^\\]]+)\\]\\(([^)]+)\\)/g` 提取链接。
- 忽略外部链接、`mailto:` 和 `#anchor`。
- 用 `path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), hrefWithoutHash))` 规范化相对目标。
- 规范化后若以 `..` 开头或为绝对路径，则生成 risk finding。
- 目标存在则生成 edge；目标不存在则生成 broken link finding。
- wiki 下除 `wiki/index.md` 外无入边 Markdown 文件生成 orphan finding。
- 无任何有效 edge 时生成 info finding。
- research prompts 从 broken links、orphans、无关系边中生成，最多 6 条。

- [ ] **Step 4: 验证并提交**

Run:

```bash
npm run test -- src/lib/server/__tests__/project-insights.test.ts
npm run typecheck
```

Commit:

```bash
git add web/src/lib/server/project-insights.ts web/src/lib/server/__tests__/project-insights.test.ts
git commit -m "feat: add project insights service"
```

---

### Task 3: Insights API route

**Files:**
- Create: `web/src/app/api/projects/[projectId]/insights/route.ts`
- Create: `web/src/app/api/projects/[projectId]/insights/__tests__/route.test.ts`

- [ ] **Step 1: 写失败测试**

参考 question route tests，创建 route tests 覆盖成功和 unknown project：

- success：fixture 中写 `wiki/index.md` 和链接目标，GET 返回 graph edges。
- unknown project：返回 404 `PROJECT_NOT_FOUND`。

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm run test -- "src/app/api/projects/[projectId]/insights/__tests__/route.test.ts"
```

Expected: 失败，route 不存在。

- [ ] **Step 3: 实现 route**

创建：

```ts
import { getProjectRootsFromEnv } from "@/lib/server/env";
import { buildProjectInsights } from "@/lib/server/project-insights";
import { resolveProjectById } from "@/lib/server/project-registry";
import { errorJson, okJson } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

export async function GET(_request: Request, context: ProjectRouteContext) {
  try {
    const roots = getProjectRootsFromEnv();
    const { projectId } = await context.params;
    const project = await resolveProjectById(roots, projectId);
    const response = await buildProjectInsights(project.rootDir);
    return okJson(response);
  } catch (error) {
    return errorJson(error);
  }
}
```

- [ ] **Step 4: 验证并提交**

Run:

```bash
npm run test -- "src/app/api/projects/[projectId]/insights/__tests__/route.test.ts" src/lib/server/__tests__/project-insights.test.ts
npm run typecheck
```

Commit:

```bash
git add "web/src/app/api/projects/[projectId]/insights/route.ts" "web/src/app/api/projects/[projectId]/insights/__tests__/route.test.ts"
git commit -m "feat: add project insights route"
```

---

### Task 4: Client API 与 Insights 面板

**Files:**
- Modify: `web/src/lib/client/api.ts`
- Create: `web/src/components/workbench/project-insights-panel.tsx`
- Create: `web/src/components/workbench/project-insights-panel.test.tsx`

- [ ] **Step 1: 写失败测试**

创建组件测试，覆盖：

- 初始 loading。
- success 渲染 summary、edge、finding、research prompt。
- `Open source` 调用 `onOpenFile(relativePath)`。
- error 显示错误和 Retry，点击 Retry 重新请求。

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm run test -- src/components/workbench/project-insights-panel.test.tsx
```

Expected: 失败，组件不存在。

- [ ] **Step 3: 新增 client API**

在 `api.ts` 新增：

```ts
export async function fetchProjectInsights(projectId: string, signal?: AbortSignal) {
  return requestJson<ProjectInsightsResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/insights`,
    { method: "GET", cache: "no-store", signal },
  );
}
```

- [ ] **Step 4: 实现组件**

`ProjectInsightsPanel` props：

```ts
interface ProjectInsightsPanelProps {
  projectId: string;
  onOpenFile: (relativePath: string) => void;
  fetchFn?: typeof fetchProjectInsights;
}
```

行为：

- mount 和 `projectId` 变化时加载。
- 使用 AbortController。
- ready 时渲染 `Project insights`、summary、graph edges、findings、research prompts。
- error 时渲染 `Insights failed` 和 `Retry`。
- source 打开按钮文案 `Open source`。

- [ ] **Step 5: 验证并提交**

Run:

```bash
npm run test -- src/components/workbench/project-insights-panel.test.tsx
npm run typecheck
```

Commit:

```bash
git add web/src/lib/client/api.ts web/src/components/workbench/project-insights-panel.tsx web/src/components/workbench/project-insights-panel.test.tsx
git commit -m "feat: add project insights panel"
```

---

### Task 5: Workbench 集成

**Files:**
- Modify: `web/src/components/workbench/project-workbench.tsx`
- Modify: `web/src/components/workbench/project-workbench.test.tsx`
- Modify: `web/src/app/api/projects/__tests__/route.test.ts`
- Modify: `web/src/lib/server/__tests__/project-registry.test.ts`

- [ ] **Step 1: 写失败测试**

更新 route/project registry sections 断言为：

```ts
["Overview", "Ask", "Insights", "Files", "Purpose", "Schema", "Project Info"]
```

在 `project-workbench.test.tsx` mock `ProjectInsightsPanel`，补充 Insights source open + dirty draft guard：

- dirty draft 存在。
- section 为 `Insights`。
- mocked panel 调 `onOpenFile("wiki/schema.md")`。
- 断言 `Unsaved draft` 出现。

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm run test -- src/lib/server/__tests__/project-registry.test.ts src/app/api/projects/__tests__/route.test.ts src/components/workbench/project-workbench.test.tsx
```

Expected: 失败，registry/workbench 尚未集成 `Insights`。

- [ ] **Step 3: 集成 Workbench**

在 `project-workbench.tsx` import：

```ts
import { ProjectInsightsPanel } from "@/components/workbench/project-insights-panel";
```

新增 section 渲染：

```tsx
{section === "Insights" ? (
  <ProjectInsightsPanel
    projectId={projectId}
    onOpenFile={(relativePath) => {
      void requestOpenRelativePath(relativePath, "Files");
    }}
  />
) : null}
```

`handleSectionChange("Insights")` 走默认分支即可，不打开文件树。

- [ ] **Step 4: 验证并提交**

Run:

```bash
npm run test -- src/lib/server/__tests__/project-registry.test.ts src/app/api/projects/__tests__/route.test.ts src/components/workbench/project-workbench.test.tsx src/components/workbench/project-insights-panel.test.tsx src/components/workbench/draft-guard.test.ts
npm run typecheck
```

Commit:

```bash
git add web/src/components/workbench/project-workbench.tsx web/src/components/workbench/project-workbench.test.tsx web/src/app/api/projects/__tests__/route.test.ts web/src/lib/server/__tests__/project-registry.test.ts web/src/lib/server/project-registry.ts
git commit -m "feat: integrate project insights in workbench"
```

---

### Task 6: 文档、roadmap 与全量验证

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

在 `web/docs/web-roadmap-next-phases.md` 的 `### 10.2 阶段 6：图谱 / Review / Deep Research` 下加入：

```md
> 状态：已完成。阶段 6 已按 [spec](../../docs/superpowers/specs/2026-04-26-phase-6-project-insights-design.md) 和 [implementation plan](../../docs/superpowers/plans/2026-04-26-phase-6-project-insights.md) 落地，覆盖项目 Insights 入口、确定性文件关系图、结构发现、研究问题建议、source 打开联动和关键测试。
```

- [ ] **Step 3: 检查 roadmap**

Run:

```bash
rg -n "阶段 6|phase-6-project-insights|状态：已完成" web/docs/web-roadmap-next-phases.md
```

Expected: 输出包含阶段 6 状态、spec 链接、plan 链接。

- [ ] **Step 4: 提交**

Run:

```bash
git add web/docs/web-roadmap-next-phases.md
git commit -m "docs: mark phase 6 roadmap complete"
```

---

## 执行顺序

1. Task 1 先完成共享类型与 section。
2. Task 2 建立 service。
3. Task 3 建立 API route。
4. Task 4 建立 client API 和 panel。
5. Task 5 接入 Workbench。
6. Task 6 完成文档和全量验证。

## 完成定义

- Phase 6 spec 验收标准全部满足。
- `Insights` section 可从工作台访问。
- graph / findings / research prompts 限定当前项目。
- source 打开走 `requestOpenRelativePath(relativePath, "Files")`。
- 不引入持久化图谱、向量索引、后台任务或 agent。
- `npm run test`、`npm run typecheck`、`npm run lint` 已运行并记录结果。
- roadmap 已标记阶段 6 完成。
