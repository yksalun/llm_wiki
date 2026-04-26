# 阶段 3 阅读与预览能力补强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Web 工作台默认提供更好的 Markdown 阅读和只读文件预览体验，同时保留阶段 2 的可靠编辑链路。

**Architecture:** 保留现有 `ProjectWorkbench` 数据流和文件 API，不新增服务端接口。新增 focused reader/preview 组件，`FilePanel` 根据文件模式组合 reader/editor，`ProjectOverview` 从现有 tree 计算结构摘要。

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, Zustand, lucide-react, shadcn/base-ui components. Markdown 渲染优先使用轻量自建 renderer；如果实现中发现不可靠，再引入 `react-markdown` / `remark-gfm` 到 `web` 子项目。

---

## 文件结构

- Create: `web/src/components/workbench/markdown-reader.tsx`  
  渲染轻量 Markdown 阅读视图，覆盖 heading、paragraph、list、blockquote、inline code、fenced code、links、hr。
- Create: `web/src/components/workbench/markdown-reader.test.tsx`  
  测试 Markdown reader 的基础渲染输出。
- Create: `web/src/components/workbench/file-preview.tsx`  
  渲染 `preview / metadata / unsupported` 的只读展示。
- Create: `web/src/components/workbench/file-preview.test.tsx`  
  测试 text preview、metadata、unsupported 的核心文案。
- Modify: `web/src/components/workbench/file-panel.tsx`  
  接入阅读优先 editable Markdown、显式 Edit / Read 切换、只读 preview 组件。
- Modify: `web/src/components/workbench/project-overview.tsx`  
  增强结构统计和阅读入口。
- Test: `web/src/components/workbench/project-overview.test.tsx`  
  测试项目概览统计。
- Modify: `web/docs/web-roadmap-next-phases.md`  
  阶段完成后标记阶段 3 已完成，并链接 spec/plan。

---

### Task 1: Markdown Reader

