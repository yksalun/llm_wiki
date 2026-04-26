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

const purposePath = "purpose.md";
const schemaPath = "schema.md";

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
              : "Unable to assemble the project workbench.",
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

  const treePaths = useMemo(() => {
    if (loadState.status !== "ready") {
      return new Set<string>();
    }

    return collectTreePaths(loadState.tree);
  }, [loadState]);

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
          title: "File request failed",
          message:
            error instanceof Error ? error.message : "Unable to open the requested file.",
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

  const showMissingSectionFile = useCallback(
    ({
      section: nextSection,
      title: noticeTitle,
      message,
    }: Extract<PendingWorkbenchIntent, { type: "show-missing-section-file" }>) => {
      cancelFileLoad();
      setActiveRequestPath(null);
      clearFile();
      setPanelNotice({
        tone: "error",
        title: noticeTitle,
        message,
      });
      setSection(nextSection);
    },
    [cancelFileLoad, clearFile, setSection],
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

      if (nextSection === "Purpose") {
        if (treePaths.has(purposePath)) {
          await requestOpenRelativePath(purposePath, "Purpose");
          return;
        }

        if (blocksDraftReplacement) {
          setPendingIntent({
            type: "show-missing-section-file",
            path: purposePath,
            section: "Purpose",
            title: "Purpose file unavailable",
            message: "purpose.md is not available for this project.",
          });
          return;
        }

        setPendingIntent(null);
        showMissingSectionFile({
          type: "show-missing-section-file",
          path: purposePath,
          section: "Purpose",
          title: "Purpose file unavailable",
          message: "purpose.md is not available for this project.",
        });
        return;
      }

      if (nextSection === "Schema") {
        if (treePaths.has(schemaPath)) {
          await requestOpenRelativePath(schemaPath, "Schema");
          return;
        }

        if (blocksDraftReplacement) {
          setPendingIntent({
            type: "show-missing-section-file",
            path: schemaPath,
            section: "Schema",
            title: "Schema file unavailable",
            message: "schema.md is not available for this project.",
          });
          return;
        }

        setPendingIntent(null);
        showMissingSectionFile({
          type: "show-missing-section-file",
          path: schemaPath,
          section: "Schema",
          title: "Schema file unavailable",
          message: "schema.md is not available for this project.",
        });
        return;
      }

      cancelFileLoad();
      setActiveRequestPath(null);
      setPanelNotice(null);
      setSection(nextSection);
    },
    [blocksDraftReplacement, cancelFileLoad, requestOpenRelativePath, setSection, showMissingSectionFile, treePaths],
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
          title: "File saved, refresh failed",
          message:
            error instanceof Error
              ? `${error.message} Local editor state was updated to the saved draft.`
            : "The file was saved, but the workbench could not reload it. Local draft state was preserved.",
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
          title: "File changed on disk",
          message: error.message,
        });
        return "conflict";
      }

      const message =
        error instanceof ClientApiError
          ? error.message
          : error instanceof Error
            ? error.message
          : "Unable to save this file.";

      markSaveFailed();
      setPanelNotice({
        tone: "error",
        title: "Unable to save file",
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

      if (intent.type === "show-missing-section-file") {
        showMissingSectionFile(intent);
        return;
      }

      await performOpenRelativePath(intent.path, intent.type === "open-section-file" ? intent.section : "Files");
    },
    [performOpenRelativePath, performReloadProject, showMissingSectionFile],
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
    loadState.status === "ready" ? loadState.detail.name : "Project workbench";
  const description =
    loadState.status === "ready"
      ? "Open the project tree, inspect source files, and edit allowed Markdown records through the project routes."
      : "Loading the project dossier and file tree.";

  return (
    <AppShell
      eyebrow="Project Workbench"
      title={title}
      description={description}
      aside={<WorkbenchAside loadState={loadState} saving={saving} onReload={requestReloadProject} />}
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
            value={section}
            onValueChange={(value) => {
              void handleSectionChange(value as WorkbenchSection);
            }}
            className="gap-4"
          >
            <TabsList
              variant="line"
              className="w-full justify-start gap-2 rounded-[22px] border border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]/90 p-2"
            >
              {loadState.detail.sections.map((item) => (
                <TabsTrigger
                  key={item}
                  value={item}
                  disabled={saving}
                  className="rounded-full px-4 py-2 data-active:bg-black/5"
                >
                  {item}
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

          {section === "Overview" ? (
            <ProjectOverview
              project={loadState.detail}
              tree={loadState.tree}
              onChangeSection={(nextSection) => {
                void handleSectionChange(nextSection);
              }}
              onOpenFile={(relativePath) => {
                void requestOpenRelativePath(relativePath, "Files");
              }}
            />
          ) : null}

          {section === "Ask" ? (
            <ProjectQuestionPanel
              projectId={projectId}
              onOpenFile={(relativePath) => {
                void requestOpenRelativePath(relativePath, "Files");
              }}
            />
          ) : null}

          {section === "Insights" ? (
            <ProjectInsightsPanel
              projectId={projectId}
              onOpenFile={(relativePath) => {
                void requestOpenRelativePath(relativePath, "Files");
              }}
            />
          ) : null}

          {(section === "Files" || section === "Purpose" || section === "Schema") ? (
            <div className="grid gap-4 xl:grid-cols-[19rem_minmax(0,1fr)]">
              <motion.div
                key={`${projectId}-tree-${section}`}
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
                key={`${projectId}-panel-${section}`}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.22 }}
              >
                <FilePanel
                  section={section}
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
                      void requestOpenRelativePath(file.relativePath, section);
                    }
                  }}
                />
              </motion.div>
            </div>
          ) : null}

          {section === "Project Info" ? (
            <ProjectInfoPanel detail={loadState.detail} tree={loadState.tree} />
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
  loadState,
  saving,
  onReload,
}: {
  loadState: LoadState;
  saving: boolean;
  onReload: () => void;
}) {
  return (
    <Card className="border-[color:var(--paper-border)] bg-[linear-gradient(180deg,rgba(255,252,246,0.92),rgba(245,239,229,0.86))] shadow-[0_18px_60px_rgba(88,67,42,0.10)]">
      <CardHeader className="border-b border-black/5">
        <CardTitle className="text-sm uppercase tracking-[0.22em] text-[color:var(--ink-soft)]">
          Workbench State
        </CardTitle>
        <CardDescription>Current route and structure status for this project.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              Project route
            </p>
            <p className="mt-1 text-sm font-medium text-[color:var(--ink-strong)]">
              /projects/[projectId]
            </p>
          </div>
          <div className="rounded-full border border-black/8 bg-white/70 p-2 text-[color:var(--ink-soft)]">
            <Boxes className="size-4" />
          </div>
        </div>

        {loadState.status === "ready" ? (
          <Badge
            variant="secondary"
            className="w-fit border border-amber-900/10 bg-amber-700/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-900"
          >
            {loadState.detail.status}
          </Badge>
        ) : null}

        <Button variant="outline" onClick={onReload} disabled={saving} className="w-full">
          <RefreshCcw className="size-4" />
          Reload project
        </Button>
      </CardContent>
    </Card>
  );
}

