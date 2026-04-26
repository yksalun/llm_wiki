"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { AlertCircle, Edit3, Eye, FileText, RefreshCcw, Save } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { FilePreview } from "@/components/workbench/file-preview";
import { MarkdownReader } from "@/components/workbench/markdown-reader";
import type { FileReadResult, WorkbenchSection } from "@/lib/types";
import type { FileConflictState, SaveStatus } from "@/stores/workbench-store";

export interface FilePanelNotice {
  tone: "error" | "warning";
  title: string;
  message: string;
}

export interface DraftGuardPrompt {
  message: string;
  saving: boolean;
  onSaveAndContinue: () => void;
  onDiscardAndContinue: () => void;
  onCancel: () => void;
}

interface FilePanelProps {
  section: WorkbenchSection;
  selectedPath: string | null;
  file: FileReadResult | null;
  draft: string;
  dirty: boolean;
  saving: boolean;
  refreshing: boolean;
  loading: boolean;
  lastSaveStatus: SaveStatus;
  lastSavedAt: string | null;
  conflict: FileConflictState | null;
  draftGuardPrompt: DraftGuardPrompt | null;
  notice: FilePanelNotice | null;
  onDraftChange: (draft: string) => void;
  onSave: () => void;
  onReset: () => void;
  onReloadRemote: () => void;
}

type FileView = "read" | "edit";

interface FileViewState {
  path: string | null;
  view: FileView;
  dirty: boolean;
}

