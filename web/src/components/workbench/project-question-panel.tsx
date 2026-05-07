"use client";

import { ChatExperience } from "@/components/chat/chat-experience";

interface ProjectQuestionPanelProps {
  projectId: string;
  onOpenFile: (relativePath: string) => void;
}

export function ProjectQuestionPanel({ projectId }: ProjectQuestionPanelProps) {
  return (
    <section className="rounded-lg border border-[color:var(--paper-border)] bg-[color:var(--paper-panel)] p-3">
      <ChatExperience
        key={projectId}
        projectId={projectId}
        mode="project"
        title="项目问答"
        showSessionList
      />
    </section>
  );
}
