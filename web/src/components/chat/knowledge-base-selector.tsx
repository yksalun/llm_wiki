"use client";

import type { ReactNode } from "react";
import { BookOpen, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ProjectSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface KnowledgeBaseSelectorProps {
  projects: ProjectSummary[];
  selectedProjectId: string | null;
  disabled?: boolean;
  emptyMessage?: string;
  emptyAction?: ReactNode;
  onSelectProject: (projectId: string) => void;
}

export function KnowledgeBaseSelector({
  projects,
  selectedProjectId,
  disabled = false,
  emptyMessage = "暂无知识库",
  emptyAction,
  onSelectProject,
}: KnowledgeBaseSelectorProps) {
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;

  return (
    <div
      data-knowledge-base-selector="true"
      className="rounded-md border border-[color:var(--paper-border)] bg-[color:var(--paper-panel)] p-2"
    >
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <BookOpen className="size-3.5" aria-hidden="true" />
        知识库
      </div>
      {projects.length === 0 ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
          {emptyAction}
        </div>
      ) : (
        <ScrollArea className="max-h-44">
          <div className="space-y-1 pr-2">
            {projects.map((project) => {
              const selected = project.id === selectedProject?.id;

              return (
                <Button
                  key={project.id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-current={selected ? "true" : undefined}
                  disabled={disabled}
                  className={cn(
                    "h-auto w-full justify-start gap-2 whitespace-normal px-2 py-2 text-left",
                    selected
                      ? "bg-[color:var(--paper-muted)] text-[color:var(--ink-strong)]"
                      : "text-muted-foreground",
                  )}
                  onClick={() => onSelectProject(project.id)}
                >
                  <Check
                    className={cn("size-3.5", selected ? "opacity-100" : "opacity-0")}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate">{project.name}</span>
                </Button>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
