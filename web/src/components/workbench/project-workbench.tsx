"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { AlertTriangle, Boxes, RefreshCcw } from "lucide-react";

import { AppShell } from "@/components/app/app-shell";
import {
  DraftGuardAlert,
  FilePanel,
  type DraftGuardPrompt,
  type FilePanelNotice,
} from "@/components/workbench/file-panel";
import {
  buildPendingDraftMessage,
  hasBlockingDraft,
  type PendingWorkbenchIntent,
} from "@/components/workbench/draft-guard";
import { FileTree } from "@/components/workbench/file-tree";
import { ProjectInsightsPanel } from "@/components/workbench/project-insights-panel";
import { ProjectOverview } from "@/components/workbench/project-overview";
import { ProjectQuestionPanel } from "@/components/workbench/project-question-panel";
import { ProjectSearch } from "@/components/workbench/project-search";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ClientApiError,
  fetchProjectDetail,
  fetchProjectFile,
  fetchProjectTree,
  saveProjectFile,
} from "@/lib/client/api";
import {
  formatAccessModeLabel,
  formatProjectStatusLabel,
  formatWorkbenchSectionLabel,
} from "@/lib/display-labels";
import type {
  FileTreeNode,
  ProjectDetail,
  WorkbenchSection,
} from "@/lib/types";
import { useWorkbenchStore } from "@/stores/workbench-store";

interface ProjectWorkbenchProps {
  projectId: string;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; detail: ProjectDetail; tree: FileTreeNode[] };

type SaveOutcome = "saved" | "failed" | "conflict" | "aborted" | "skipped";

