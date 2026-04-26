# UI 中文化与深色主题 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Web 工作台浏览器可见 UI 改为中文，并加入可持久化切换的浅色 / 深色主题。

**Architecture:** 保留内部英文契约值，通过 `display-labels` 在显示层输出中文；新增客户端主题 Provider 同步 `.dark` class 和 `localStorage`。样式以全局语义变量为基础，组件逐步替换浅色硬编码，保证浅色延续当前纸质质感、深色保持低眩光可读。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript、Tailwind CSS v4、lucide-react、Vitest + jsdom。

---

## File Structure

- Create: `web/src/lib/display-labels.ts`  
  负责内部契约值到中文显示值的纯函数映射。
- Create: `web/src/lib/display-labels.test.ts`  
  覆盖 section、项目状态、权限模式、文件模式、重任务运行时和任务名。
- Create: `web/src/components/theme/theme-provider.tsx`  
  客户端主题上下文、`localStorage` 持久化、根节点 class 同步。
- Create: `web/src/components/theme/theme-toggle.tsx`  
  中文主题切换按钮，使用 lucide 图标。
- Create: `web/src/components/theme/theme-provider.test.tsx`  
  覆盖默认主题、点击切换和中文 aria 文案。
- Modify: `web/src/app/layout.tsx`  
  设置 `lang="zh-CN"`、中文 metadata，并包裹 `ThemeProvider`。
- Modify: `web/src/app/globals.css`  
  补齐浅色 / 深色语义变量与深色 body 背景。
- Modify: `web/src/components/app/app-shell.tsx`  
  加入 `ThemeToggle`，替换壳层浅色硬编码。
- Modify: `web/src/components/projects/project-list-page.tsx`  
  项目列表页中文化与主题样式修正。
- Modify: `web/src/components/workbench/project-workbench.tsx`  
  工作台主文案、tab 显示映射、侧栏和 Project Info 中文化。
- Modify: `web/src/components/workbench/project-overview.tsx`  
  概览行动卡、结构快照和指标中文化。
- Modify: `web/src/components/workbench/file-tree.tsx`  
  文件树标题、说明、空态和主题样式。
- Modify: `web/src/components/workbench/file-panel.tsx`  
  文件面板、保存状态、草稿保护和 facts 中文化。
- Modify: `web/src/components/workbench/draft-guard.ts`  
  未保存草稿 intent message 中文化。
- Modify: `web/src/components/workbench/file-preview.tsx`  
  只读预览、元数据、不支持和空文件中文化。
- Modify: `web/src/components/workbench/project-search.tsx`  
  搜索输入、状态、摘要、结果按钮中文化。
- Modify: `web/src/components/workbench/project-question-panel.tsx`  
  问答输入、状态、错误和来源按钮中文化。
- Modify: `web/src/components/workbench/project-insights-panel.tsx`  
  Insights 面板标题、摘要、分组、空态和来源按钮中文化。
- Modify: `web/src/components/workbench/*.test.tsx` and `draft-guard.test.ts`  
  更新断言为中文；不改内部测试数据的英文契约值。
- Modify: `web/docs/web-roadmap-next-phases.md`  
  追加“UI 中文化与深色主题”完成记录，不改变阶段 2-8 已完成状态。

---

### Task 1: 显示映射模块

**Files:**
- Create: `web/src/lib/display-labels.ts`
- Create: `web/src/lib/display-labels.test.ts`

- [ ] **Step 1: 写失败测试**

Create `web/src/lib/display-labels.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  formatAccessModeLabel,
  formatFileModeLabel,
  formatHeavyTaskBridgeStatusLabel,
  formatHeavyTaskEngineLabel,
  formatHeavyTaskNameLabel,
  formatProjectStatusLabel,
  formatWorkbenchSectionLabel,
} from "./display-labels";

describe("display labels", () => {
  it("formats workbench sections for browser-visible tabs", () => {
    expect(formatWorkbenchSectionLabel("Overview")).toBe("概览");
    expect(formatWorkbenchSectionLabel("Ask")).toBe("问答");
    expect(formatWorkbenchSectionLabel("Insights")).toBe("洞察");
    expect(formatWorkbenchSectionLabel("Files")).toBe("文件");
    expect(formatWorkbenchSectionLabel("Purpose")).toBe("目标");
    expect(formatWorkbenchSectionLabel("Schema")).toBe("结构");
    expect(formatWorkbenchSectionLabel("Project Info")).toBe("项目信息");
  });

  it("formats project, access, file, and heavy task values", () => {
    expect(formatProjectStatusLabel("ready")).toBe("就绪");
    expect(formatProjectStatusLabel("incomplete")).toBe("不完整");
    expect(formatAccessModeLabel("read-write")).toBe("可读写");
    expect(formatAccessModeLabel("read-only")).toBe("只读");
    expect(formatFileModeLabel("editable")).toBe("可编辑");
    expect(formatFileModeLabel("preview")).toBe("预览");
    expect(formatFileModeLabel("metadata")).toBe("元数据");
    expect(formatFileModeLabel("unsupported")).toBe("不支持");
    expect(formatHeavyTaskEngineLabel("node")).toBe("内置运行时");
    expect(formatHeavyTaskBridgeStatusLabel("not-configured")).toBe("未配置");
    expect(formatHeavyTaskNameLabel("project-search")).toBe("项目搜索");
    expect(formatHeavyTaskNameLabel("project-insights")).toBe("项目洞察");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd web
npm run test -- src/lib/display-labels.test.ts
```

