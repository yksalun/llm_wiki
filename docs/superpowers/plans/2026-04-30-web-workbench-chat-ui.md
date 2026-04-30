# Web Workbench Chat UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 精简 Web 项目工作台信息架构，加入可折叠文件树，并把问答区替换为成熟 AI 聊天 UI。

**Architecture:** Web API 仍只代理桌面端问答服务；本轮只调整 Web 前端组件、文案、依赖和测试。工作台 tab 来源在服务端收敛，客户端再用允许列表兜底；问答区用 assistant-ui/Markdown 组件渲染现有桌面端桥接消息和流式状态。

**Tech Stack:** Next 16, React 19, TypeScript, Vitest, shadcn-style local UI components, lucide-react, @assistant-ui/react, @assistant-ui/react-markdown。

---

## 文件结构

- Modify: `web/src/lib/display-labels.ts`  
  负责工作台 section、重任务名称等中文展示文案。
- Modify: `web/src/lib/display-labels.test.ts`  
  覆盖“洞察”改“分析”的展示文案。
- Modify: `web/src/lib/server/project-registry.ts`  
  负责项目详情返回的工作台入口列表。
- Modify: `web/src/lib/server/__tests__/project-registry.test.ts`  
  验证服务端项目详情只返回四个入口。
- Modify: `web/src/components/workbench/project-workbench.tsx`  
  负责项目详情页整体 tab、section 切换和文件打开协调。
- Modify: `web/src/components/workbench/project-workbench.test.tsx`  
  验证目标、结构、项目信息入口消失，以及问答/分析引用仍能打开文件。
- Modify: `web/src/components/workbench/project-overview.tsx`  
  负责把原项目信息内容呈现在概览页。
- Modify: `web/src/components/workbench/project-overview.test.tsx`  
  验证概览页展示项目元信息。
- Modify: `web/src/components/workbench/file-tree.tsx`  
  负责文件树折叠、展开和选中文件父目录自动展开。
- Create: `web/src/components/workbench/file-tree.test.tsx`  
  覆盖文件树折叠行为。
- Modify: `web/src/components/workbench/project-question-panel.tsx`  
  负责问答界面状态、assistant-ui 渲染、历史会话、流式消息和引用打开。
- Modify: `web/src/components/workbench/project-question-panel.test.tsx`  
  覆盖问答历史、流式输出、Markdown 渲染、停止生成和引用打开。
- Modify: `web/package.json`
- Modify: `web/package-lock.json`  
  加入 assistant-ui 和 Markdown 渲染依赖。

## Task 1: 工作台入口和中文文案

**Files:**
- Modify: `web/src/lib/display-labels.ts`
- Modify: `web/src/lib/display-labels.test.ts`
- Modify: `web/src/lib/server/project-registry.ts`
- Modify: `web/src/lib/server/__tests__/project-registry.test.ts`

- [ ] **Step 1: 写失败测试**

在 `web/src/lib/display-labels.test.ts` 里把 section 和重任务断言改为：

```ts
expect(formatWorkbenchSectionLabel("Insights")).toBe("分析");
expect(formatHeavyTaskNameLabel("project-insights")).toBe("项目分析");
```

在 `web/src/lib/server/__tests__/project-registry.test.ts` 的 `resolveProjectById` 详情断言里，把 sections 改为：

```ts
sections: ["Overview", "Ask", "Insights", "Files"],
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd web
npm run test -- src/lib/display-labels.test.ts src/lib/server/__tests__/project-registry.test.ts
```

Expected: FAIL，断言仍收到旧文案或旧 sections。

- [ ] **Step 3: 实现最小修改**

在 `web/src/lib/display-labels.ts` 中更新映射：

```ts
const workbenchSectionLabels = {
  Overview: "概览",
  Ask: "问答",
  Insights: "分析",
  Files: "文件",
  Purpose: "目标",
  Schema: "结构",
  "Project Info": "项目信息",
} satisfies Record<WorkbenchSection, string>;

const heavyTaskNameLabels = {
  "project-search": "项目搜索",
  "project-insights": "项目分析",
} satisfies Record<HeavyTaskName, string>;
```

在 `web/src/lib/server/project-registry.ts` 中更新 `PROJECT_SECTIONS`：

```ts
const PROJECT_SECTIONS: ProjectDetail["sections"] = [
  "Overview",
  "Ask",
  "Insights",
  "Files",
];
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
cd web
npm run test -- src/lib/display-labels.test.ts src/lib/server/__tests__/project-registry.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add web/src/lib/display-labels.ts web/src/lib/display-labels.test.ts web/src/lib/server/project-registry.ts web/src/lib/server/__tests__/project-registry.test.ts
git commit -m "feat(web): simplify workbench sections"
```

