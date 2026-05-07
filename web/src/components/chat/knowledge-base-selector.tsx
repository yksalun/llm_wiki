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
            className="w-full border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] text-[color:var(--ink-strong)]"
          >
            <SelectValue placeholder="选择知识库" />
          </SelectTrigger>
          <SelectContent align="start" className="max-h-56">
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