Expected: FAIL，原因是 `./display-labels` 模块不存在。

- [ ] **Step 3: 实现显示映射**

Create `web/src/lib/display-labels.ts`:

```ts
import type {
  FileViewMode,
  HeavyTaskBridgeStatus,
  HeavyTaskEngine,
  HeavyTaskName,
  ProjectAccessMode,
  ProjectStatus,
  WorkbenchSection,
} from "@/lib/types";

const workbenchSectionLabels: Record<WorkbenchSection, string> = {
  Overview: "概览",
  Ask: "问答",
  Insights: "洞察",
  Files: "文件",
  Purpose: "目标",
  Schema: "结构",
  "Project Info": "项目信息",
};

const projectStatusLabels: Record<ProjectStatus, string> = {
  ready: "就绪",
  incomplete: "不完整",
};

const accessModeLabels: Record<ProjectAccessMode, string> = {
  "read-write": "可读写",
  "read-only": "只读",
};

const fileModeLabels: Record<FileViewMode, string> = {
  editable: "可编辑",
  preview: "预览",
  metadata: "元数据",
  unsupported: "不支持",
};

const heavyTaskEngineLabels: Record<HeavyTaskEngine, string> = {
  node: "内置运行时",
};

const heavyTaskBridgeStatusLabels: Record<HeavyTaskBridgeStatus, string> = {
  "not-configured": "未配置",
};

const heavyTaskNameLabels: Record<HeavyTaskName, string> = {
  "project-search": "项目搜索",
  "project-insights": "项目洞察",
};

export function formatWorkbenchSectionLabel(value: WorkbenchSection) {
  return workbenchSectionLabels[value];
}

export function formatProjectStatusLabel(value: ProjectStatus) {
  return projectStatusLabels[value];
}

export function formatAccessModeLabel(value: ProjectAccessMode) {
  return accessModeLabels[value];
}

export function formatFileModeLabel(value: FileViewMode) {
  return fileModeLabels[value];
}

export function formatHeavyTaskEngineLabel(value: HeavyTaskEngine) {
  return heavyTaskEngineLabels[value];
}

export function formatHeavyTaskBridgeStatusLabel(value: HeavyTaskBridgeStatus) {
  return heavyTaskBridgeStatusLabels[value];
}

export function formatHeavyTaskNameLabel(value: HeavyTaskName) {
  return heavyTaskNameLabels[value];
}
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
cd web
npm run test -- src/lib/display-labels.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add web/src/lib/display-labels.ts web/src/lib/display-labels.test.ts
git commit -m "feat: add chinese display labels"
```

### Task 2: 主题 Provider 与切换按钮

**Files:**
- Create: `web/src/components/theme/theme-provider.tsx`
- Create: `web/src/components/theme/theme-toggle.tsx`
- Create: `web/src/components/theme/theme-provider.test.tsx`
- Modify: `web/src/app/layout.tsx`

- [ ] **Step 1: 写失败测试**

Create `web/src/components/theme/theme-provider.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "./theme-provider";
import { ThemeToggle } from "./theme-toggle";

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
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("data-theme");
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("ThemeProvider", () => {
  it("renders a chinese toggle and switches to dark mode", () => {
    renderTheme();

    const button = requiredButton("深色");
    expect(button.getAttribute("aria-label")).toBe("切换为深色主题");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    act(() => {
      button.click();
    });

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem("llm-wiki-theme")).toBe("dark");
    expect(requiredButton("浅色").getAttribute("aria-label")).toBe("切换为浅色主题");
  });

  it("uses saved dark theme on first client render", () => {
    window.localStorage.setItem("llm-wiki-theme", "dark");

    renderTheme();

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(requiredButton("浅色")).not.toBeNull();
  });
});

function renderTheme() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  act(() => {
    root?.render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
  });
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
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd web
npm run test -- src/components/theme/theme-provider.test.tsx
```

Expected: FAIL，原因是主题组件不存在。

- [ ] **Step 3: 实现主题 Provider**

Create `web/src/components/theme/theme-provider.tsx`:

```tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const storageKey = "llm-wiki-theme";
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");

  useLayoutEffect(() => {
    setThemeState(readInitialTheme());
  }, []);

  useLayoutEffect(() => {
    applyTheme(theme);

    try {
      window.localStorage.setItem(storageKey, theme);
    } catch {
      return;
    }
  }, [theme]);

  const setTheme = useCallback((nextTheme: Theme) => {
    setThemeState(nextTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((currentTheme) => (currentTheme === "dark" ? "light" : "dark"));
  }, []);

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme }),
    [setTheme, theme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);

  if (!value) {
    throw new Error("useTheme must be used inside ThemeProvider.");
  }

  return value;
}

function readInitialTheme(): Theme {
  try {
    const savedTheme = window.localStorage.getItem(storageKey);

    if (savedTheme === "dark" || savedTheme === "light") {
      return savedTheme;
    }
  } catch {
    return "light";
  }

  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.dataset.theme = theme;
}
```

- [ ] **Step 4: 实现主题切换按钮**

Create `web/src/components/theme/theme-toggle.tsx`:

```tsx
"use client";

import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTheme } from "./theme-provider";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const nextThemeLabel = theme === "dark" ? "浅色" : "深色";
  const ariaLabel = theme === "dark" ? "切换为浅色主题" : "切换为深色主题";
  const Icon = theme === "dark" ? Sun : Moon;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={toggleTheme}
      aria-label={ariaLabel}
      className="rounded-full border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]/80"
    >
      <Icon className="size-4" aria-hidden="true" />
      {nextThemeLabel}
    </Button>
  );
}
```