## Task 2: 概览页替换为项目信息

**Files:**
- Modify: `web/src/components/workbench/project-overview.tsx`
- Modify: `web/src/components/workbench/project-overview.test.tsx`
- Modify: `web/src/components/workbench/project-workbench.tsx`
- Modify: `web/src/components/workbench/project-workbench.test.tsx`

- [ ] **Step 1: 写失败测试**

在 `web/src/components/workbench/project-overview.test.tsx` 中移除 wiki 快捷入口相关测试，保留一个渲染元信息的测试：

```tsx
const html = renderToStaticMarkup(<ProjectOverview project={project} tree={tree} />);

expect(html).toContain("项目信息");
expect(html).toContain("项目名称");
expect(html).toContain("Project Alpha");
expect(html).toContain("项目编号");
expect(html).toContain("project-alpha");
expect(html).toContain("访问模式");
expect(html).toContain("可读写");
expect(html).toContain("写入权限");
expect(html).toContain("是");
expect(html).toContain("桥接状态");
expect(html).toContain("未配置");
expect(html).toContain("文件树条目");
```

在 `web/src/components/workbench/project-workbench.test.tsx` 中增加入口精简断言：

```ts
await waitForText("概览");
expect(container?.textContent).toContain("问答");
expect(container?.textContent).toContain("分析");
expect(container?.textContent).toContain("文件");
expect(container?.textContent).not.toContain("目标");
expect(container?.textContent).not.toContain("结构");
expect(container?.textContent).not.toContain("项目信息");
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd web
npm run test -- src/components/workbench/project-overview.test.tsx src/components/workbench/project-workbench.test.tsx
```

Expected: FAIL，概览仍渲染旧快捷卡片或工作台仍出现已移除 tab。

- [ ] **Step 3: 实现概览页元信息**

在 `web/src/components/workbench/project-overview.tsx` 中删除快捷 ActionCard、阅读统计和 `onChangeSection`/`onOpenFile` 依赖，保留下面的结构：

```tsx
interface ProjectOverviewProps {
  project: ProjectDetail;
  tree: FileTreeNode[];
}

export function ProjectOverview({ project, tree }: ProjectOverviewProps) {
  return (
    <Card className="border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]/92 shadow-[0_18px_56px_rgba(var(--shadow-panel),0.08)]">
      <CardHeader className="border-b border-[color:var(--paper-border)]">
        <CardTitle>项目信息</CardTitle>
        <CardDescription>已解析项目路由和文件树组成摘要。</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 pt-4 md:grid-cols-2 xl:grid-cols-3">
        <InfoBlock label="项目名称" value={project.name} />
        <InfoBlock label="项目编号" value={project.id} mono />
        <InfoBlock label="状态" value={formatProjectStatusLabel(project.status)} />
        <InfoBlock label="访问模式" value={formatAccessModeLabel(project.access.mode)} />
        <InfoBlock label="写入权限" value={project.access.canWrite ? "是" : "否"} />
        <InfoBlock label="重任务运行时" value={formatHeavyTaskEngineLabel(project.runtime.activeEngine)} />
        <InfoBlock label="桥接状态" value={formatHeavyTaskBridgeStatusLabel(project.runtime.bridgeStatus)} />
        <InfoBlock label="已跟踪重任务" value={project.runtime.heavyTasks.map((task) => formatHeavyTaskNameLabel(task.task)).join("、")} />
        <InfoBlock label="目标文件" value={project.hasPurpose ? "已存在" : "缺失"} />
        <InfoBlock label="结构文件" value={project.hasSchema ? "已存在" : "缺失"} />
        <InfoBlock label="知识库目录" value={project.hasWikiDirectory ? "已存在" : "缺失"} />
        <InfoBlock label="原始资料目录" value={project.hasRawSourcesDirectory ? "已存在" : "缺失"} />
        <InfoBlock label="工作区" value={project.sections.map(formatWorkbenchSectionLabel).join("、")} />
        <InfoBlock label="文件树条目" value={String(collectTreePaths(tree).size)} />
      </CardContent>
    </Card>
  );
}
```

同文件添加 `InfoBlock`、`collectTreePaths`，并从 `@/lib/display-labels` 导入需要的格式化函数。

- [ ] **Step 4: 移除 ProjectWorkbench 中的独立项目信息面板**

在 `web/src/components/workbench/project-workbench.tsx` 中：

