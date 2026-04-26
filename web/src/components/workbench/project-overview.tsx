"use client";

import { BookOpenText, FileSearch, FolderArchive, LayoutPanelTop } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getFileExtension,
  isMarkdownFileExtension,
  isMetadataFileExtension,
  isPreviewFileExtension,
} from "@/lib/file-view-policy";
import { formatProjectStatusLabel } from "@/lib/display-labels";
import type { FileTreeNode, ProjectDetail, WorkbenchSection } from "@/lib/types";

interface ProjectOverviewProps {
  project: ProjectDetail;
  tree: FileTreeNode[];
  onChangeSection: (section: WorkbenchSection) => void;
  onOpenFile?: (relativePath: string) => void;
}

export function ProjectOverview({
  project,
  tree,
  onChangeSection,
  onOpenFile,
}: ProjectOverviewProps) {
  const fileCount = countFiles(tree);
  const directoryCount = countDirectories(tree);
  const readingStats = collectReadingStats(tree);
  const preferredWikiMarkdownPath = findPreferredWikiMarkdownPath(tree);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Card className="border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]/92 shadow-[0_18px_56px_rgba(61,52,40,0.08)]">
        <CardHeader className="border-b border-[color:var(--paper-border)]">
          <CardTitle>工作台概览</CardTitle>
          <CardDescription>
            直接打开核心编辑文件，或进入完整文件浏览器。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 pt-4 md:grid-cols-2">
          <ActionCard
            icon={BookOpenText}
            title="目标档案"
            description={
              project.hasPurpose
                ? "直接在编辑器中打开 purpose.md。"
                : "缺少目标文件。"
            }
            actionLabel={project.hasPurpose ? "打开 purpose.md" : "缺少目标文件"}
            disabled={!project.hasPurpose}
            onClick={() => onChangeSection("Purpose")}
          />
          <ActionCard
            icon={LayoutPanelTop}
            title="结构地图"
            description={
              project.hasSchema
                ? "直接在编辑器中打开 schema.md。"
                : "缺少结构文件。"
            }
            actionLabel={project.hasSchema ? "打开 schema.md" : "缺少结构文件"}
            disabled={!project.hasSchema}
            onClick={() => onChangeSection("Schema")}
          />
          <ActionCard
            icon={FolderArchive}
            title="完整文件浏览器"
            description="从文件区浏览整个项目树。"
            actionLabel="打开文件浏览器"
            onClick={() => onChangeSection("Files")}
          />
          <ActionCard
            icon={FileSearch}
            title="知识库目录"
            description={
              preferredWikiMarkdownPath
                ? "直接从项目树打开第一个知识库阅读文件。"
                : "缺少知识库标记文档。"
            }
            actionLabel="从知识库开始"
            disabled={!preferredWikiMarkdownPath}
            onClick={() => {
              if (preferredWikiMarkdownPath) {
                onOpenFile?.(preferredWikiMarkdownPath);
              }
            }}
          />
        </CardContent>
      </Card>

      <Card className="border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]/92 shadow-[0_16px_48px_rgba(61,52,40,0.08)]">
        <CardHeader className="border-b border-[color:var(--paper-border)]">
          <CardTitle className="text-sm uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">
            项目快照
          </CardTitle>
          <CardDescription>这个档案的快速结构上下文。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <Metric label="状态" value={formatProjectStatusLabel(project.status)} />
          <Metric label="工作区" value={String(project.sections.length)} />
          <Metric label="文件数" value={String(fileCount)} />
          <Metric label="目录数" value={String(directoryCount)} />
          <Metric label="标记文档" value={String(readingStats.markdownFiles)} />
          <Metric label="预览文件" value={String(readingStats.previewFiles)} />
          <Metric label="元数据文件" value={String(readingStats.metadataFiles)} />
          <Metric label="项目编号" value={project.id} mono />
        </CardContent>
      </Card>
    </div>
  );
}

function ActionCard({
  icon: Icon,
  title,
  description,
  actionLabel,
  disabled,
  onClick,
}: {
  icon: typeof BookOpenText;
  title: string;
  description: string;
  actionLabel: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <div className="rounded-[24px] border border-[color:var(--paper-border)] bg-[color:var(--paper-elevated)]/70 p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-full border border-[color:var(--paper-border)] bg-[color:var(--paper-accent)]/20 p-2 text-[color:var(--ink-soft)]">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-[color:var(--ink-strong)]">{title}</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
      </div>
      <Button className="mt-4" variant="outline" onClick={onClick} disabled={disabled}>
        {actionLabel}
      </Button>
    </div>
  );
}

function Metric({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className={mono ? "mt-1 font-mono text-sm text-[color:var(--ink-strong)]" : "mt-1 text-sm font-medium text-[color:var(--ink-strong)]"}>
        {value}
      </p>
    </div>
  );
}

function countFiles(nodes: FileTreeNode[]): number {
  return nodes.reduce((total, node) => {
    if (node.nodeType === "file") {
      return total + 1;
    }

    return total + countFiles(node.children ?? []);
  }, 0);
}

function countDirectories(nodes: FileTreeNode[]): number {
  return nodes.reduce((total, node) => {
    if (node.nodeType === "directory") {
      return total + 1 + countDirectories(node.children ?? []);
    }

    return total;
  }, 0);
}

interface ReadingStats {
  markdownFiles: number;
  previewFiles: number;
  metadataFiles: number;
  unsupportedFiles: number;
}

function collectReadingStats(nodes: FileTreeNode[]): ReadingStats {
  return nodes.reduce<ReadingStats>(
    (stats, node) => {
      if (node.nodeType === "directory") {
        const childStats = collectReadingStats(node.children ?? []);

        return {
          markdownFiles: stats.markdownFiles + childStats.markdownFiles,
          previewFiles: stats.previewFiles + childStats.previewFiles,
          metadataFiles: stats.metadataFiles + childStats.metadataFiles,
          unsupportedFiles: stats.unsupportedFiles + childStats.unsupportedFiles,
        };
      }

      const extension = getFileExtension(node.relativePath);

      if (isMarkdownFileExtension(extension)) {
        return { ...stats, markdownFiles: stats.markdownFiles + 1 };
      }

      if (isPreviewFileExtension(extension)) {
        return { ...stats, previewFiles: stats.previewFiles + 1 };
      }

      if (isMetadataFileExtension(extension)) {
        return { ...stats, metadataFiles: stats.metadataFiles + 1 };
      }

      return { ...stats, unsupportedFiles: stats.unsupportedFiles + 1 };
    },
    {
      markdownFiles: 0,
      previewFiles: 0,
      metadataFiles: 0,
      unsupportedFiles: 0,
    },
  );
}

function findPreferredWikiMarkdownPath(nodes: FileTreeNode[]): string | null {
  let firstWikiMarkdownPath: string | null = null;

  function visit(nextNodes: FileTreeNode[]) {
    for (const node of nextNodes) {
      if (node.nodeType === "file") {
        if (node.relativePath === "wiki/index.md") {
          firstWikiMarkdownPath = node.relativePath;
          return true;
        }

        if (
          firstWikiMarkdownPath === null &&
          node.relativePath.startsWith("wiki/") &&
          isMarkdownFileExtension(getFileExtension(node.relativePath))
        ) {
          firstWikiMarkdownPath = node.relativePath;
        }

        continue;
      }

      if (visit(node.children ?? [])) {
        return true;
      }
    }

    return false;
  }

  visit(nodes);

  return firstWikiMarkdownPath;
}
