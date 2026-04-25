import type { FileViewMode, WorkbenchSection } from "@/lib/types";

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
      return `You have unsaved changes. Save or discard them before opening ${intent.path}.`;
    case "open-section-file":
      return `You have unsaved changes. Save or discard them before opening ${intent.section} in ${intent.path}.`;
    case "reload-project":
      return "You have unsaved changes. Save or discard them before reloading the project.";
    case "show-missing-section-file":
      return `You have unsaved changes. Save or discard them before opening ${intent.section}. ${intent.path} is not available.`;
  }
}
