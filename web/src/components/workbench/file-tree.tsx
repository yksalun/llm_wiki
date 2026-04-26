"use client";

import { FileText, FolderOpen, FolderTree, LoaderCircle } from "lucide-react";

import { ScrollArea } from "@/components/ui/scroll-area";
import type { FileTreeNode } from "@/lib/types";
import { cn } from "@/lib/utils";

interface FileTreeProps {
  tree: FileTreeNode[];
  selectedPath: string | null;
  loadingPath: string | null;
  disabled?: boolean;
  onOpenFile: (relativePath: string) => void;
}

export function FileTree({
  tree,
  selectedPath,
  loadingPath,
  disabled,
  onOpenFile,
}: FileTreeProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[24px] border border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]/92 shadow-[0_16px_48px_rgba(61,52,40,0.08)]">
      <div className="border-b border-[color:var(--paper-border)] px-4 py-4">
        <div className="flex items-center gap-2 text-[color:var(--ink-strong)]">
          <FolderTree className="size-4 text-[color:var(--ink-soft)]" />
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em]">
            项目文件
          </h2>
        </div>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          浏览项目根目录，并在右侧面板打开单个记录。
        </p>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-2 py-3">
        {tree.length > 0 ? (
          <div className="space-y-1">
            {tree.map((node) => (
              <TreeNode
                key={node.relativePath}
                node={node}
                depth={0}
                selectedPath={selectedPath}
                loadingPath={loadingPath}
                disabled={disabled}
                onOpenFile={onOpenFile}
              />
            ))}
          </div>
        ) : (
          <div className="px-2 py-4 text-sm text-muted-foreground">
            这个项目没有返回文件。
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

interface TreeNodeProps {
  node: FileTreeNode;
  depth: number;
  selectedPath: string | null;
  loadingPath: string | null;
  disabled?: boolean;
  onOpenFile: (relativePath: string) => void;
}

function TreeNode({
  node,
  depth,
  selectedPath,
  loadingPath,
  disabled,
  onOpenFile,
}: TreeNodeProps) {
  if (node.nodeType === "directory") {
    return (
      <div>
        <div
          className="flex items-center gap-2 rounded-xl px-2 py-2 text-sm font-medium text-[color:var(--ink-strong)]"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          <FolderOpen className="size-4 text-[color:var(--ink-soft)]" />
          <span>{node.name}</span>
        </div>
        <div className="space-y-1">
          {node.children?.map((child) => (
            <TreeNode
              key={child.relativePath}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              loadingPath={loadingPath}
              disabled={disabled}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      </div>
    );
  }

  const active = selectedPath === node.relativePath;
  const loading = loadingPath === node.relativePath;

  return (
    <button
      type="button"
      onClick={() => onOpenFile(node.relativePath)}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm transition-colors hover:bg-[color:var(--paper-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--paper-panel)] disabled:pointer-events-none disabled:opacity-70",
        active
          ? "bg-[color:var(--paper-muted)] text-[color:var(--ink-strong)]"
          : "text-muted-foreground",
      )}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
    >
      {loading ? (
        <LoaderCircle className="size-4 shrink-0 animate-spin" />
      ) : (
        <FileText className="size-4 shrink-0" />
      )}
      <span className="truncate">{node.name}</span>
    </button>
  );
}