- [ ] **Step 5: 接入根布局**

Modify `web/src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { ThemeProvider } from "@/components/theme/theme-provider";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LLM Wiki 工作台",
  description: "用于浏览、编辑和理解 LLM Wiki 项目的 Web 工作台。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 6: 运行测试确认通过**

Run:

```bash
cd web
npm run test -- src/components/theme/theme-provider.test.tsx
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add web/src/components/theme/theme-provider.tsx web/src/components/theme/theme-toggle.tsx web/src/components/theme/theme-provider.test.tsx web/src/app/layout.tsx
git commit -m "feat: add switchable theme provider"
```

### Task 3: 全局主题变量与 AppShell

**Files:**
- Modify: `web/src/app/globals.css`
- Modify: `web/src/components/app/app-shell.tsx`

- [ ] **Step 1: 更新全局 CSS**

Modify `web/src/app/globals.css` so `:root` keeps the current warm paper style and `.dark` defines the dark paper tokens:

```css
:root {
  --paper-base: oklch(0.985 0.012 84.2);
  --paper-panel: oklch(0.995 0.008 84.1);
  --paper-elevated: oklch(0.99 0.011 84.2);
  --paper-muted: oklch(0.955 0.014 81.7);
  --paper-accent: oklch(0.8 0.067 73.5);
  --paper-border: oklch(0.88 0.015 73.6);
  --ink-strong: oklch(0.24 0.024 44.2);
  --ink-soft: oklch(0.44 0.024 49.4);
  --shadow-panel: 61 52 40;
  --tone-warning-bg: oklch(0.94 0.035 77.8);
  --tone-warning-fg: oklch(0.34 0.05 58.4);
  --tone-success-bg: oklch(0.93 0.038 151.2);
  --tone-success-fg: oklch(0.35 0.06 153.1);
}

.dark {
  --background: oklch(0.14 0.012 55);
  --foreground: oklch(0.93 0.018 82);
  --card: oklch(0.19 0.014 58);
  --card-foreground: oklch(0.93 0.018 82);
  --popover: oklch(0.19 0.014 58);
  --popover-foreground: oklch(0.93 0.018 82);
  --primary: oklch(0.82 0.061 75);
  --primary-foreground: oklch(0.17 0.014 55);
  --secondary: oklch(0.24 0.014 58);
  --secondary-foreground: oklch(0.92 0.018 82);
  --muted: oklch(0.24 0.014 58);
  --muted-foreground: oklch(0.72 0.018 78);
  --accent: oklch(0.31 0.026 70);
  --accent-foreground: oklch(0.92 0.018 82);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(0.92 0.018 82 / 14%);
  --input: oklch(0.92 0.018 82 / 18%);
  --ring: oklch(0.72 0.055 75);
  --paper-base: oklch(0.14 0.012 55);
  --paper-panel: oklch(0.19 0.014 58);
  --paper-elevated: oklch(0.23 0.016 60);
  --paper-muted: oklch(0.24 0.014 58);
  --paper-accent: oklch(0.72 0.072 75);
  --paper-border: oklch(0.92 0.018 82 / 15%);
  --ink-strong: oklch(0.93 0.018 82);
  --ink-soft: oklch(0.73 0.02 79);
  --shadow-panel: 0 0 0;
  --tone-warning-bg: oklch(0.27 0.03 70);
  --tone-warning-fg: oklch(0.84 0.06 78);
  --tone-success-bg: oklch(0.24 0.032 152);
  --tone-success-fg: oklch(0.78 0.07 153);
}

html {
  color-scheme: light;
}

html.dark {
  color-scheme: dark;
}

html.dark body {
  background-image:
    linear-gradient(180deg, rgba(26, 23, 20, 0.94), rgba(16, 14, 12, 0.98)),
    radial-gradient(circle at top left, rgb(216 166 87 / 0.1), transparent 28%),
    repeating-linear-gradient(
      0deg,
      rgba(235, 216, 185, 0.025) 0,
      rgba(235, 216, 185, 0.025) 1px,
      transparent 1px,
      transparent 14px
    );
}
```

Keep existing shadcn variables, but add the missing semantic variables and the `html.dark body` override.

- [ ] **Step 2: 接入 AppShell 主题按钮与壳层样式**

Modify `web/src/components/app/app-shell.tsx`:

```tsx
import type { ReactNode } from "react";

import { ThemeToggle } from "@/components/theme/theme-toggle";
import { cn } from "@/lib/utils";

// inside header grid, wrap aside with a vertical stack:
{aside ? (
  <div className="flex flex-col gap-3 lg:justify-self-end">
    <div className="flex justify-end">
      <ThemeToggle />
    </div>
    {aside}
  </div>
) : (
  <div className="flex justify-end lg:justify-self-end">
    <ThemeToggle />
  </div>
)}
```

Also replace shell backgrounds with theme-aware classes:

```tsx
<div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,color-mix(in_oklab,var(--paper-accent)_18%,transparent),transparent_28%),radial-gradient(circle_at_bottom_right,color-mix(in_oklab,var(--ink-soft)_10%,transparent),transparent_30%)]" />
<div className="absolute inset-x-0 top-0 h-48 border-b border-[color:var(--paper-border)] bg-[linear-gradient(180deg,color-mix(in_oklab,var(--paper-base)_88%,transparent),transparent)]" />
```

- [ ] **Step 3: 运行类型检查**

Run:

```bash
cd web
npm run typecheck
```

Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add web/src/app/globals.css web/src/components/app/app-shell.tsx
git commit -m "feat: add dark theme shell styling"
```

