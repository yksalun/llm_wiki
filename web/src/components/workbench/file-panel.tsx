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
import { formatFileModeLabel, formatWorkbenchSectionLabel } from "@/lib/display-labels";
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
        title={selectedPath ? `正在打开 ${selectedPath}` : "正在打开文件"}
        description="工作台正在从项目路径读取请求的文件。"
      >
        <div className="rounded-[20px] border border-dashed border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] p-5 text-sm text-muted-foreground">
          正在加载文件内容...
        </div>
      </PanelCard>
    );
  }

  if (!file && notice) {
    return (
      <PanelCard
        title={selectedPath ? `无法打开 ${selectedPath}` : getEmptyPanelTitle(section)}
        description="请求已返回错误，因此没有可内联显示的文件内容。"
      >
        <div className="space-y-4">
          <Alert
            variant={notice.tone === "error" ? "destructive" : "default"}
            className={
              notice.tone === "error"
                ? "border-destructive/20 bg-destructive/5"
                : "border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] text-[color:var(--ink-strong)]"
            }
          >
            <AlertCircle className="size-4" />
            <AlertTitle>{notice.title}</AlertTitle>
            <AlertDescription>{notice.message}</AlertDescription>
          </Alert>
          <div className="rounded-[20px] border border-dashed border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] p-6 text-sm leading-7 text-muted-foreground">
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
        <div className="rounded-[20px] border border-dashed border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] p-6 text-sm leading-7 text-muted-foreground">
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
                : "border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] text-[color:var(--ink-strong)]"
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
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] p-3">
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
                  阅读
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
                  编辑
                </Button>
              </div>
              <span className="text-sm text-muted-foreground">
                {fileView === "read" ? "正在阅读草稿预览" : "正在编辑本地草稿"}
              </span>
            </div>

            {fileView === "read" ? <MarkdownReader content={draft} /> : null}

            {fileView === "edit" ? (
              <>
                <Textarea
                  value={draft}
                  onChange={(event) => onDraftChange(event.target.value)}
                  className="min-h-[420px] resize-y rounded-[20px] border-[color:var(--paper-border)] bg-[color:var(--paper-panel)] font-mono text-sm leading-7"
                />
                <div className="flex flex-wrap items-center gap-3">
                  <Button onClick={onSave} disabled={!dirty || saving}>
                    <Save className="size-4" />
                    {saving ? "正在保存..." : "保存修改"}
                  </Button>
                  <Button variant="outline" onClick={resetDraft} disabled={!dirty || saving}>
                    重置草稿
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    仅手动保存。未保存编辑会保留在本面板的本地草稿中。
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

export function DraftGuardAlert({ prompt }: { prompt: DraftGuardPrompt }) {
  return (
    <Alert className="border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] text-[color:var(--ink-strong)]">
      <AlertCircle className="size-4" />
      <AlertTitle>未保存草稿</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>{prompt.message}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={prompt.onSaveAndContinue} disabled={prompt.saving}>
            <Save className="size-4" />
            {prompt.saving ? "正在保存..." : "保存并继续"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={prompt.onDiscardAndContinue}
            disabled={prompt.saving}
          >
            放弃草稿
          </Button>
          <Button size="sm" variant="ghost" onClick={prompt.onCancel} disabled={prompt.saving}>
            取消
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
        正在从磁盘刷新已保存文件...
      </p>
    );
  }

  if (lastSaveStatus === "idle") {
    return null;
  }

  if (lastSaveStatus === "success") {
    return (
      <p className="text-sm text-emerald-700">
        已保存{lastSavedAt ? `于 ${formatSavedAt(lastSavedAt)}` : ""}。
      </p>
    );
  }

  if (lastSaveStatus === "failed") {
    return <p className="text-sm text-destructive">保存失败。你的草稿仍保留在本地。</p>;
  }

  if (lastSaveStatus === "refresh_failed") {
    return (
      <p className="text-sm text-amber-800">
        已保存{lastSavedAt ? `于 ${formatSavedAt(lastSavedAt)}` : ""}，但刷新失败。你的草稿仍保留在本地。
      </p>
    );
  }

  if (lastSaveStatus === "conflict") {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-[16px] border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] px-4 py-3 text-sm text-[color:var(--ink-strong)]">
        <span>
          检测到冲突{conflict?.relativePath ? `：${conflict.relativePath}` : ""}。你的草稿未保存。
        </span>
        <Button size="sm" variant="outline" onClick={onReloadRemote}>
          <RefreshCcw className="size-4" />
          重新加载远端文件
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
      <CardHeader className="border-b border-[color:var(--paper-border)]">
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
    <div className="grid gap-3 rounded-[20px] border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] p-4 md:grid-cols-4">
      <Fact label="模式" value={formatFileModeLabel(file.mode)} />
      <Fact label="可编辑" value={file.editable ? "是" : "否"} />
      <Fact label="大小" value={`${file.size} 字节`} />
      <Fact label="状态" value={dirty ? "有未保存修改" : "已同步"} />
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
    return "文件策略允许的 Markdown 文件可手动编辑并保存。";
  }

  if (file.mode === "preview") {
    return "此文件可在工作台中只读预览。";
  }

  if (file.mode === "metadata") {
    return "此文件以元数据形式展示，不提供内联内容。";
  }

  return "此文件无法在工作台中打开进行内联编辑。";
}

function getEmptyPanelTitle(section: WorkbenchSection) {
  if (section === "Purpose") {
    return `${formatWorkbenchSectionLabel(section)}文件`;
  }

  if (section === "Schema") {
    return `${formatWorkbenchSectionLabel(section)}文件`;
  }

  return "未选择文件";
}

function getEmptyPanelDescription(section: WorkbenchSection) {
  if (section === "Purpose") {
    return "项目包含 purpose.md 时，此区域会打开该文件。";
  }

  if (section === "Schema") {
    return "项目包含 schema.md 时，此区域会打开该文件。";
  }

  return "从文件树选择文件，或使用上方区域快捷入口。";
}

function getEmptyPanelMessage(
  section: WorkbenchSection,
  selectedPath: string | null,
) {
  if (selectedPath) {
    return `工作台已保留 ${selectedPath} 的选择，你可以重试或从文件树选择其他文件。`;
  }

  if (section === "Purpose") {
    return "项目提供 purpose.md 后会在这里显示。";
  }

  if (section === "Schema") {
    return "项目提供 schema.md 后会在这里显示。";
  }

  return "打开项目文件前，此面板会保持为空。";
}