**Files:**
- Create: `web/src/components/workbench/markdown-reader.tsx`
- Create: `web/src/components/workbench/markdown-reader.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `web/src/components/workbench/markdown-reader.test.tsx`：

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MarkdownReader } from "./markdown-reader";

describe("MarkdownReader", () => {
  it("renders headings, paragraphs, lists, links, and inline code", () => {
    const html = renderToStaticMarkup(
      <MarkdownReader
        content={[
          "# Project Purpose",
          "",
          "This file explains `why` the project exists.",
          "",
          "- Stable editing",
          "- Comfortable reading",
          "",
          "[OpenAI](https://openai.com)",
        ].join("\n")}
      />,
    );

    expect(html).toContain("<h1");
    expect(html).toContain("Project Purpose");
    expect(html).toContain("<p");
    expect(html).toContain("<code");
    expect(html).toContain("<ul");
    expect(html).toContain("<li");
    expect(html).toContain('href="https://openai.com"');
  });

  it("renders fenced code blocks, blockquotes, and horizontal rules", () => {
    const html = renderToStaticMarkup(
      <MarkdownReader
        content={[
          "> Important note",
          "",
          "---",
          "",
          "```ts",
          "const ok = true;",
          "```",
        ].join("\n")}
      />,
    );

    expect(html).toContain("<blockquote");
    expect(html).toContain("Important note");
    expect(html).toContain("<hr");
    expect(html).toContain("<pre");
    expect(html).toContain("const ok = true;");
  });

  it("renders an empty state for blank content", () => {
    const html = renderToStaticMarkup(<MarkdownReader content="" />);

    expect(html).toContain("This file is empty");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm run test -- src/components/workbench/markdown-reader.test.tsx
```

Expected: 测试失败，因为 `markdown-reader.tsx` 尚不存在。

- [ ] **Step 3: 实现 MarkdownReader**

创建 `web/src/components/workbench/markdown-reader.tsx`：

```tsx
import type { ReactNode } from "react";

interface MarkdownReaderProps {
  content: string;
}

type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "blockquote"; text: string }
  | { type: "code"; language: string | null; text: string }
  | { type: "hr" };

export function MarkdownReader({ content }: MarkdownReaderProps) {
  const blocks = parseMarkdownBlocks(content);

  if (blocks.length === 0) {
    return (
      <div className="rounded-[16px] border border-dashed border-black/10 bg-white/55 px-4 py-6 text-sm text-muted-foreground">
        This file is empty.
      </div>
    );
  }

  return (
    <article className="space-y-4 rounded-[18px] border border-black/8 bg-white/75 px-5 py-5 text-[color:var(--ink-strong)]">
      {blocks.map((block, index) => (
        <MarkdownBlockView key={index} block={block} />
      ))}
    </article>
  );
}

function MarkdownBlockView({ block }: { block: MarkdownBlock }) {
  if (block.type === "heading") {
    const Tag = block.level === 1 ? "h1" : block.level === 2 ? "h2" : "h3";
    const size = block.level === 1 ? "text-2xl" : block.level === 2 ? "text-xl" : "text-lg";

    return <Tag className={`${size} font-semibold text-[color:var(--ink-strong)]`}>{renderInline(block.text)}</Tag>;
  }

  if (block.type === "paragraph") {
    return <p className="text-sm leading-7 text-[color:var(--ink-strong)]">{renderInline(block.text)}</p>;
  }

  if (block.type === "list") {
    const Tag = block.ordered ? "ol" : "ul";

    return (
      <Tag className={block.ordered ? "list-decimal space-y-2 pl-5 text-sm leading-7" : "list-disc space-y-2 pl-5 text-sm leading-7"}>
        {block.items.map((item, index) => (
          <li key={index}>{renderInline(item)}</li>
        ))}
      </Tag>
    );
  }

  if (block.type === "blockquote") {
    return (
      <blockquote className="border-l-4 border-[color:var(--paper-accent)] bg-black/[0.02] py-2 pl-4 text-sm leading-7 text-[color:var(--ink-soft)]">
        {renderInline(block.text)}
      </blockquote>
    );
  }

  if (block.type === "code") {
    return (
      <pre className="overflow-x-auto rounded-[14px] border border-black/8 bg-[color:var(--ink-strong)] px-4 py-3 text-sm leading-6 text-white">
        <code>{block.text}</code>
      </pre>
    );
  }

  return <hr className="border-black/10" />;
}

function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const language = trimmed.slice(3).trim() || null;
      const codeLines: string[] = [];
      index += 1;

      while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }

      if (index < lines.length) {
        index += 1;
      }

      blocks.push({ type: "code", language, text: codeLines.join("\n") });
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      blocks.push({ type: "hr" });
      index += 1;
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length as 1 | 2 | 3,
        text: headingMatch[2],
      });
      index += 1;
      continue;
    }

    if (trimmed.startsWith(">")) {
      blocks.push({ type: "blockquote", text: trimmed.replace(/^>\s?/, "") });
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      const ordered = /^\d+\.\s+/.test(trimmed);
      const items: string[] = [];

      while (index < lines.length) {
        const next = (lines[index] ?? "").trim();
        const match = ordered ? /^\d+\.\s+(.+)$/.exec(next) : /^[-*]\s+(.+)$/.exec(next);

        if (!match) {
          break;
        }

        items.push(match[1]);
        index += 1;
      }

      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const paragraphLines = [trimmed];
    index += 1;

    while (index < lines.length) {
      const next = (lines[index] ?? "").trim();

      if (
        next.length === 0 ||
        next.startsWith("```") ||
        next.startsWith(">") ||
        /^#{1,3}\s+/.test(next) ||
        /^[-*]\s+/.test(next) ||
        /^\d+\.\s+/.test(next) ||
        /^---+$/.test(next)
      ) {
        break;
      }

      paragraphLines.push(next);
      index += 1;
    }

    blocks.push({ type: "paragraph", text: paragraphLines.join(" ") });
  }

  return blocks;
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`)|(\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];

    if (token.startsWith("`")) {
      nodes.push(
        <code key={nodes.length} className="rounded bg-black/6 px-1 py-0.5 font-mono text-[0.9em]">
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      const label = linkMatch?.[1] ?? token;
      const href = linkMatch?.[2] ?? "#";

      nodes.push(
        <a key={nodes.length} className="font-medium text-[color:var(--ink-soft)] underline underline-offset-4" href={href}>
          {label}
        </a>,
      );
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}
```

- [ ] **Step 4: 运行测试**

Run:

```bash
npm run test -- src/components/workbench/markdown-reader.test.tsx
npm run typecheck
```

Expected: 测试和 typecheck 通过。

- [ ] **Step 5: 提交**

Run:

```bash
git add web/src/components/workbench/markdown-reader.tsx web/src/components/workbench/markdown-reader.test.tsx
git commit -m "feat: add markdown reader"
```

Expected: commit 成功。

---

### Task 2: File Preview Components

**Files:**
- Create: `web/src/components/workbench/file-preview.tsx`
- Create: `web/src/components/workbench/file-preview.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `web/src/components/workbench/file-preview.test.tsx`：

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { FileReadResult } from "@/lib/types";

