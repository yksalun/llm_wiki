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
import type { FileTreeNode, ProjectDetail, WorkbenchSection } from "@/lib/types";

interface ProjectOverviewProps {
  project: ProjectDetail;
  tree: FileTreeNode[];
  onChangeSection: (section: WorkbenchSection) => void;
}

export function ProjectOverview({
  project,
  tree,
  onChangeSection,
}: ProjectOverviewProps) {
  const fileCount = countFiles(tree);
  const directoryCount = countDirectories(tree);
  const readingStats = collectReadingStats(tree);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Card className="border-[color:var(--paper-border)] bg-[linear-gradient(180deg,rgba(255,252,246,0.94),rgba(246,240,232,0.88))] shadow-[0_18px_56px_rgba(61,52,40,0.08)]">
        <CardHeader className="border-b border-black/5">
          <CardTitle>Workbench overview</CardTitle>
          <CardDescription>
            Open the editorial files directly, or move into the full file browser.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 pt-4 md:grid-cols-2">
          <ActionCard
            icon={BookOpenText}
            title="Purpose dossier"
            description={
              project.hasPurpose
                ? "Open purpose.md directly in the editor."
                : "No purpose.md file is available yet."
            }
            actionLabel={project.hasPurpose ? "Open purpose.md" : "Purpose missing"}
            disabled={!project.hasPurpose}
            onClick={() => onChangeSection("Purpose")}
          />
          <ActionCard
            icon={LayoutPanelTop}
            title="Schema map"
            description={
              project.hasSchema
                ? "Open schema.md directly in the editor."
                : "No schema.md file is available yet."
            }
            actionLabel={project.hasSchema ? "Open schema.md" : "Schema missing"}
            disabled={!project.hasSchema}
            onClick={() => onChangeSection("Schema")}
          />
          <ActionCard
            icon={FolderArchive}
            title="Full file browser"
            description="Browse the whole project tree from the Files section."
            actionLabel="Open file browser"
            onClick={() => onChangeSection("Files")}
          />
          <ActionCard
            icon={FileSearch}
            title="Wiki directory"
            description="Move into the Files section and browse the wiki records from the tree."
            actionLabel="Start with wiki"
            disabled={!hasPath(tree, "wiki")}
            onClick={() => onChangeSection("Files")}
          />
        </CardContent>
      </Card>

      <Card className="border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]/92 shadow-[0_16px_48px_rgba(61,52,40,0.08)]">
        <CardHeader className="border-b border-black/5">
          <CardTitle className="text-sm uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">
            Project Snapshot
          </CardTitle>
          <CardDescription>Quick structural context for this dossier.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <Metric label="Status" value={project.status} />
          <Metric label="Sections" value={String(project.sections.length)} />
          <Metric label="Files in tree" value={String(fileCount)} />
          <Metric label="Directories" value={String(directoryCount)} />
          <Metric label="Markdown files" value={String(readingStats.markdownFiles)} />
          <Metric label="Preview files" value={String(readingStats.previewFiles)} />
          <Metric label="Metadata files" value={String(readingStats.metadataFiles)} />
          <Metric label="Project ID" value={project.id} mono />
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
    <div className="rounded-[24px] border border-black/8 bg-white/60 p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-full border border-black/8 bg-[color:var(--paper-accent)]/20 p-2 text-[color:var(--ink-soft)]">
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

      if (extension === ".md") {
        return { ...stats, markdownFiles: stats.markdownFiles + 1 };
      }

      if ([".txt", ".json", ".yaml", ".yml"].includes(extension)) {
        return { ...stats, previewFiles: stats.previewFiles + 1 };
      }

      if ([".pdf", ".docx", ".pptx", ".xlsx"].includes(extension)) {
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

function getFileExtension(fileName: string): string {
  const extensionStart = fileName.lastIndexOf(".");

  if (extensionStart === -1) {
    return "";
  }

  return fileName.slice(extensionStart).toLowerCase();
}

function hasPath(nodes: FileTreeNode[], relativePath: string): boolean {
  return nodes.some((node) => {
    if (node.relativePath === relativePath) {
      return true;
    }

    if (node.nodeType === "directory") {
      return hasPath(node.children ?? [], relativePath);
    }

    return false;
  });
}