export function ProjectWorkbench({ projectId }: ProjectWorkbenchProps) {
  const {
    section,
    selectedPath,
    file,
    draft,
    dirty,
    saving,
    refreshing,
    lastSaveStatus,
    lastSavedAt,
    conflict,
    setSection,
    setSelectedPath,
    openFile,
    setDraft,
    setSaving,
    setRefreshing,
    markSaveSuccess,
    markSaveFailed,
    markSaveConflict,
    markRefreshFailed,
    clearSaveFeedback,
    clearFile,
    reset,
  } = useWorkbenchStore();

  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [activeRequestPath, setActiveRequestPath] = useState<string | null>(null);
  const [panelNotice, setPanelNotice] = useState<FilePanelNotice | null>(null);
  const [pendingIntent, setPendingIntent] = useState<PendingWorkbenchIntent | null>(null);
  const projectLoadAbortRef = useRef<AbortController | null>(null);
  const fileLoadAbortRef = useRef<AbortController | null>(null);
  const latestFileRequestIdRef = useRef(0);
  const saveAbortRef = useRef<AbortController | null>(null);
  const latestSaveRequestIdRef = useRef(0);

  const cancelProjectLoad = useCallback(() => {
    projectLoadAbortRef.current?.abort();
    projectLoadAbortRef.current = null;
  }, []);

  const cancelFileLoad = useCallback(() => {
    fileLoadAbortRef.current?.abort();
    fileLoadAbortRef.current = null;
  }, []);

  const cancelSave = useCallback(() => {
    latestSaveRequestIdRef.current += 1;
    saveAbortRef.current?.abort();
    saveAbortRef.current = null;
    setSaving(false);
    setRefreshing(false);
  }, [setRefreshing, setSaving]);

  const blocksDraftReplacement = useMemo(
    () =>
      hasBlockingDraft({
        dirty,
        saving,
        fileMode: file?.mode ?? null,
      }),
    [dirty, file?.mode, saving],
  );

  const performReloadProject = useCallback(() => {
    cancelProjectLoad();
    cancelFileLoad();
    cancelSave();

    const abortController = new AbortController();
    projectLoadAbortRef.current = abortController;

    setLoadState({ status: "loading" });
    setPanelNotice(null);
    setActiveRequestPath(null);
    clearFile();

    void Promise.all([
      fetchProjectDetail(projectId, abortController.signal),
      fetchProjectTree(projectId, abortController.signal),
    ])
      .then(([detail, tree]) => {
        if (abortController.signal.aborted) {
          return;
        }

        setLoadState({ status: "ready", detail, tree });
      })
      .catch((error: unknown) => {
        if (abortController.signal.aborted) {
          return;
        }

        setLoadState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "无法组装项目工作台。",
        });
      })
      .finally(() => {
        if (projectLoadAbortRef.current === abortController) {
          projectLoadAbortRef.current = null;
        }
      });
  }, [cancelFileLoad, cancelProjectLoad, cancelSave, clearFile, projectId]);

  const requestReloadProject = useCallback(() => {
    const intent: PendingWorkbenchIntent = { type: "reload-project" };

    if (blocksDraftReplacement) {
      setPendingIntent(intent);
      return;
    }

    setPendingIntent(null);
    performReloadProject();
  }, [blocksDraftReplacement, performReloadProject]);

  useEffect(() => {
    reset();
    let shouldLoad = true;

    queueMicrotask(() => {
      if (shouldLoad) {
        performReloadProject();
      }
    });

    return () => {
      shouldLoad = false;
      cancelProjectLoad();
      cancelFileLoad();
      cancelSave();
      reset();
    };
  }, [cancelFileLoad, cancelProjectLoad, cancelSave, performReloadProject, reset]);

  const performOpenRelativePath = useCallback(
    async (relativePath: string, nextSection: WorkbenchSection = "Files") => {
      cancelFileLoad();

      const abortController = new AbortController();
      const requestId = latestFileRequestIdRef.current + 1;

      latestFileRequestIdRef.current = requestId;
      fileLoadAbortRef.current = abortController;
      setSelectedPath(relativePath);
      setActiveRequestPath(relativePath);
      setPanelNotice(null);
      setSection(nextSection);

      try {
        const nextFile = await fetchProjectFile(projectId, relativePath, abortController.signal);

        if (abortController.signal.aborted || requestId !== latestFileRequestIdRef.current) {
          return;
        }

        openFile(nextFile);
      } catch (error: unknown) {
        if (abortController.signal.aborted || requestId !== latestFileRequestIdRef.current) {
          return;
        }

        clearFile(true);
        setPanelNotice({
          tone: "error",
          title: "文件请求失败",
          message:
            error instanceof Error ? error.message : "无法打开请求的文件。",
        });
      } finally {
        if (!abortController.signal.aborted && requestId === latestFileRequestIdRef.current) {
          setActiveRequestPath(null);
        }

        if (fileLoadAbortRef.current === abortController) {
          fileLoadAbortRef.current = null;
        }
      }
    },
    [cancelFileLoad, clearFile, openFile, projectId, setPanelNotice, setSection, setSelectedPath],
  );

  const requestOpenRelativePath = useCallback(
    async (relativePath: string, nextSection: WorkbenchSection = "Files") => {
      const intent: PendingWorkbenchIntent =
        nextSection === "Files"
          ? { type: "open-file", path: relativePath }
          : { type: "open-section-file", path: relativePath, section: nextSection };

      if (blocksDraftReplacement) {
        setPendingIntent(intent);
        return;
      }

      setPendingIntent(null);
      await performOpenRelativePath(relativePath, nextSection);
    },
    [blocksDraftReplacement, performOpenRelativePath],
  );

  const handleSectionChange = useCallback(
    async (nextSection: WorkbenchSection) => {
      if (nextSection === "Files") {
        cancelFileLoad();
        setActiveRequestPath(null);
        setPanelNotice(null);
        setSection(nextSection);
        return;
      }

      cancelFileLoad();
      setActiveRequestPath(null);
      setPanelNotice(null);
      setSection(nextSection);
    },
    [cancelFileLoad, setSection],
  );

  const handleSave = useCallback(async (): Promise<SaveOutcome> => {
    if (!file || !dirty) {
      return "skipped";
    }

    cancelSave();

    const abortController = new AbortController();
    const requestId = latestSaveRequestIdRef.current + 1;
    const fileSnapshot = file;
    const draftSnapshot = draft;

    latestSaveRequestIdRef.current = requestId;
    saveAbortRef.current = abortController;
    setSaving(true);
    setRefreshing(false);
    clearSaveFeedback();
    setPanelNotice(null);

    try {
      const writeResult = await saveProjectFile(
        projectId,
        {
          relativePath: fileSnapshot.relativePath,
          content: draftSnapshot,
          lastModified: fileSnapshot.lastModified,
        },
        abortController.signal,
      );

      if (abortController.signal.aborted || requestId !== latestSaveRequestIdRef.current) {
        return "aborted";
      }

      setRefreshing(true);

      try {
        const refreshedFile = await fetchProjectFile(
          projectId,
          fileSnapshot.relativePath,
          abortController.signal,
        );

        if (abortController.signal.aborted || requestId !== latestSaveRequestIdRef.current) {
          return "aborted";
        }

        const now = new Date().toISOString();

        openFile(refreshedFile);
        markSaveSuccess(now);
        setPendingIntent(null);
        return "saved";
      } catch (error: unknown) {
        if (abortController.signal.aborted || requestId !== latestSaveRequestIdRef.current) {
          return "aborted";
        }

        const now = new Date().toISOString();

        openFile({
          ...fileSnapshot,
          content: draftSnapshot,
          lastModified: writeResult.lastModified,
          size: getContentSize(draftSnapshot),
        });
        setPanelNotice({
          tone: "warning",
          title: "文件已保存，但刷新失败",
          message:
            error instanceof Error
              ? `${error.message} 本地编辑状态已更新为已保存草稿。`
            : "文件已保存，但工作台无法重新加载它。本地草稿状态已保留。",
        });
        markRefreshFailed(now);
        setPendingIntent(null);
        return "saved";
      }
    } catch (error: unknown) {
      if (abortController.signal.aborted || requestId !== latestSaveRequestIdRef.current) {
        return "aborted";
      }

      if (error instanceof ClientApiError && error.code === "FILE_WRITE_CONFLICT") {
        const relativePath =
          typeof error.details?.relativePath === "string"
            ? error.details.relativePath
            : fileSnapshot.relativePath;
        const currentLastModified =
          typeof error.details?.currentLastModified === "string"
            ? error.details.currentLastModified
            : null;

        markSaveConflict({
          relativePath,
          message: error.message,
          currentLastModified,
        });
        setPanelNotice({
          tone: "warning",
          title: "磁盘上的文件已变化",
          message: error.message,
        });
        return "conflict";
      }

      const message =
        error instanceof ClientApiError
          ? error.message
          : error instanceof Error
            ? error.message
          : "无法保存这个文件。";

      markSaveFailed();
      setPanelNotice({
        tone: "error",
        title: "无法保存文件",
        message,
      });
      return "failed";
    } finally {
      if (requestId === latestSaveRequestIdRef.current) {
        setSaving(false);
        setRefreshing(false);
      }

      if (saveAbortRef.current === abortController) {
        saveAbortRef.current = null;
      }
    }
  }, [
    cancelSave,
    clearSaveFeedback,
    dirty,
    draft,
    file,
    markRefreshFailed,
    markSaveConflict,
    markSaveFailed,
    markSaveSuccess,
    openFile,
    projectId,
    setRefreshing,
    setSaving,
  ]);

  const executeIntent = useCallback(
    async (intent: PendingWorkbenchIntent) => {
      setPendingIntent(null);

      if (intent.type === "reload-project") {
        performReloadProject();
        return;
      }

      await performOpenRelativePath(intent.path, intent.type === "open-section-file" ? intent.section : "Files");
    },
    [performOpenRelativePath, performReloadProject],
  );

  const activePendingIntent = blocksDraftReplacement ? pendingIntent : null;

  const handleDraftGuardSaveAndContinue = useCallback(() => {
    if (!activePendingIntent || saving) {
      return;
    }

    void (async () => {
      const intent = activePendingIntent;
      const outcome = await handleSave();

      if (outcome === "saved" || outcome === "skipped") {
        await executeIntent(intent);
      }
    })();
  }, [activePendingIntent, executeIntent, handleSave, saving]);

  const handleDraftGuardDiscardAndContinue = useCallback(() => {
    if (!activePendingIntent || saving) {
      return;
    }

    void executeIntent(activePendingIntent);
  }, [activePendingIntent, executeIntent, saving]);

  const handleDraftGuardCancel = useCallback(() => {
    if (saving) {
      return;
    }

    setPendingIntent(null);
  }, [saving]);

  useEffect(() => {
    if (!dirty || file?.mode !== "editable") {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [dirty, file?.mode]);

  const handleDraftChange = useCallback(
    (nextDraft: string) => {
      setPendingIntent(null);
      setDraft(nextDraft);
    },
    [setDraft],
  );

  const handleResetDraft = useCallback(() => {
    setPendingIntent(null);
    setDraft(file?.content ?? "");
  }, [file, setDraft]);

  const title =
    loadState.status === "ready" ? loadState.detail.name : "项目工作台";
  const description =
    loadState.status === "ready"
      ? "打开项目文件树，检查来源文件，并通过项目路由编辑允许修改的标记文档记录。"
      : "正在加载项目档案和文件树。";
  const visibleSections = useMemo(
    () => (loadState.status === "ready" ? getVisibleWorkbenchSections(loadState.detail.sections) : []),
    [loadState],
  );
  const visibleSectionSet = useMemo(() => new Set(visibleSections), [visibleSections]);
  const currentSection = visibleSectionSet.has(section) ? section : visibleSections[0] ?? "Overview";

  useEffect(() => {
    if (loadState.status !== "ready" || visibleSectionSet.has(section)) {
      return;
    }

    setSection(currentSection);
  }, [currentSection, loadState.status, section, setSection, visibleSectionSet]);

  return (
    <AppShell
      eyebrow="项目工作台"
      title={title}
      description={description}
      aside={
        <WorkbenchAside
          projectId={projectId}
          loadState={loadState}
          saving={saving}
          onReload={requestReloadProject}
        />
      }
    >
      {loadState.status === "loading" ? <WorkbenchLoading /> : null}
      {loadState.status === "error" ? (
        <WorkbenchError message={loadState.message} onReload={requestReloadProject} />
      ) : null}
      {loadState.status === "ready" ? (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="space-y-4"
        >
          <Tabs
            value={currentSection}
            onValueChange={(value) => {
              void handleSectionChange(value as WorkbenchSection);
            }}
            className="gap-4"
          >
            <TabsList
              variant="line"
              className="w-full justify-start gap-2 rounded-[22px] border border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]/90 p-2"
            >
              {visibleSections.map((item) => (
                <TabsTrigger
                  key={item}
                  value={item}
                  disabled={saving}
                  className="rounded-full px-4 py-2 data-active:bg-[color:var(--paper-muted)]"
                >
                  {formatWorkbenchSectionLabel(item)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <WorkbenchDraftGuardAlert
            intent={activePendingIntent}
            saving={saving}
            onSaveAndContinue={handleDraftGuardSaveAndContinue}
            onDiscardAndContinue={handleDraftGuardDiscardAndContinue}
            onCancel={handleDraftGuardCancel}
          />

          <ProjectSearch
            projectId={projectId}
            onOpenFile={(relativePath) => {
              void requestOpenRelativePath(relativePath, "Files");
            }}
          />

          {currentSection === "Overview" ? (
            <ProjectOverview project={loadState.detail} tree={loadState.tree} />
          ) : null}

          {currentSection === "Ask" ? (
            <ProjectQuestionPanel
              projectId={projectId}
              onOpenFile={(relativePath) => {
                void requestOpenRelativePath(relativePath, "Files");
              }}
            />
          ) : null}

          {currentSection === "Insights" ? (
            <ProjectInsightsPanel
              projectId={projectId}
              onOpenFile={(relativePath) => {
                void requestOpenRelativePath(relativePath, "Files");
              }}
            />
          ) : null}

          {currentSection === "Files" ? (
            <div className="grid gap-4 xl:grid-cols-[19rem_minmax(0,1fr)]">
              <motion.div
                key={`${projectId}-tree-${currentSection}`}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.22 }}
              >
                <FileTree
                  tree={loadState.tree}
                  selectedPath={selectedPath}
                  loadingPath={activeRequestPath}
                  disabled={saving}
                  onOpenFile={(relativePath) => {
                    void requestOpenRelativePath(relativePath, "Files");
                  }}
                />
              </motion.div>

              <motion.div
                key={`${projectId}-panel-${currentSection}`}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.22 }}
              >
                <FilePanel
                  section={currentSection}
                  selectedPath={selectedPath}
                  file={file}
                  draft={draft}
                  dirty={dirty}
                  saving={saving}
                  refreshing={refreshing}
                  loading={activeRequestPath !== null}
                  lastSaveStatus={lastSaveStatus}
                  lastSavedAt={lastSavedAt}
                  conflict={conflict}
                  draftGuardPrompt={null}
                  notice={panelNotice}
                  onDraftChange={handleDraftChange}
                  onSave={() => {
                    void handleSave();
                  }}
                  onReset={handleResetDraft}
                  onReloadRemote={() => {
                    if (file) {
                      void requestOpenRelativePath(file.relativePath, currentSection);
                    }
                  }}
                />
              </motion.div>
            </div>
          ) : null}
        </motion.div>
      ) : null}
    </AppShell>
  );
}

function WorkbenchDraftGuardAlert({
  intent,
  saving,
  onSaveAndContinue,
  onDiscardAndContinue,
  onCancel,
}: {
  intent: PendingWorkbenchIntent | null;
  saving: boolean;
  onSaveAndContinue: () => void;
  onDiscardAndContinue: () => void;
  onCancel: () => void;
}) {
  if (!intent) {
    return null;
  }

  const prompt: DraftGuardPrompt = {
    message: buildPendingDraftMessage(intent),
    saving,
    onSaveAndContinue,
    onDiscardAndContinue,
    onCancel,
  };

  return <DraftGuardAlert prompt={prompt} />;
}

function WorkbenchAside({
  projectId,
  loadState,
  saving,
  onReload,
}: {
  projectId: string;
  loadState: LoadState;
  saving: boolean;
  onReload: () => void;
}) {
  return (
    <Card className="border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]/92 shadow-[0_18px_60px_rgba(var(--shadow-panel),0.10)]">
      <CardHeader className="border-b border-[color:var(--paper-border)]">
        <CardTitle className="text-sm uppercase tracking-[0.22em] text-[color:var(--ink-soft)]">
          工作台状态
        </CardTitle>
        <CardDescription>当前路由和项目结构状态。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              项目路由
            </p>
            <p className="mt-1 text-sm font-medium text-[color:var(--ink-strong)]">
              {`/projects/${projectId}`}
            </p>
          </div>
          <div className="rounded-full border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)]/70 p-2 text-[color:var(--ink-soft)]">
            <Boxes className="size-4" />
          </div>
        </div>

        {loadState.status === "ready" ? (
          <div className="flex flex-wrap gap-2">
            <Badge
              variant="secondary"
              className="w-fit border border-amber-900/10 bg-amber-700/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-900 dark:border-amber-300/20 dark:bg-amber-300/10 dark:text-amber-100"
            >
              {formatProjectStatusLabel(loadState.detail.status)}
            </Badge>
            <Badge
              variant="secondary"
              className="w-fit border border-sky-900/10 bg-sky-700/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-900 dark:border-sky-300/20 dark:bg-sky-300/10 dark:text-sky-100"
            >
              访问 {formatAccessModeLabel(loadState.detail.access.mode)}
            </Badge>
          </div>
        ) : null}

        <Button variant="outline" onClick={onReload} disabled={saving} className="w-full">
          <RefreshCcw className="size-4" />
          重新加载项目
        </Button>
      </CardContent>
    </Card>
  );
}

function WorkbenchLoading() {
  return (
    <div className="grid gap-4 xl:grid-cols-[19rem_minmax(0,1fr)]">
      <Card className="border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]/90">
        <CardHeader className="border-b border-[color:var(--paper-border)]">
          <Skeleton className="h-4 w-24 bg-[color:var(--paper-muted)]" />
          <Skeleton className="h-4 w-40 bg-[color:var(--paper-muted)]" />
        </CardHeader>
        <CardContent className="space-y-3 pt-4">
          {Array.from({ length: 10 }, (_, index) => (
            <Skeleton key={index} className="h-8 rounded-xl bg-[color:var(--paper-muted)]" />
          ))}
        </CardContent>
      </Card>
      <Card className="border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]/90">
        <CardHeader className="border-b border-[color:var(--paper-border)]">
          <Skeleton className="h-4 w-52 bg-[color:var(--paper-muted)]" />
          <Skeleton className="h-4 w-full bg-[color:var(--paper-muted)]" />
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <Skeleton className="h-24 rounded-[20px] bg-[color:var(--paper-muted)]" />
          <Skeleton className="h-[420px] rounded-[20px] bg-[color:var(--paper-muted)]" />
        </CardContent>
      </Card>
    </div>
  );
}

function WorkbenchError({
  message,
  onReload,
}: {
  message: string;
  onReload: () => void;
}) {
  return (
    <Card className="border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]/92 shadow-[0_16px_48px_rgba(var(--shadow-panel),0.08)]">
      <CardHeader className="border-b border-[color:var(--paper-border)]">
        <CardTitle>无法打开项目工作台</CardTitle>
        <CardDescription>
          页面未能完成初始详情和文件树请求。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <Alert variant="destructive" className="border-destructive/20 bg-destructive/5">
          <AlertTriangle className="size-4" />
          <AlertTitle>初始加载失败</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
        <Button onClick={onReload}>
          <RefreshCcw className="size-4" />
          重试
        </Button>
      </CardContent>
    </Card>
  );
}

function getVisibleWorkbenchSections(sections: WorkbenchSection[]) {
  const allowed = new Set<WorkbenchSection>(["Overview", "Ask", "Insights", "Files"]);

  return sections.filter((item) => allowed.has(item));
}

function getContentSize(content: string) {
  return new TextEncoder().encode(content).length;
}