import { FilePreview } from "./file-preview";

function createFile(overrides: Partial<FileReadResult>): FileReadResult {
  return {
    relativePath: "notes.txt",
    mode: "preview",
    content: "plain text",
    editable: false,
    size: 10,
    lastModified: "2026-04-26T00:00:00.000Z",
    metadata: {},
    ...overrides,
  };
}

describe("FilePreview", () => {
  it("renders text previews as readable content", () => {
    const html = renderToStaticMarkup(<FilePreview file={createFile({ content: "Line one\nLine two" })} />);

    expect(html).toContain("Read-only preview");
    expect(html).toContain("Line one");
    expect(html).toContain("Line two");
  });

  it("renders metadata summaries", () => {
    const html = renderToStaticMarkup(
      <FilePreview
        file={createFile({
          relativePath: "raw/sources/demo.pdf",
          mode: "metadata",
          content: null,
          metadata: { reason: "metadata_only", extension: ".pdf" },
        })}
      />,
    );

    expect(html).toContain("Metadata only");
    expect(html).toContain("metadata_only");
    expect(html).toContain(".pdf");
  });

  it("renders unsupported reasons", () => {
    const html = renderToStaticMarkup(
      <FilePreview
        file={createFile({
          relativePath: "binary.bin",
          mode: "unsupported",
          content: null,
          metadata: { reason: "unsupported_file_type" },
        })}
      />,
    );

    expect(html).toContain("Unsupported preview");
    expect(html).toContain("unsupported_file_type");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm run test -- src/components/workbench/file-preview.test.tsx
```

Expected: 测试失败，因为 `file-preview.tsx` 尚不存在。

- [ ] **Step 3: 实现 FilePreview**

创建 `web/src/components/workbench/file-preview.tsx`：

```tsx
import { FileCog, Info } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import type { FileReadResult } from "@/lib/types";

import { MarkdownReader } from "./markdown-reader";

export function FilePreview({ file }: { file: FileReadResult }) {
  if (file.mode === "preview") {
    if (file.relativePath.toLowerCase().endsWith(".md")) {
      return <MarkdownReader content={file.content ?? ""} />;
    }

    return <TextPreview content={file.content ?? ""} structured={isStructuredText(file.relativePath)} />;
  }

  if (file.mode === "metadata") {
    return (
      <ModeSummary
        icon={Info}
        title="Metadata only"
        description="This file type is surfaced as metadata and is not parsed in the workbench."
        metadata={file.metadata}
      />
    );
  }

  return (
    <ModeSummary
      icon={FileCog}
      title="Unsupported preview"
      description="This file cannot be opened for inline reading in the workbench."
      metadata={file.metadata}
    />
  );
}

function TextPreview({ content, structured }: { content: string; structured: boolean }) {
  if (content.length === 0) {
    return (
      <div className="rounded-[16px] border border-dashed border-black/10 bg-white/55 px-4 py-6 text-sm text-muted-foreground">
        This file is empty.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[18px] border border-black/8 bg-white/75">
      <div className="border-b border-black/5 px-4 py-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">
        Read-only preview
      </div>
      <pre
        className={
          structured
            ? "overflow-x-auto px-4 py-4 font-mono text-sm leading-6 text-[color:var(--ink-strong)]"
            : "whitespace-pre-wrap px-4 py-4 text-sm leading-7 text-[color:var(--ink-strong)]"
        }
      >
        {content}
      </pre>
    </div>
  );
}

function ModeSummary({
  icon: Icon,
  title,
  description,
  metadata,
}: {
  icon: typeof Info;
  title: string;
  description: string;
  metadata: Record<string, string | number | boolean | null>;
}) {
  const entries = Object.entries(metadata);

  return (
    <div className="space-y-4">
      <Alert className="border-black/10 bg-black/[0.02]">
        <Icon className="size-4" />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{description}</AlertDescription>
      </Alert>

      <div className="rounded-[18px] border border-black/8 bg-white/60 px-4 py-3">
        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">File summary</div>
        <Separator className="my-3 bg-black/8" />
        {entries.length > 0 ? (
          <div className="space-y-2 text-sm">
            {entries.map(([key, value]) => (
              <div key={key} className="flex items-start justify-between gap-3">
                <span className="font-medium capitalize text-[color:var(--ink-strong)]">{key}</span>
                <span className="text-right text-muted-foreground">{value === null ? "null" : String(value)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No additional metadata was returned.</p>
        )}
      </div>
    </div>
  );
}

function isStructuredText(relativePath: string) {
  return /\.(json|ya?ml)$/i.test(relativePath);
}
```

- [ ] **Step 4: 运行测试**

Run:

```bash
npm run test -- src/components/workbench/file-preview.test.tsx src/components/workbench/markdown-reader.test.tsx
npm run typecheck
```

Expected: 测试和 typecheck 通过。

- [ ] **Step 5: 提交**

Run:

```bash
git add web/src/components/workbench/file-preview.tsx web/src/components/workbench/file-preview.test.tsx
git commit -m "feat: add file preview components"
```

Expected: commit 成功。

---

### Task 3: FilePanel 阅读优先集成

**Files:**
- Modify: `web/src/components/workbench/file-panel.tsx`
- Test: `web/src/components/workbench/markdown-reader.test.tsx`
- Test: `web/src/components/workbench/file-preview.test.tsx`

- [ ] **Step 1: 更新 imports**

在 `file-panel.tsx` 中移除不再需要的 `FileCog`、`Info`、`Separator` import，新增：

```ts
import { Edit3, Eye } from "lucide-react";
import { useEffect, useState } from "react";
import { FilePreview } from "@/components/workbench/file-preview";
import { MarkdownReader } from "@/components/workbench/markdown-reader";
```

- [ ] **Step 2: 增加 view mode**

在 `FilePanel` 组件内加入：

```ts
const [fileView, setFileView] = useState<"read" | "edit">("read");

useEffect(() => {
  setFileView("read");
}, [file?.relativePath]);

useEffect(() => {
  if (dirty) {
    setFileView("edit");
  }
}, [dirty]);
```

- [ ] **Step 3: 重构 editable 分支**

将 `file.mode === "editable"` 分支替换为：

```tsx
        {file.mode === "editable" ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-black/8 bg-white/55 px-3 py-2">
              <span className="text-sm text-muted-foreground">
                {fileView === "read" ? "Reading rendered Markdown." : "Editing Markdown source."}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={fileView === "read" ? "secondary" : "outline"}
                  onClick={() => setFileView("read")}
                  disabled={saving}
                >
                  <Eye className="size-4" />
                  Read
                </Button>
                <Button
                  size="sm"
                  variant={fileView === "edit" ? "secondary" : "outline"}
                  onClick={() => setFileView("edit")}
                >
                  <Edit3 className="size-4" />
                  Edit
                </Button>
              </div>
            </div>

            {fileView === "read" ? <MarkdownReader content={draft} /> : null}

            {fileView === "edit" ? (
              <div className="space-y-4">
                <Textarea
                  value={draft}
                  onChange={(event) => onDraftChange(event.target.value)}
                  className="min-h-[420px] resize-y rounded-[20px] border-black/10 bg-white/70 font-mono text-sm leading-7"
                />
                <div className="flex flex-wrap items-center gap-3">
                  <Button onClick={onSave} disabled={!dirty || saving}>
                    <Save className="size-4" />
                    {saving ? "Saving..." : "Save changes"}
                  </Button>
                  <Button variant="outline" onClick={onReset} disabled={!dirty || saving}>
                    Reset draft
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Manual save only. Unsaved edits stay local in the panel.
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
```

- [ ] **Step 4: 重构 preview / metadata / unsupported 分支**

替换原 `ReadonlyContent`、`ModeAlert` 分支为：

```tsx
        {file.mode !== "editable" ? <FilePreview file={file} /> : null}
```

删除文件底部不再使用的 `ReadonlyContent` 和 `ModeAlert` helper。

- [ ] **Step 5: 运行验证**

Run:

```bash
npm run test -- src/components/workbench/markdown-reader.test.tsx src/components/workbench/file-preview.test.tsx src/stores/workbench-store.test.ts src/components/workbench/draft-guard.test.ts
npm run typecheck
```

Expected: 测试和 typecheck 通过。

- [ ] **Step 6: 提交**

Run:

```bash
git add web/src/components/workbench/file-panel.tsx
git commit -m "feat: make file panel reading first"
```

Expected: commit 成功。

---

### Task 4: Project Overview 结构摘要

**Files:**
- Modify: `web/src/components/workbench/project-overview.tsx`
- Create: `web/src/components/workbench/project-overview.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `web/src/components/workbench/project-overview.test.tsx`：

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { FileTreeNode, ProjectDetail } from "@/lib/types";

import { ProjectOverview } from "./project-overview";

const project: ProjectDetail = {
  id: "demo",
  name: "Demo",
  status: "ready",
  hasPurpose: true,
  hasSchema: true,
  hasWikiDirectory: true,
  hasRawSourcesDirectory: true,
  updatedAt: null,
  sections: ["Overview", "Files", "Purpose", "Schema", "Project Info"],
  rootPathHint: null,
};

const tree: FileTreeNode[] = [
  { name: "purpose.md", relativePath: "purpose.md", nodeType: "file" },
  { name: "schema.md", relativePath: "schema.md", nodeType: "file" },
  {
    name: "wiki",
    relativePath: "wiki",
    nodeType: "directory",
    children: [
      { name: "index.md", relativePath: "wiki/index.md", nodeType: "file" },
      { name: "notes.txt", relativePath: "wiki/notes.txt", nodeType: "file" },
    ],
  },
  {
    name: "raw",
    relativePath: "raw",
    nodeType: "directory",
    children: [
      { name: "sources", relativePath: "raw/sources", nodeType: "directory", children: [
        { name: "demo.pdf", relativePath: "raw/sources/demo.pdf", nodeType: "file" },
      ] },
    ],
  },
];

describe("ProjectOverview", () => {
  it("renders reading-oriented structure metrics", () => {
    const html = renderToStaticMarkup(
      <ProjectOverview project={project} tree={tree} onChangeSection={() => {}} />,
    );

    expect(html).toContain("Markdown files");
    expect(html).toContain("Preview files");
    expect(html).toContain("Metadata files");
    expect(html).toContain("Start with wiki");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm run test -- src/components/workbench/project-overview.test.tsx
```

Expected: 测试失败，因为新文案尚不存在。

- [ ] **Step 3: 增强 ProjectOverview**

在 `project-overview.tsx` 中新增统计：

```ts
const readingStats = collectReadingStats(tree);
```

在 snapshot card 中新增：

```tsx
<Metric label="Markdown files" value={String(readingStats.markdownFiles)} />
<Metric label="Preview files" value={String(readingStats.previewFiles)} />
<Metric label="Metadata files" value={String(readingStats.metadataFiles)} />
```

将 Wiki action card 标题或 actionLabel 更新为：

```tsx
title="Start with wiki"
actionLabel="Start with wiki"
```

在文件底部新增：

```ts
function collectReadingStats(nodes: FileTreeNode[]) {
  const stats = {
    markdownFiles: 0,
    previewFiles: 0,
    metadataFiles: 0,
    unsupportedFiles: 0,
  };

  for (const node of nodes) {
    if (node.nodeType === "directory") {
      const childStats = collectReadingStats(node.children ?? []);
      stats.markdownFiles += childStats.markdownFiles;
      stats.previewFiles += childStats.previewFiles;
      stats.metadataFiles += childStats.metadataFiles;
      stats.unsupportedFiles += childStats.unsupportedFiles;
      continue;
    }

    const relativePath = node.relativePath.toLowerCase();

    if (relativePath.endsWith(".md")) {
      stats.markdownFiles += 1;
    } else if (/\.(txt|json|ya?ml)$/.test(relativePath)) {
      stats.previewFiles += 1;
    } else if (/\.(pdf|docx|pptx|xlsx)$/.test(relativePath)) {
      stats.metadataFiles += 1;
    } else {
      stats.unsupportedFiles += 1;
    }
  }

  return stats;
}
```

- [ ] **Step 4: 运行测试**

Run:

```bash
npm run test -- src/components/workbench/project-overview.test.tsx
npm run typecheck
```

Expected: 测试和 typecheck 通过。

- [ ] **Step 5: 提交**

Run:

```bash
git add web/src/components/workbench/project-overview.tsx web/src/components/workbench/project-overview.test.tsx
git commit -m "feat: enrich project overview reading metrics"
```

Expected: commit 成功。

---

### Task 5: 全量验证与 roadmap 更新

**Files:**
- Modify: `web/docs/web-roadmap-next-phases.md`

- [ ] **Step 1: 运行阶段 3 验证命令**

Run:

```bash
npm run test
npm run typecheck
npm run lint
```

Expected: 三个命令通过。`lint` 当前允许 warning，但不能有 error。

- [ ] **Step 2: 更新 roadmap**

在 `web/docs/web-roadmap-next-phases.md` 的阶段 3 标题下方加入：

```md
> 状态：已完成。阶段 3 已按 [spec](../../docs/superpowers/specs/2026-04-26-phase-3-reading-preview-design.md) 和 [implementation plan](../../docs/superpowers/plans/2026-04-26-phase-3-reading-preview.md) 落地，覆盖 Markdown 阅读视图、只读文件预览、阅读 / 编辑切换、项目结构摘要和关键测试。
```

- [ ] **Step 3: 检查 roadmap 链接和状态**

Run:

```bash
rg -n "状态：已完成|phase-3-reading-preview" web/docs/web-roadmap-next-phases.md
```

Expected: 输出包含阶段 3 完成状态、spec 链接和 plan 链接。

- [ ] **Step 4: 提交**

Run:

```bash
git add web/docs/web-roadmap-next-phases.md
git commit -m "docs: mark phase 3 roadmap complete"
```

Expected: commit 成功。

---

## 执行顺序

1. Task 1 和 Task 2 可并行。
2. Task 3 依赖 Task 1 和 Task 2。
3. Task 4 可与 Task 3 并行，但最终视觉一致性要在 Task 3 后复查。
4. Task 5 必须最后执行。

## 完成定义

- 阶段 3 spec 的 9 条验收标准全部满足。
- `npm run test`、`npm run typecheck`、`npm run lint` 已运行并记录结果。
- roadmap 已标记阶段 3 完成。
- 没有混入搜索、RAG、图谱、富文本编辑器或通用文件查看器能力。
