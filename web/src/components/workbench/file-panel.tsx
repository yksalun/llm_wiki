"use client";

import { AlertCircle, FileCog, FileText, Info, Save } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import type { FileReadResult, WorkbenchSection } from "@/lib/types";

export interface FilePanelNotice {
  tone: "error" | "warning";
  title: string;
  message: string;
}

interface FilePanelProps {
  section: WorkbenchSection;
  selectedPath: string | null;
  file: FileReadResult | null;
  draft: string;
  dirty: boolean;
  saving: boolean;
  loading: boolean;
  notice: FilePanelNotice | null;
  onDraftChange: (draft: string) => void;
  onSave: () => void;
  onReset: () => void;
}

export function FilePanel({
  section,
  selectedPath,
  file,
  draft,
  dirty,
  saving,
  loading,
  notice,
  onDraftChange,
  onSave,
  onReset,
}: FilePanelProps) {
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

        {file.mode === "editable" ? (
          <div className="space-y-4">
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
              <Button variant="outline" onClick={onReset} disabled={!dirty || saving}>
                Reset draft
              </Button>
              <span className="text-sm text-muted-foreground">
                Manual save only. Unsaved edits stay local in the panel.
              </span>
            </div>
          </div>
        ) : null}

        {file.mode === "preview" ? (
          <ReadonlyContent content={file.content ?? ""} />
        ) : null}

        {file.mode === "metadata" ? (
          <ModeAlert
            icon={Info}
            title="Metadata only"
            description="This file type is surfaced as metadata in the workbench and cannot be edited here."
            metadata={file.metadata}
          />
        ) : null}

        {file.mode === "unsupported" ? (
          <ModeAlert
            icon={FileCog}
            title="Unsupported preview"
            description="The current file type or size is not supported for inline display."
            metadata={file.metadata}
          />
        ) : null}
      </div>
    </PanelCard>
  );
}

function PanelCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
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

function ReadonlyContent({ content }: { content: string }) {
  return (
    <div className="overflow-hidden rounded-[20px] border border-black/8 bg-white/70">
      <div className="border-b border-black/5 px-4 py-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">
        Read-only preview
      </div>
      <pre className="overflow-x-auto px-4 py-4 font-mono text-sm leading-7 whitespace-pre-wrap text-[color:var(--ink-strong)]">
        {content}
      </pre>
    </div>
  );
}

function ModeAlert({
  icon: Icon,
  title,
  description,
  metadata,
}: {
  icon: typeof Info;
  title: string;
  description: string;
  metadata: Record<string, string | number | boolean | null>;
}) {
  const entries = Object.entries(metadata);

  return (
    <div className="space-y-4">
      <Alert className="border-black/10 bg-black/[0.02]">
        <Icon className="size-4" />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{description}</AlertDescription>
      </Alert>

      {entries.length > 0 ? (
        <div className="rounded-[20px] border border-black/8 bg-white/60 px-4 py-3">
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Metadata
          </div>
          <Separator className="my-3 bg-black/8" />
          <div className="space-y-2 text-sm">
            {entries.map(([key, value]) => (
              <div key={key} className="flex items-start justify-between gap-3">
                <span className="font-medium capitalize text-[color:var(--ink-strong)]">
                  {key}
                </span>
                <span className="text-right text-muted-foreground">
                  {value === null ? "null" : String(value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
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