export function FilePanel({
  section,
  selectedPath,
  file,
  draft,
  dirty,
  saving,
  refreshing,
  loading,
  lastSaveStatus,
  lastSavedAt,
  conflict,
  draftGuardPrompt,
  notice,
  onDraftChange,
  onSave,
  onReset,
  onReloadRemote,
}: FilePanelProps) {
  const currentFilePath = file?.relativePath ?? null;
  const [fileViewState, setFileViewState] = useState<FileViewState>(() => ({
    path: currentFilePath,
    view: dirty ? "edit" : "read",
    dirty,
  }));
  let fileView = fileViewState.view;

  if (fileViewState.path !== currentFilePath) {
    fileView = "read";
    setFileViewState({ path: currentFilePath, view: "read", dirty });
  } else if (!fileViewState.dirty && dirty) {
    fileView = "edit";
    setFileViewState({ path: currentFilePath, view: "edit", dirty });
  } else if (fileViewState.dirty !== dirty) {
    setFileViewState({ ...fileViewState, dirty });
  }

  const updateFileView = (view: FileView) => {
    setFileViewState({ path: currentFilePath, view, dirty });
  };

  const resetDraft = () => {
    onReset();
    updateFileView("read");
  };

  if (loading) {
    return (
      <PanelCard
        title={selectedPath ? `Opening ${selectedPath}` : "Opening file"}
        description="The workbench is reading the requested file from the project route."
      >
        <div className="rounded-[20px] border border-dashed border-black/10 bg-black/[0.02] p-5 text-sm text-muted-foreground">
          Loading file content...
        </div>
      </PanelCard>
    );
  }

  if (!file && notice) {
    return (
      <PanelCard
        title={selectedPath ? `Unable to open ${selectedPath}` : getEmptyPanelTitle(section)}
        description="The request completed with an error, so no inline file content is available."
      >
        <div className="space-y-4">
          <Alert
            variant={notice.tone === "error" ? "destructive" : "default"}
            className={
              notice.tone === "error"
                ? "border-destructive/20 bg-destructive/5"
                : "border-amber-900/15 bg-amber-700/5 text-amber-950"
            }
          >
            <AlertCircle className="size-4" />
            <AlertTitle>{notice.title}</AlertTitle>
            <AlertDescription>{notice.message}</AlertDescription>
          </Alert>
          <div className="rounded-[20px] border border-dashed border-black/10 bg-[linear-gradient(180deg,rgba(255,252,246,0.65),rgba(245,239,229,0.42))] p-6 text-sm leading-7 text-muted-foreground">
            {getEmptyPanelMessage(section, selectedPath)}
          </div>
        </div>
      </PanelCard>
    );
  }

  if (!file) {
    return (
      <PanelCard
        title={getEmptyPanelTitle(section)}
        description={getEmptyPanelDescription(section)}
      >
        <div className="rounded-[20px] border border-dashed border-black/10 bg-[linear-gradient(180deg,rgba(255,252,246,0.65),rgba(245,239,229,0.42))] p-6 text-sm leading-7 text-muted-foreground">
          {getEmptyPanelMessage(section, selectedPath)}
        </div>
      </PanelCard>
    );
  }

  return (
    <PanelCard title={file.relativePath} description={buildDescription(file)}>
      <div className="space-y-4">
        <FileFacts file={file} dirty={dirty} />

        <SaveStatusMessage
          refreshing={refreshing}
          lastSaveStatus={lastSaveStatus}
          lastSavedAt={lastSavedAt}
          conflict={conflict}
          onReloadRemote={onReloadRemote}
        />

        {notice ? (
          <Alert
            variant={notice.tone === "error" ? "destructive" : "default"}
            className={
              notice.tone === "error"
                ? "border-destructive/20 bg-destructive/5"
                : "border-amber-900/15 bg-amber-700/5 text-amber-950"
            }
          >
            <AlertCircle className="size-4" />
            <AlertTitle>{notice.title}</AlertTitle>
            <AlertDescription>{notice.message}</AlertDescription>
          </Alert>
        ) : null}

        {draftGuardPrompt ? <DraftGuardAlert prompt={draftGuardPrompt} /> : null}

        {file.mode === "editable" ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-black/8 bg-white/55 p-3">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={fileView === "read" ? "default" : "outline"}
                  aria-pressed={fileView === "read"}
                  onClick={() => updateFileView("read")}
                  disabled={saving}
                >
                  <Eye className="size-4" />
                  Read
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={fileView === "edit" ? "default" : "outline"}
                  aria-pressed={fileView === "edit"}
                  onClick={() => updateFileView("edit")}
                  disabled={saving}
                >
                  <Edit3 className="size-4" />
                  Edit
                </Button>
              </div>
              <span className="text-sm text-muted-foreground">
                {fileView === "read" ? "Reading draft preview" : "Editing local draft"}
              </span>
            </div>

            {fileView === "read" ? <MarkdownReader content={draft} /> : null}

            {fileView === "edit" ? (
              <>
                <Textarea
                  value={draft}
                  onChange={(event) => onDraftChange(event.target.value)}
                  className="min-h-[420px] resize-y rounded-[20px] border-black/10 bg-white/70 font-mono text-sm leading-7"
                />
                <div className="flex flex-wrap items-center gap-3">
                  <Button onClick={onSave} disabled={!dirty || saving}>
                    <Save className="size-4" />
                    {saving ? "Saving..." : "Save changes"}
                  </Button>
                  <Button variant="outline" onClick={resetDraft} disabled={!dirty || saving}>
                    Reset draft
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Manual save only. Unsaved edits stay local in the panel.
                  </span>
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {file.mode !== "editable" ? <FilePreview file={file} /> : null}
      </div>
    </PanelCard>
  );
}

function DraftGuardAlert({ prompt }: { prompt: DraftGuardPrompt }) {
  return (
    <Alert className="border-amber-900/15 bg-amber-700/5 text-amber-950">
      <AlertCircle className="size-4" />
      <AlertTitle>Unsaved draft</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>{prompt.message}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={prompt.onSaveAndContinue} disabled={prompt.saving}>
            <Save className="size-4" />
            {prompt.saving ? "Saving..." : "Save and continue"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={prompt.onDiscardAndContinue}
            disabled={prompt.saving}
          >
            Discard draft
          </Button>
          <Button size="sm" variant="ghost" onClick={prompt.onCancel} disabled={prompt.saving}>
            Cancel
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

function SaveStatusMessage({
  refreshing,
  lastSaveStatus,
  lastSavedAt,
  conflict,
  onReloadRemote,
}: {
  refreshing: boolean;
  lastSaveStatus: SaveStatus;
  lastSavedAt: string | null;
  conflict: FileConflictState | null;
  onReloadRemote: () => void;
}) {
  if (refreshing) {
    return (
      <p className="text-sm text-muted-foreground">
        Refreshing saved file from disk...
      </p>
    );
  }

  if (lastSaveStatus === "idle") {
    return null;
  }

  if (lastSaveStatus === "success") {
    return (
      <p className="text-sm text-emerald-700">
        Saved{lastSavedAt ? ` at ${formatSavedAt(lastSavedAt)}` : ""}.
      </p>
    );
  }

  if (lastSaveStatus === "failed") {
    return <p className="text-sm text-destructive">Save failed. Your draft is still local.</p>;
  }

  if (lastSaveStatus === "refresh_failed") {
    return (
      <p className="text-sm text-amber-800">
        Saved{lastSavedAt ? ` at ${formatSavedAt(lastSavedAt)}` : ""}, but refresh failed.
      </p>
    );
  }

  if (lastSaveStatus === "conflict") {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-[16px] border border-amber-900/15 bg-amber-700/5 px-4 py-3 text-sm text-amber-950">
        <span>
          Conflict{conflict?.relativePath ? ` in ${conflict.relativePath}` : ""}. Your draft was not
          saved.
        </span>
        <Button size="sm" variant="outline" onClick={onReloadRemote}>
          <RefreshCcw className="size-4" />
          Reload remote
        </Button>
      </div>
    );
  }
}

function formatSavedAt(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function PanelCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card className="h-full border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]/92 shadow-[0_18px_56px_rgba(61,52,40,0.08)]">
      <CardHeader className="border-b border-black/5">
        <CardTitle className="flex items-center gap-2 text-[color:var(--ink-strong)]">
          <FileText className="size-4 text-[color:var(--ink-soft)]" />
          <span className="truncate">{title}</span>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="pt-4">{children}</CardContent>
    </Card>
  );
}

function FileFacts({ file, dirty }: { file: FileReadResult; dirty: boolean }) {
  return (
    <div className="grid gap-3 rounded-[20px] border border-black/8 bg-white/55 p-4 md:grid-cols-4">
      <Fact label="Mode" value={file.mode} />
      <Fact label="Editable" value={file.editable ? "Yes" : "No"} />
      <Fact label="Size" value={`${file.size} bytes`} />
      <Fact label="Status" value={dirty ? "Unsaved changes" : "In sync"} />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium text-[color:var(--ink-strong)]">{value}</p>
    </div>
  );
}

function buildDescription(file: FileReadResult) {
  if (file.mode === "editable") {
    return "Markdown files allowed by the file policy can be edited and saved manually.";
  }

  if (file.mode === "preview") {
    return "This file is available for read-only preview in the workbench.";
  }

  if (file.mode === "metadata") {
    return "This file is represented as metadata instead of inline content.";
  }

  return "This file cannot be opened for inline editing in the workbench.";
}

function getEmptyPanelTitle(section: WorkbenchSection) {
  if (section === "Purpose") {
    return "Purpose file";
  }

  if (section === "Schema") {
    return "Schema file";
  }

  return "No file selected";
}

function getEmptyPanelDescription(section: WorkbenchSection) {
  if (section === "Purpose") {
    return "This section opens purpose.md when the project includes it.";
  }

  if (section === "Schema") {
    return "This section opens schema.md when the project includes it.";
  }

  return "Choose a file from the tree, or use the section shortcuts above.";
}

function getEmptyPanelMessage(
  section: WorkbenchSection,
  selectedPath: string | null,
) {
  if (selectedPath) {
    return `The workbench kept ${selectedPath} selected so you can retry or choose another file from the tree.`;
  }

  if (section === "Purpose") {
    return "purpose.md will render here when the project exposes that file.";
  }

  if (section === "Schema") {
    return "schema.md will render here when the project exposes that file.";
  }

  return "The panel stays empty until a project file is opened.";
}