- 删除 `ProjectInfoPanel` 和 `InfoBlock` 内联组件。
- 删除 `purposePath`、`schemaPath`、`showMissingSectionFile` 和 `handleSectionChange` 中 `Purpose`/`Schema` 的自动打开逻辑。
- 添加允许列表过滤：

```ts
const visibleSections = useMemo(
  () => loadState.status === "ready" ? getVisibleWorkbenchSections(loadState.detail.sections) : [],
  [loadState],
);

function getVisibleWorkbenchSections(sections: WorkbenchSection[]) {
  const allowed = new Set<WorkbenchSection>(["Overview", "Ask", "Insights", "Files"]);
  return sections.filter((item) => allowed.has(item));
}
```

渲染 tabs 时使用 `visibleSections.map(...)`。概览渲染改为：

```tsx
<ProjectOverview project={loadState.detail} tree={loadState.tree} />
```

文件面板条件改为：

```tsx
{section === "Files" ? (
  ...
) : null}
```

删除 `section === "Project Info"` 分支。

- [ ] **Step 5: 运行测试确认通过**

Run:

```bash
cd web
npm run test -- src/components/workbench/project-overview.test.tsx src/components/workbench/project-workbench.test.tsx
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add web/src/components/workbench/project-overview.tsx web/src/components/workbench/project-overview.test.tsx web/src/components/workbench/project-workbench.tsx web/src/components/workbench/project-workbench.test.tsx
git commit -m "feat(web): move project info into overview"
```

## Task 3: 文件树折叠与自动展开

**Files:**
- Modify: `web/src/components/workbench/file-tree.tsx`
- Create: `web/src/components/workbench/file-tree.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `web/src/components/workbench/file-tree.test.tsx`：

```tsx
// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FileTreeNode } from "@/lib/types";

import { FileTree } from "./file-tree";

const tree: FileTreeNode[] = [
  {
    name: "wiki",
    relativePath: "wiki",
    nodeType: "directory",
    children: [
      { name: "index.md", relativePath: "wiki/index.md", nodeType: "file" },
      {
        name: "nested",
        relativePath: "wiki/nested",
        nodeType: "directory",
        children: [{ name: "deep.md", relativePath: "wiki/nested/deep.md", nodeType: "file" }],
      },
    ],
  },
];

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

describe("FileTree", () => {
  it("collapses directories by default and opens files after expanding", async () => {
    const onOpenFile = vi.fn();
    renderFileTree({ selectedPath: null, onOpenFile });

    expect(container?.textContent).toContain("wiki");
    expect(container?.textContent).not.toContain("index.md");

    await clickButton("wiki");
    expect(container?.textContent).toContain("index.md");

    await clickButton("index.md");
    expect(onOpenFile).toHaveBeenCalledWith("wiki/index.md");
  });

  it("expands ancestor directories when selectedPath points to a nested file", () => {
    renderFileTree({ selectedPath: "wiki/nested/deep.md", onOpenFile: vi.fn() });

    expect(container?.textContent).toContain("wiki");
    expect(container?.textContent).toContain("nested");
    expect(container?.textContent).toContain("deep.md");
  });
});

function renderFileTree({
  selectedPath,
  onOpenFile,
}: {
  selectedPath: string | null;
  onOpenFile: (relativePath: string) => void;
}) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  act(() => {
    root?.render(
      <FileTree
        tree={tree}
        selectedPath={selectedPath}
        loadingPath={null}
        onOpenFile={onOpenFile}
      />,
    );
  });
}

async function clickButton(name: string) {
  await act(async () => {
    const button = Array.from(container?.querySelectorAll("button") ?? []).find(
      (candidate) => candidate.textContent?.trim() === name,
    );
    if (!button) throw new Error(`Expected button ${name}`);
    button.click();
    await Promise.resolve();
  });
}
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd web
npm run test -- src/components/workbench/file-tree.test.tsx
```

Expected: FAIL，目录当前不可点击且默认展开。

- [ ] **Step 3: 实现折叠状态**

在 `web/src/components/workbench/file-tree.tsx` 中：

- 从 React 导入 `useEffect`、`useState`。
- 从 lucide-react 导入 `ChevronDown`、`ChevronRight`、`FolderClosed`。
- 在 `FileTree` 内维护展开集合：

```tsx
const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());

useEffect(() => {
  if (!selectedPath) return;
  const ancestors = findAncestorDirectories(tree, selectedPath);
  if (ancestors.length === 0) return;
  setExpandedPaths((current) => {
    const next = new Set(current);
    for (const ancestor of ancestors) next.add(ancestor);
    return next;
  });
}, [selectedPath, tree]);