### Task 4: 项目列表页中文化

**Files:**
- Modify: `web/src/components/projects/project-list-page.tsx`

- [ ] **Step 1: 引入显示映射并替换结构标签**

Modify imports:

```ts
import {
  formatProjectStatusLabel,
} from "@/lib/display-labels";
```

Change `structureItems` labels:

```ts
const structureItems = [
  { key: "hasPurpose", label: "目标" },
  { key: "hasSchema", label: "结构" },
  { key: "hasWikiDirectory", label: "知识库" },
  { key: "hasRawSourcesDirectory", label: "原始资料" },
] satisfies Array<{
  key: "hasPurpose" | "hasSchema" | "hasWikiDirectory" | "hasRawSourcesDirectory";
  label: string;
}>;
```

- [ ] **Step 2: 替换页眉、侧栏和状态文案**

Use these browser-visible strings:

```tsx
<AppShell
  eyebrow="项目登记册"
  title="选择要打开的项目档案"
  description="浏览当前可用项目，查看结构完整度，然后进入工作台继续阅读、编辑和分析。"
  aside={<HeaderAside projectCount={projectCount} />}
>
```

Replace sidebar text:

```tsx
<CardTitle>阅读提示</CardTitle>
<CardDescription>列表优先呈现项目结构和进入工作台所需的线索。</CardDescription>
<SidebarMetric label="状态标记" value="就绪或不完整" />
<SidebarMetric label="必需结构" value="目标 / 结构 / 知识库" />
<SidebarMetric label="可选资料" value="存在时展示原始资料" />
```

Replace header aside:

```tsx
<CardTitle>项目入口</CardTitle>
<CardDescription>进入研究工作台前的项目选择台。</CardDescription>
<p>已列项目</p>
<Badge>登记册</Badge>
<p>打开结构已经足够完整的项目，或把缺失项作为整理线索。</p>
```

- [ ] **Step 3: 替换加载、错误、空态和卡片文案**

Use:

```tsx
const message =
  error instanceof Error ? error.message : "无法加载项目记录。";
```

Error state:

```tsx
<CardTitle>无法打开项目登记册</CardTitle>
<CardDescription>无法从 `/api/projects` 组装项目列表。</CardDescription>
<AlertTitle>请求失败</AlertTitle>
```

Empty state:

```tsx
<CardTitle>没有找到项目档案</CardTitle>
<CardDescription>登记册可以访问，但目前没有可展示的项目。</CardDescription>
<p>当项目根目录解析为有效工作区后，这里会展示结构标记和进入工作台的入口。</p>
```

Project card:

```tsx
{formatProjectStatusLabel(project.status)}
项目 ID：<span ...>{project.id}</span>
{project.status === "ready"
  ? "核心结构已经就绪，可以直接进入工作台。"
  : "这个项目仍缺少部分结构，适合作为整理对象。"}
打开档案
```

Structure pill:

```tsx
{present ? "已存在" : "缺失"}
```

Date formatting:

```ts
function formatUpdatedAt(value: string | null) {
  if (!value) {
    return "无更新时间";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "时间不可用";
  }

  return `更新于 ${new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date)}`;
}
```

- [ ] **Step 4: 修正项目列表页主题样式**

Replace repeated light-only classes:

```tsx
"border-b border-[color:var(--paper-border)]"
"bg-[color:var(--paper-panel)]/90"
"bg-[color:var(--paper-muted)]/60"
"border-[color:var(--paper-border)]"
"shadow-[0_16px_48px_rgba(var(--shadow-panel),0.08)]"
```

Keep status colors, but add dark-readable variants:

```tsx
project.status === "ready"
  ? "border-emerald-900/10 bg-emerald-900/8 text-emerald-950 dark:border-emerald-300/20 dark:bg-emerald-300/10 dark:text-emerald-100"
  : "border-amber-900/15 bg-amber-800/8 text-amber-950 dark:border-amber-300/20 dark:bg-amber-300/10 dark:text-amber-100"
```

- [ ] **Step 5: 运行类型检查**

Run:

```bash
cd web
npm run typecheck
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add web/src/components/projects/project-list-page.tsx
git commit -m "feat: localize project registry ui"
```

### Task 5: 工作台主页面与 Project Info 中文化

**Files:**
- Modify: `web/src/components/workbench/project-workbench.tsx`
- Modify: `web/src/components/workbench/project-workbench.test.tsx`

- [ ] **Step 1: 更新测试断言为中文**

In `project-workbench.test.tsx`, keep mocked `sections` values in English, but update visible button/text expectations:

```tsx
await waitForText("只读");
await clickButton("项目信息");

expect(container?.textContent).toContain("访问模式");
expect(container?.textContent).toContain("只读");
expect(container?.textContent).toContain("写入权限");
expect(container?.textContent).toContain("否");
expect(container?.textContent).toContain("重任务运行时");
expect(container?.textContent).toContain("内置运行时");
expect(container?.textContent).toContain("桥接状态");
expect(container?.textContent).toContain("未配置");
expect(container?.textContent).toContain("已跟踪重任务");
expect(container?.textContent).toContain("项目搜索、项目洞察");
```

