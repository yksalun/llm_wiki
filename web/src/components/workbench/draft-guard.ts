type FileMode = "editable" | "readonly";

export type PendingWorkbenchIntent =
  | {
      type: "open-file";
      path: string;
    }
  | {
      type: "open-section-file";
      path: string;
      section: string;
    }
  | {
      type: "reload-project";
    };

export function hasBlockingDraft({
  dirty,
  saving,
  fileMode,
}: {
  dirty: boolean;
  saving: boolean;
  fileMode: FileMode;
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
  }
}