function toggleDirectory(relativePath: string) {
  setExpandedPaths((current) => {
    const next = new Set(current);
    if (next.has(relativePath)) next.delete(relativePath);
    else next.add(relativePath);
    return next;
  });
}
```

把 `expandedPaths` 和 `onToggleDirectory` 传给 `TreeNode`。目录节点改为 button：

```tsx
const expanded = expandedPaths.has(node.relativePath);

return (
  <div>
    <button
      type="button"
      onClick={() => onToggleDirectory(node.relativePath)}
      disabled={disabled}
      className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm font-medium text-[color:var(--ink-strong)] transition-colors hover:bg-[color:var(--paper-muted)] disabled:pointer-events-none disabled:opacity-70"
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
    >
      {expanded ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
      {expanded ? <FolderOpen className="size-4 text-[color:var(--ink-soft)]" /> : <FolderClosed className="size-4 text-[color:var(--ink-soft)]" />}
      <span className="truncate">{node.name}</span>
    </button>
    {expanded ? <div className="space-y-1">{children}</div> : null}
  </div>
);
```

添加 helper：

```ts
function findAncestorDirectories(
  nodes: FileTreeNode[],
  targetPath: string,
  ancestors: string[] = [],
): string[] {
  for (const node of nodes) {
    if (node.nodeType === "file") {
      if (node.relativePath === targetPath) return ancestors;
      continue;
    }

    const nextAncestors = [...ancestors, node.relativePath];
    const found = findAncestorDirectories(node.children ?? [], targetPath, nextAncestors);
    if (found.length > 0 || node.children?.some((child) => child.relativePath === targetPath)) {
      return found;
    }
  }

  return [];
}
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
cd web
npm run test -- src/components/workbench/file-tree.test.tsx
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add web/src/components/workbench/file-tree.tsx web/src/components/workbench/file-tree.test.tsx
git commit -m "feat(web): collapse project file tree"
```

## Task 4: 安装成熟问答 UI 依赖

**Files:**
- Modify: `web/package.json`
- Modify: `web/package-lock.json`

- [ ] **Step 1: 安装依赖**

Run:

```bash
cd web
npm install @assistant-ui/react@0.12.28 @assistant-ui/react-markdown@0.12.11
```

Expected: `package.json` 出现两个依赖，`package-lock.json` 更新。

- [ ] **Step 2: 类型安装验证**

Run:

```bash
cd web
npm run typecheck
```

Expected: PASS，或只出现后续未改问答组件无关的既有错误；如果出现依赖解析错误，需要在本任务内修复。

- [ ] **Step 3: 提交**

```bash
git add web/package.json web/package-lock.json
git commit -m "chore(web): add assistant chat dependencies"
```

## Task 5: 用 assistant-ui 重构问答面板

**Files:**
- Modify: `web/src/components/workbench/project-question-panel.tsx`
- Modify: `web/src/components/workbench/project-question-panel.test.tsx`

- [ ] **Step 1: 写失败测试**

在 `web/src/components/workbench/project-question-panel.test.tsx` 中更新或新增两个断言：

```ts
expect(container?.textContent).toContain("历史会话");
expect(container?.textContent).toContain("新会话");
expect(container?.textContent).toContain("项目问答");
```

在流式测试里让助手内容包含 Markdown：

```ts
handlers.onToken("## 结论\n\n");
handlers.onToken("- schema 在这里");
```

并断言 DOM 中有 Markdown 标题元素：

```ts
await waitForText("schema 在这里");
expect(container?.querySelector("h2")?.textContent).toContain("结论");
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd web
npm run test -- src/components/workbench/project-question-panel.test.tsx
```

Expected: FAIL，当前手写纯文本渲染不会生成 Markdown 标题。

- [ ] **Step 3: 保留现有状态机，替换渲染层**

在 `web/src/components/workbench/project-question-panel.tsx` 保留现有数据加载函数和 abort/request id 保护，新增渲染辅助：

```tsx
import { MarkdownText } from "@assistant-ui/react-markdown";
import { ThreadPrimitive, MessagePrimitive, ComposerPrimitive } from "@assistant-ui/react";
```

如果 assistant-ui primitives 对当前外部状态接入成本高，优先使用 `MarkdownText` 和 assistant-ui primitive 容器渲染现有消息数组，确保依赖实际参与问答 UI。消息渲染函数改为：

```tsx
function MessageContent({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert prose-p:leading-6 prose-pre:overflow-x-auto">
      <MarkdownText>{content}</MarkdownText>
    </div>
  );
}
```

消息项保留 role 区分和引用列表：

```tsx
function MessageItem({ message, onOpenFile }: { message: DesktopBridgeMessage; onOpenFile: (relativePath: string) => void }) {
  const label = message.role === "user" ? "你" : message.role === "assistant" ? "AI" : "系统";
  return (
    <MessagePrimitive.Root asChild>
      <article className={cn("rounded-lg border border-[color:var(--paper-border)] p-3", message.role === "user" ? "bg-[color:var(--paper-elevated)]" : "bg-[color:var(--paper-muted)]")}>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <MessageContent content={message.content} />
        <ReferenceList references={message.references ?? []} onOpenFile={onOpenFile} />
      </article>
    </MessagePrimitive.Root>
  );
}
```

右侧线程使用 assistant-ui Thread primitive 包装：

```tsx
<ThreadPrimitive.Root className="flex min-h-[34rem] flex-col rounded-lg border border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]">
  <ThreadPrimitive.Viewport className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
    {renderedMessages}
  </ThreadPrimitive.Viewport>
  <ComposerPrimitive.Root asChild>
    <form className="border-t border-[color:var(--paper-border)] p-3" onSubmit={handleSubmit}>
      ...
    </form>
  </ComposerPrimitive.Root>
</ThreadPrimitive.Root>
```

左侧会话栏使用当前 `conversations` 状态：

```tsx
<aside className="rounded-lg border border-[color:var(--paper-border)] bg-[color:var(--paper-panel)] p-3">
  <div className="flex items-center justify-between gap-2">
    <h2 className="text-sm font-semibold text-[color:var(--ink-strong)]">历史会话</h2>
    <Button type="button" size="sm" variant="outline" onClick={() => void handleNewConversation()} disabled={isStreaming || status === "loading"}>
      <Plus className="size-4" />
      新会话
    </Button>
  </div>
  <div className="mt-3 space-y-2">{conversationButtons}</div>
</aside>
```

整体布局：

```tsx
<section className="grid gap-3 lg:grid-cols-[17rem_minmax(0,1fr)]">
  {sidebar}
  {thread}
</section>
```

- [ ] **Step 4: 处理流式临时消息**

在渲染前构造消息数组，避免最终消息重复：

```ts
const renderedMessages = [
  ...messages,
  ...(streamingText || streamingReferences.length > 0
    ? [{
        id: "streaming",
        role: "assistant" as const,
        content: streamingText,
        timestamp: 0,
        conversationId: activeConversationId ?? "",
        references: streamingReferences,
      }]
    : []),
];
```

`onDone` 保持追加最终助手消息，并清空 `streamingText` / `streamingReferences`。`handleStop` 保持 abort 并清空临时消息。

- [ ] **Step 5: 运行问答测试**

Run:

```bash
cd web
npm run test -- src/components/workbench/project-question-panel.test.tsx
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add web/src/components/workbench/project-question-panel.tsx web/src/components/workbench/project-question-panel.test.tsx
git commit -m "feat(web): render project qa as ai chat"
```

## Task 6: 集成验证和浏览器检查

**Files:**
- Modify only files needed to fix failures discovered by this task.

- [ ] **Step 1: 运行类型检查**

Run:

```bash
cd web
npm run typecheck
```

Expected: PASS。

- [ ] **Step 2: 运行测试**

Run:

```bash
cd web
npm run test
```

Expected: PASS。

- [ ] **Step 3: 启动本地 Web 服务**

Run:

```bash
cd web
npm run dev -- --hostname 127.0.0.1
```

Expected: Next dev server starts and prints a localhost URL.

- [ ] **Step 4: 浏览器验证**

打开项目详情页，确认：

- tab 只有“概览 / 问答 / 分析 / 文件”。
- 概览页显示项目元信息，不显示目标/结构快捷卡片。
- 文件页目录默认折叠，点击可展开。
- 问答页是左侧历史会话 + 右侧聊天线程，助手 Markdown 能渲染结构化内容。

- [ ] **Step 5: 提交修复**

如果 Step 1-4 没有引入修复，本步骤不创建提交。如果有修复：

```bash
git add web
git commit -m "fix(web): polish workbench chat integration"
```

## 自检结果

- Spec coverage: 工作台入口、概览页替换、文件树折叠、assistant-ui 问答 UI、Markdown、历史会话、流式输出、引用打开和验证步骤均有对应任务。
- 空白项扫描：计划不包含未决空白要求；每个代码任务都有具体测试、实现方向和命令。
- Type consistency: 所有任务沿用现有 `WorkbenchSection`、`ProjectDetail`、`FileTreeNode`、`DesktopBridgeMessage`、`DesktopBridgeReference` 类型，未引入新的服务端问答语义。
