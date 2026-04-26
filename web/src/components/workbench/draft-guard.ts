import type { FileViewMode, WorkbenchSection } from "@/lib/types";
import { formatWorkbenchSectionLabel } from "@/lib/display-labels";

export type PendingWorkbenchIntent =
  | {
      type: "open-file";
      path: string;
    }
  | {
      type: "open-section-file";
      path: string;
      section: WorkbenchSection;
    }
  | {
      type: "reload-project";
    }
  | {
      type: "show-missing-section-file";
      path: string;
      section: WorkbenchSection;
      title: string;
      message: string;
    };

export function hasBlockingDraft({
  dirty,
  saving,
  fileMode,
}: {
  dirty: boolean;
  saving: boolean;
  fileMode: FileViewMode | null;
}) {
  return dirty && !saving && fileMode === "editable";
}

export function buildPendingDraftMessage(intent: PendingWorkbenchIntent) {
  switch (intent.type) {
    case "open-file":
      return `你有未保存修改。请先保存或放弃草稿，再打开 ${intent.path}。`;
    case "open-section-file":
      return `你有未保存修改。请先保存或放弃草稿，再打开${formatWorkbenchSectionLabel(intent.section)} ${intent.path}。`;
    case "reload-project":
      return "你有未保存修改。请先保存或放弃草稿，再重新加载项目。";
    case "show-missing-section-file":
      return `你有未保存修改。请先保存或放弃草稿，再打开${formatWorkbenchSectionLabel(intent.section)}。${intent.path} 不可用。`;
  }
}