Update source-open mock buttons:

```tsx
打开来源
打开洞察来源
```

Update draft guard expectations:

```tsx
expect(container?.textContent).toContain("未保存草稿");
await clickButton("取消");
```

- [ ] **Step 2: 引入显示映射**

Modify imports in `project-workbench.tsx`:

```ts
import {
  formatAccessModeLabel,
  formatHeavyTaskBridgeStatusLabel,
  formatHeavyTaskEngineLabel,
  formatHeavyTaskNameLabel,
  formatProjectStatusLabel,
  formatWorkbenchSectionLabel,
} from "@/lib/display-labels";
```

- [ ] **Step 3: 替换主标题、错误和 tab 显示**

Use:

```tsx
message:
  error instanceof Error
    ? error.message
    : "无法组装项目工作台。",

setPanelNotice({
  tone: "error",
  title: "文件请求失败",
  message: error instanceof Error ? error.message : "无法打开请求的文件。",
});

title: "目标文件不可用"
message: "purpose.md 在这个项目中不可用。"
title: "结构文件不可用"
message: "schema.md 在这个项目中不可用。"
```

Title and description:

```tsx
const title = loadState.status === "ready" ? loadState.detail.name : "项目工作台";
const description =
  loadState.status === "ready"
    ? "打开项目文件树，检查来源文件，并通过项目路由编辑允许修改的 Markdown 记录。"
    : "正在加载项目档案和文件树。";

<AppShell eyebrow="项目工作台" ...>
```

Tabs:

```tsx
{formatWorkbenchSectionLabel(item)}
```

- [ ] **Step 4: 替换侧栏和错误状态**

Use:

```tsx
<CardTitle>工作台状态</CardTitle>
<CardDescription>当前路由和项目结构状态。</CardDescription>
<p>项目路由</p>
{formatProjectStatusLabel(loadState.detail.status)}
访问 {formatAccessModeLabel(loadState.detail.access.mode)}
重新加载项目
```

Workbench error:

```tsx
<CardTitle>无法打开项目工作台</CardTitle>
<CardDescription>页面未能完成初始详情和文件树请求。</CardDescription>
<AlertTitle>初始加载失败</AlertTitle>
重试
```

- [ ] **Step 5: 替换 Project Info**

Use:

```tsx
<CardTitle>项目信息</CardTitle>
<CardDescription>已解析项目路由和文件树组成摘要。</CardDescription>
<InfoBlock label="项目名称" value={detail.name} />
<InfoBlock label="项目 ID" value={detail.id} mono />
<InfoBlock label="状态" value={formatProjectStatusLabel(detail.status)} />
<InfoBlock label="访问模式" value={formatAccessModeLabel(detail.access.mode)} />
<InfoBlock label="写入权限" value={detail.access.canWrite ? "是" : "否"} />
<InfoBlock label="重任务运行时" value={formatHeavyTaskEngineLabel(detail.runtime.activeEngine)} />
<InfoBlock label="桥接状态" value={formatHeavyTaskBridgeStatusLabel(detail.runtime.bridgeStatus)} />
<InfoBlock
  label="已跟踪重任务"
  value={detail.runtime.heavyTasks.map((task) => formatHeavyTaskNameLabel(task.task)).join("、")}
/>
<InfoBlock label="目标文件" value={detail.hasPurpose ? "已存在" : "缺失"} />
<InfoBlock label="结构文件" value={detail.hasSchema ? "已存在" : "缺失"} />
<InfoBlock label="知识库目录" value={detail.hasWikiDirectory ? "已存在" : "缺失"} />
<InfoBlock label="原始资料目录" value={detail.hasRawSourcesDirectory ? "已存在" : "缺失"} />
<InfoBlock label="工作区" value={detail.sections.map(formatWorkbenchSectionLabel).join("、")} />
<InfoBlock label="文件树条目" value={String(collectTreePaths(tree).size)} />
```

- [ ] **Step 6: 运行工作台测试**

Run:

```bash
cd web
npm run test -- src/components/workbench/project-workbench.test.tsx
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add web/src/components/workbench/project-workbench.tsx web/src/components/workbench/project-workbench.test.tsx
git commit -m "feat: localize workbench shell"
```

### Task 6: 概览、文件树、文件预览中文化

**Files:**
- Modify: `web/src/components/workbench/project-overview.tsx`
- Modify: `web/src/components/workbench/file-tree.tsx`
- Modify: `web/src/components/workbench/file-preview.tsx`
- Modify tests: `project-overview.test.tsx`, `file-preview.test.tsx`

- [ ] **Step 1: 更新概览和预览测试断言**

In `project-overview.test.tsx`, use visible Chinese button/text examples:

```tsx
expect(container?.textContent).toContain("工作台概览");
expect(container?.textContent).toContain("目标档案");
expect(container?.textContent).toContain("打开 purpose.md");
expect(container?.textContent).toContain("项目快照");
```

In `file-preview.test.tsx`, use:

```tsx
expect(container?.textContent).toContain("只读预览");
expect(container?.textContent).toContain("这个文件为空。");
expect(container?.textContent).toContain("仅显示元数据");
expect(container?.textContent).toContain("无法预览");
```

- [ ] **Step 2: 修改项目概览文案**

Use these strings in `project-overview.tsx`:

