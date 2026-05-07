"use client";

import type { ReactNode } from "react";
import { BookOpen } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  const selectItems = projects.map((project) => ({
    label: project.name,
    value: project.id,
  }));
  const hasProjects = projects.length > 0;

  return (
    <div
      data-knowledge-base-selector="true"
      className={cn(
        hasProjects
          ? "inline-flex max-w-full flex-wrap items-center gap-2"
          : "rounded-md border border-[color:var(--paper-border)] bg-[color:var(--paper-panel)] p-2",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 text-xs font-medium text-muted-foreground",
          hasProjects ? "shrink-0" : "mb-2",
        )}
      >
        <BookOpen className="size-3.5" aria-hidden="true" />
        知识库
      </div>
      {!hasProjects ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
          {emptyAction}
        </div>
      ) : (
        <Select
          items={selectItems}
          value={selectedProject?.id ?? null}
          disabled={disabled}
          onValueChange={(value) => {
            if (typeof value === "string") {
              onSelectProject(value);
            }
          }}
        >
          <SelectTrigger
            aria-label="选择知识库"
            className="w-64 max-w-[calc(100vw-5rem)] border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] text-[color:var(--ink-strong)]"
          >
            <SelectValue placeholder="选择知识库" />
          </SelectTrigger>
          <SelectContent align="start" className="max-h-56 min-w-64">
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