function WorkbenchLoading() {
  return (
    <div className="grid gap-4 xl:grid-cols-[19rem_minmax(0,1fr)]">
      <Card className="border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]/90">
        <CardHeader className="border-b border-black/5">
          <Skeleton className="h-4 w-24 bg-black/8" />
          <Skeleton className="h-4 w-40 bg-black/8" />
        </CardHeader>
        <CardContent className="space-y-3 pt-4">
          {Array.from({ length: 10 }, (_, index) => (
            <Skeleton key={index} className="h-8 rounded-xl bg-black/7" />
          ))}
        </CardContent>
      </Card>
      <Card className="border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]/90">
        <CardHeader className="border-b border-black/5">
          <Skeleton className="h-4 w-52 bg-black/8" />
          <Skeleton className="h-4 w-full bg-black/8" />
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <Skeleton className="h-24 rounded-[20px] bg-black/7" />
          <Skeleton className="h-[420px] rounded-[20px] bg-black/7" />
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
    <Card className="border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]/92 shadow-[0_16px_48px_rgba(61,52,40,0.08)]">
      <CardHeader className="border-b border-black/5">
        <CardTitle>Unable to open the project workbench</CardTitle>
        <CardDescription>
          The page could not complete the initial detail and tree requests.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <Alert variant="destructive" className="border-destructive/20 bg-destructive/5">
          <AlertTriangle className="size-4" />
          <AlertTitle>Initial load failed</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
        <Button onClick={onReload}>
          <RefreshCcw className="size-4" />
          Retry
        </Button>
      </CardContent>
    </Card>
  );
}

function ProjectInfoPanel({
  detail,
  tree,
}: {
  detail: ProjectDetail;
  tree: FileTreeNode[];
}) {
  return (
    <Card className="border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]/92 shadow-[0_18px_56px_rgba(61,52,40,0.08)]">
      <CardHeader className="border-b border-black/5">
        <CardTitle>Project info</CardTitle>
        <CardDescription>
          Summary of the resolved project route and tree composition.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 pt-4 md:grid-cols-2 xl:grid-cols-3">
        <InfoBlock label="Project name" value={detail.name} />
        <InfoBlock label="Project ID" value={detail.id} mono />
        <InfoBlock label="Status" value={detail.status} />
        <InfoBlock label="Purpose present" value={detail.hasPurpose ? "Yes" : "No"} />
        <InfoBlock label="Schema present" value={detail.hasSchema ? "Yes" : "No"} />
        <InfoBlock label="Wiki directory" value={detail.hasWikiDirectory ? "Yes" : "No"} />
        <InfoBlock
          label="Raw sources directory"
          value={detail.hasRawSourcesDirectory ? "Yes" : "No"}
        />
        <InfoBlock label="Sections" value={detail.sections.join(", ")} />
        <InfoBlock label="Tree entries" value={String(collectTreePaths(tree).size)} />
      </CardContent>
    </Card>
  );
}

function InfoBlock({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-[20px] border border-black/8 bg-white/55 p-4">
      <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className={mono ? "mt-2 font-mono text-sm text-[color:var(--ink-strong)]" : "mt-2 text-sm font-medium text-[color:var(--ink-strong)]"}>
        {value}
      </p>
    </div>
  );
}

function collectTreePaths(nodes: FileTreeNode[]): Set<string> {
  const paths = new Set<string>();

  for (const node of nodes) {
    paths.add(node.relativePath);

    if (node.nodeType === "directory") {
      for (const child of collectTreePaths(node.children ?? [])) {
        paths.add(child);
      }
    }
  }

  return paths;
}

function getContentSize(content: string) {
  return new TextEncoder().encode(content).length;
}