```tsx
<CardTitle>工作台概览</CardTitle>
<CardDescription>直接打开核心编辑文件，或进入完整文件浏览器。</CardDescription>

title="目标档案"
description={project.hasPurpose ? "直接在编辑器中打开 purpose.md。" : "当前还没有 purpose.md 文件。"}
actionLabel={project.hasPurpose ? "打开 purpose.md" : "缺少目标文件"}

title="结构地图"
description={project.hasSchema ? "直接在编辑器中打开 schema.md。" : "当前还没有 schema.md 文件。"}
actionLabel={project.hasSchema ? "打开 schema.md" : "缺少结构文件"}

title="完整文件浏览器"
description="从文件区域浏览整个项目树。"
actionLabel="打开文件浏览器"

title="知识库目录"
description={preferredWikiMarkdownPath ? "从项目树中直接打开第一个知识库阅读文件。" : "当前还没有知识库 Markdown 文件。"}
actionLabel="从知识库开始"
```

Snapshot labels:

```tsx
<CardTitle>项目快照</CardTitle>
<CardDescription>这个档案的快速结构上下文。</CardDescription>
<Metric label="状态" value={formatProjectStatusLabel(project.status)} />
<Metric label="工作区" value={String(project.sections.length)} />
<Metric label="文件数" value={String(fileCount)} />
<Metric label="目录数" value={String(directoryCount)} />
<Metric label="Markdown 文件" value={String(readingStats.markdownFiles)} />
<Metric label="预览文件" value={String(readingStats.previewFiles)} />
<Metric label="元数据文件" value={String(readingStats.metadataFiles)} />
<Metric label="项目 ID" value={project.id} mono />
```

- [ ] **Step 3: 修改文件树文案**

Use:

```tsx
<h2>项目文件</h2>
<p>浏览项目根目录，并在右侧面板打开单个记录。</p>
<div>这个项目没有返回文件。</div>
```

- [ ] **Step 4: 修改文件预览文案**

Use:

```tsx
title="仅显示元数据"
description="这个文件以元数据形式展示，内容不会在工作台预览中直接显示。"

title="无法预览"
description="这个文件类型无法在工作台中预览。"

<span>只读预览</span>
这个文件为空。
```

Metadata keys are raw metadata and stay unchanged.

- [ ] **Step 5: 修正主题样式**

For all three files, replace light-only panel classes with:

```tsx
"border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]/92"
"border-[color:var(--paper-border)] bg-[color:var(--paper-muted)]/60"
"hover:bg-[color:var(--paper-muted)]/80"
"bg-[color:var(--paper-accent)]/15"
```

- [ ] **Step 6: 运行相关测试**

Run:

```bash
cd web
npm run test -- src/components/workbench/project-overview.test.tsx src/components/workbench/file-preview.test.tsx
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add web/src/components/workbench/project-overview.tsx web/src/components/workbench/file-tree.tsx web/src/components/workbench/file-preview.tsx web/src/components/workbench/project-overview.test.tsx web/src/components/workbench/file-preview.test.tsx
git commit -m "feat: localize workbench reading panels"
```

### Task 7: 文件面板与草稿保护中文化

**Files:**
- Modify: `web/src/components/workbench/file-panel.tsx`
- Modify: `web/src/components/workbench/draft-guard.ts`
- Modify tests: `file-panel.test.tsx`, `draft-guard.test.ts`

- [ ] **Step 1: 更新文件面板测试**

In `file-panel.test.tsx`, replace button helpers:

```ts
function readButton() {
  return requiredButton("阅读");
}

function editButton() {
  return requiredButton("编辑");
}
```

Replace expectations:

```tsx
expect(buttonNamed("保存修改")).toBeNull();
expect(buttonNamed("重置草稿")).toBeNull();
requiredButton("重置草稿").click();
```

- [ ] **Step 2: 更新草稿保护测试**

In `draft-guard.test.ts`, expect Chinese messages:

```ts
expect(buildPendingDraftMessage({ type: "open-file", path: "wiki/index.md" })).toBe(
  "你有未保存修改。请先保存或放弃草稿，再打开 wiki/index.md。",
);
expect(buildPendingDraftMessage({ type: "reload-project" })).toBe(
  "你有未保存修改。请先保存或放弃草稿，再重新加载项目。",
);
```

- [ ] **Step 3: 修改 draft guard message**

Modify `web/src/components/workbench/draft-guard.ts`:

```ts
export function buildPendingDraftMessage(intent: PendingWorkbenchIntent) {
  switch (intent.type) {
    case "open-file":
      return `你有未保存修改。请先保存或放弃草稿，再打开 ${intent.path}。`;
    case "open-section-file":
      return `你有未保存修改。请先保存或放弃草稿，再打开 ${intent.path} 的 ${formatWorkbenchSectionLabel(intent.section)}。`;
    case "reload-project":
      return "你有未保存修改。请先保存或放弃草稿，再重新加载项目。";
    case "show-missing-section-file":
      return `你有未保存修改。请先保存或放弃草稿，再打开 ${formatWorkbenchSectionLabel(intent.section)}。${intent.path} 不可用。`;
  }
}
```

Import `formatWorkbenchSectionLabel`.

- [ ] **Step 4: 修改文件面板文案**

Use:

```tsx
title={selectedPath ? `正在打开 ${selectedPath}` : "正在打开文件"}
description="工作台正在通过项目路由读取请求的文件。"
正在加载文件内容...

title={selectedPath ? `无法打开 ${selectedPath}` : getEmptyPanelTitle(section)}
description="请求已返回错误，因此没有可显示的内联文件内容。"

<Button>阅读</Button>
<Button>编辑</Button>
{fileView === "read" ? "正在阅读草稿预览" : "正在编辑本地草稿"}
{saving ? "正在保存..." : "保存修改"}
重置草稿
手动保存。未保存修改会留在当前面板中。
```

DraftGuardAlert:

```tsx
<AlertTitle>未保存草稿</AlertTitle>
{prompt.saving ? "正在保存..." : "保存并继续"}
放弃草稿
取消
```

Save status:

```tsx
正在从磁盘刷新已保存文件...
已保存{lastSavedAt ? `于 ${formatSavedAt(lastSavedAt)}` : ""}。
保存失败。你的草稿仍保留在本地。
已保存{lastSavedAt ? `于 ${formatSavedAt(lastSavedAt)}` : ""}，但刷新失败。
冲突{conflict?.relativePath ? `：${conflict.relativePath}` : ""}。你的草稿尚未保存。
重新加载远端
```

Facts:

```tsx
<Fact label="模式" value={formatFileModeLabel(file.mode)} />
<Fact label="可编辑" value={file.editable ? "是" : "否"} />
<Fact label="大小" value={`${file.size} 字节`} />
<Fact label="状态" value={dirty ? "有未保存修改" : "已同步"} />
```

Descriptions:

```ts
"文件策略允许的 Markdown 文件可以手动编辑和保存。"
"这个文件可以在工作台中只读预览。"
"这个文件以元数据形式展示，不显示内联内容。"
"这个文件无法在工作台中内联打开。"
```

Empty titles/descriptions/messages:

```ts
"目标文件"
"结构文件"
"未选择文件"
"此区域会在项目包含 purpose.md 时打开它。"
"此区域会在项目包含 schema.md 时打开它。"
"从文件树选择文件，或使用上方工作区快捷入口。"
`工作台保留了 ${selectedPath} 的选中状态，你可以重试或从文件树选择其他文件。`
"项目暴露 purpose.md 后会在这里渲染。"
"项目暴露 schema.md 后会在这里渲染。"
"打开项目文件前，面板会保持为空。"
```

- [ ] **Step 5: 运行相关测试**

Run:

```bash
cd web
npm run test -- src/components/workbench/file-panel.test.tsx src/components/workbench/draft-guard.test.ts
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add web/src/components/workbench/file-panel.tsx web/src/components/workbench/draft-guard.ts web/src/components/workbench/file-panel.test.tsx web/src/components/workbench/draft-guard.test.ts
git commit -m "feat: localize file editing panel"
```

### Task 8: 搜索、问答、洞察面板中文化

**Files:**
- Modify: `web/src/components/workbench/project-search.tsx`
- Modify: `web/src/components/workbench/project-question-panel.tsx`
- Modify: `web/src/components/workbench/project-insights-panel.tsx`
- Modify tests: `project-search.test.tsx`, `project-question-panel.test.tsx`, `project-insights-panel.test.tsx`

- [ ] **Step 1: 更新搜索测试断言**

Use Chinese visible strings:

```tsx
expect(input.getAttribute("placeholder")).toBe("搜索项目文件");
expect(container?.textContent).toContain("搜索路径和文件内容。");
expect(container?.textContent).toContain("请输入至少 2 个字符");
expect(container?.textContent).toContain("正在搜索");
expect(container?.textContent).toContain("没有结果");
expect(buttonNamed("打开结果")).not.toBeNull();
```

- [ ] **Step 2: 更新问答测试断言**

Use:

```tsx
expect(container?.textContent).toContain("项目问答");
expect(textarea.getAttribute("placeholder")).toBe("询问这个项目");
expect(container?.textContent).toContain("回答会使用项目来源。");
expect(buttonNamed("提问")).not.toBeNull();
expect(buttonNamed("打开来源")).not.toBeNull();
```

- [ ] **Step 3: 更新洞察测试断言**

Use:

```tsx
expect(container?.textContent).toContain("项目洞察");
expect(container?.textContent).toContain("正在加载洞察");
expect(container?.textContent).toContain("关系图边");
expect(container?.textContent).toContain("发现");
expect(container?.textContent).toContain("研究问题");
expect(buttonNamed("打开来源")).not.toBeNull();
```

- [ ] **Step 4: 修改搜索面板**

Use:

```tsx
placeholder="搜索项目文件"
aria-label="搜索项目文件"
搜索路径和文件内容。
请输入至少 2 个字符
更短的查询会留在本地。
正在搜索
搜索失败
重试
没有结果
第 {result.lineNumber} 行
打开结果
```

Summary:

```ts
const totalLabel = `${summary.totalMatches} 个匹配`;
const scannedLabel = `已扫描 ${summary.scannedFiles} 个文件`;
const truncatedLabel = summary.truncated ? "结果已截断" : null;
return [totalLabel, scannedLabel, truncatedLabel].filter(Boolean).join(" / ");
```

Fallback:

```ts
return "搜索失败。";
```

- [ ] **Step 5: 修改问答面板**

Use:

```tsx
<h2>项目问答</h2>
placeholder="询问这个项目"
aria-label="询问项目问题"
{status === "loading" ? "正在询问项目..." : "回答会使用项目来源。"}
提问
正在询问项目
提问失败
重试
第 {source.lineNumber} 行
打开来源
```

Fallback:

```ts
return "提问失败。";
```

- [ ] **Step 6: 修改洞察面板**

Use:

```tsx
<h2>项目洞察</h2>
正在加载洞察
洞察加载失败
重试
<InsightGroup title="关系图边">
<EmptyState>没有关系图边</EmptyState>
<InsightGroup title="发现">
<EmptyState>没有发现</EmptyState>
<InsightGroup title="研究问题">
<EmptyState>没有研究问题</EmptyState>
打开来源
第 {edge.sourceLineNumber} 行
```

Summary labels:

```tsx
<SummaryItem label="已分析" value={`${summary.analyzedFiles} 个文件`} />
<SummaryItem label="Markdown" value={`${summary.markdownFiles} 个文件`} />
<SummaryItem label="节点" value={`${summary.graphNodes} 个节点`} />
<SummaryItem label="边" value={`${summary.graphEdges} 条边`} />
<SummaryItem label="发现" value={`${summary.findings} 条`} />
<SummaryItem label="问题" value={`${summary.researchPrompts} 个`} />
```

Remove or replace `formatCount()` with Chinese count strings.

- [ ] **Step 7: 运行相关测试**

Run:

```bash
cd web
npm run test -- src/components/workbench/project-search.test.tsx src/components/workbench/project-question-panel.test.tsx src/components/workbench/project-insights-panel.test.tsx
```

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add web/src/components/workbench/project-search.tsx web/src/components/workbench/project-question-panel.tsx web/src/components/workbench/project-insights-panel.tsx web/src/components/workbench/project-search.test.tsx web/src/components/workbench/project-question-panel.test.tsx web/src/components/workbench/project-insights-panel.test.tsx
git commit -m "feat: localize search question insights panels"
```

### Task 9: 全量检查、视觉验证和 roadmap 更新

**Files:**
- Modify: `web/docs/web-roadmap-next-phases.md`

- [ ] **Step 1: 扫描前端硬编码英文 UI**

Run:

```powershell
Get-ChildItem -Path "web\src\components","web\src\app" -Recurse -File |
  Where-Object { $_.Extension -in ".tsx",".ts" } |
  Select-String -Pattern '>[A-Za-z][^<]*<|placeholder="[A-Za-z]|aria-label="[A-Za-z]' |
  Select-Object Path,LineNumber,Line
```

Expected: Only acceptable internal values, imports, tests, file paths, project data fixtures, or raw metadata remain. Any application-owned visible English string in components must be changed to Chinese.

- [ ] **Step 2: 运行全量验证**

Run:

```bash
cd web
npm run test
npm run typecheck
npm run lint
```

Expected: All commands exit 0.

- [ ] **Step 3: 启动开发服务器**

Run:

```bash
cd web
npm run dev
```

Expected: Next.js dev server starts. If port 3000 is occupied, use the URL printed by Next.js.

- [ ] **Step 4: 浏览器验证**

Open the printed local URL. Check:

- Project list page text is Chinese.
- Theme button switches between `深色` and `浅色`.
- Dark mode keeps cards, inputs, alerts, file tree, search, question and insights panels readable.
- Workbench tabs show `概览 / 问答 / 洞察 / 文件 / 目标 / 结构 / 项目信息`.
- English may remain only in project IDs, file paths, file content, raw API error details, model answers, metadata keys, or internal route text.

- [ ] **Step 5: 更新 roadmap**

Append a short section near the completed phase status area in `web/docs/web-roadmap-next-phases.md`:

```md
## 14. UI 中文化与深色主题

> 状态：已完成。已按 [spec](../../docs/superpowers/specs/2026-04-26-ui-chinese-dark-theme-design.md) 和 [implementation plan](../../docs/superpowers/plans/2026-04-26-ui-chinese-dark-theme.md) 落地，覆盖浏览器可见 UI 中文化、内部契约显示映射、浅色 / 深色主题切换、深色主题语义变量和关键测试。

这不是新的 roadmap 功能阶段，而是面向当前 Web 工作台体验的一次横向补强。内部 API 字段、路由、类型和项目数据保持原样，只在显示层输出中文。
```

- [ ] **Step 6: 提交**

```bash
git add web/docs/web-roadmap-next-phases.md
git commit -m "docs: mark chinese ui dark theme complete"
```

### Task 10: 最终提交整理

**Files:**
- All changed implementation files

- [ ] **Step 1: 查看工作区**

Run:

```bash
git status --short
```

Expected: Only intentional changes remain. `.superpowers/` remains ignored.

- [ ] **Step 2: 查看最近提交**

Run:

```bash
git log --oneline -8
```

Expected: Spec, plan, implementation, tests, and roadmap commits are present.

- [ ] **Step 3: 如果还有未提交实现文件，提交它们**

Run:

```bash
git add web/src web/docs/web-roadmap-next-phases.md
git commit -m "feat: localize ui and add dark theme"
```

Expected: Commit succeeds, or Git reports there is nothing to commit.

---

## Self-Review

- Spec coverage: Tasks 1-2 cover display mapping and theme provider; Tasks 3-8 cover all listed UI areas and deep theme readability; Task 9 covers full verification and roadmap update.
- Scope boundary: No task renames internal enums, route paths, API fields, file paths, project data, or user content.
- Type consistency: Mapping functions use current `web/src/lib/types.ts` types; tab values remain `WorkbenchSection`; display labels are only used in rendered text.
- Test coverage: New tests cover mapping and theme switching; existing component tests are updated for Chinese visible UI.
