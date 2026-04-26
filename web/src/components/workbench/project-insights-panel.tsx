"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, GitBranch, Lightbulb, LoaderCircle, RotateCcw } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { fetchProjectInsights } from "@/lib/client/api";
import { formatInsightSeverityLabel } from "@/lib/display-labels";
import type {
  ProjectInsightEdge,
  ProjectInsightFinding,
  ProjectInsightResearchPrompt,
  ProjectInsightsResponse,
} from "@/lib/types";

interface ProjectInsightsPanelProps {
  projectId: string;
  onOpenFile: (relativePath: string) => void;
  fetchFn?: typeof fetchProjectInsights;
}

type InsightsStatus = "loading" | "ready" | "error";

export function ProjectInsightsPanel({
  projectId,
  onOpenFile,
  fetchFn = fetchProjectInsights,
}: ProjectInsightsPanelProps) {
  const [retryKey, setRetryKey] = useState(0);

  return (
    <ProjectInsightsPanelSession
      key={`${projectId}:${retryKey}`}
      projectId={projectId}
      onOpenFile={onOpenFile}
      fetchFn={fetchFn}
      onRetry={() => setRetryKey((key) => key + 1)}
    />
  );
}

function ProjectInsightsPanelSession({
  projectId,
  onOpenFile,
  fetchFn,
  onRetry,
}: Required<ProjectInsightsPanelProps> & { onRetry: () => void }) {
  const [response, setResponse] = useState<ProjectInsightsResponse | null>(null);
  const [status, setStatus] = useState<InsightsStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetchFn(projectId, controller.signal)
      .then((nextResponse) => {
        if (controller.signal.aborted) {
          return;
        }

        setResponse(nextResponse);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) {
          return;
        }

        setResponse(null);
        setErrorMessage(getErrorMessage(error));
        setStatus("error");
      });

    return () => {
      controller.abort();
    };
  }, [fetchFn, projectId]);

  const nodePaths = useMemo(() => {
    const paths = new Map<string, string>();

    for (const node of response?.graph.nodes ?? []) {
      paths.set(node.id, node.relativePath);
    }

    return paths;
  }, [response]);

  return (
    <section className="space-y-3 rounded-lg border border-[color:var(--paper-border)] bg-[color:var(--paper-panel)] p-3">
      <div className="flex items-center gap-2">
        <Lightbulb className="size-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-medium text-[color:var(--ink-strong)]">项目洞察</h2>
      </div>

      {status === "loading" ? (
        <div className="flex items-center gap-2 rounded-lg border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] px-3 py-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          正在加载洞察
        </div>
      ) : null}

      {status === "error" ? (
        <Alert variant="destructive" className="border-destructive/20 bg-destructive/5">
          <Lightbulb className="size-4" />
          <AlertTitle>洞察加载失败</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{errorMessage ?? "洞察加载失败"}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onRetry}
            >
              <RotateCcw className="size-4" />
              重试
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {status === "ready" && response ? (
        <div className="space-y-3">
          <SummaryGrid response={response} />

          <InsightGroup title="关系图边">
            {response.graph.edges.length === 0 ? (
              <EmptyState>没有关系图边</EmptyState>
            ) : (
              <ul className="space-y-2">
                {response.graph.edges.map((edge) => (
                  <GraphEdgeItem key={edge.id} edge={edge} nodePaths={nodePaths} />
                ))}
              </ul>
            )}
          </InsightGroup>

          <InsightGroup title="发现">
            {response.findings.length === 0 ? (
              <EmptyState>没有发现</EmptyState>
            ) : (
              <ul className="space-y-2">
                {response.findings.map((finding) => (
                  <FindingItem key={finding.id} finding={finding} onOpenFile={onOpenFile} />
                ))}
              </ul>
            )}
          </InsightGroup>

          <InsightGroup title="研究问题">
            {response.researchPrompts.length === 0 ? (
              <EmptyState>没有研究问题</EmptyState>
            ) : (
              <ul className="space-y-2">
                {response.researchPrompts.map((prompt) => (
                  <ResearchPromptItem
                    key={prompt.id}
                    prompt={prompt}
                    onOpenFile={onOpenFile}
                  />
                ))}
              </ul>
            )}
          </InsightGroup>
        </div>
      ) : null}
    </section>
  );
}

function SummaryGrid({ response }: { response: ProjectInsightsResponse }) {
  const { summary } = response;

  return (
    <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
      <SummaryItem label="已分析" value={`${summary.analyzedFiles} 个文件`} />
      <SummaryItem label="标记文档" value={`${summary.markdownFiles} 个文件`} />
      <SummaryItem label="节点" value={`${summary.graphNodes} 个节点`} />
      <SummaryItem label="边" value={`${summary.graphEdges} 条边`} />
      <SummaryItem label="发现" value={`${summary.findings} 条发现`} />
      <SummaryItem label="问题" value={`${summary.researchPrompts} 个问题`} />
    </dl>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] px-3 py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium text-[color:var(--ink-strong)]">{value}</dd>
    </div>
  );
}

function InsightGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

function GraphEdgeItem({
  edge,
  nodePaths,
}: {
  edge: ProjectInsightEdge;
  nodePaths: Map<string, string>;
}) {
  const sourcePath = nodePaths.get(edge.sourceId) ?? stripFileSourceId(edge.sourceId);
  const targetPath = nodePaths.get(edge.targetId) ?? stripFileSourceId(edge.targetId);

  return (
    <li className="rounded-lg border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] p-3">
      <div className="flex items-start gap-2">
        <GitBranch className="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 space-y-1">
          <p className="break-words text-sm font-medium text-[color:var(--ink-strong)]">
            {sourcePath} -&gt; {targetPath}
          </p>
          <p className="text-xs text-muted-foreground">
            {edge.label} / 第 {edge.sourceLineNumber} 行
          </p>
        </div>
      </div>
    </li>
  );
}

function FindingItem({
  finding,
  onOpenFile,
}: {
  finding: ProjectInsightFinding;
  onOpenFile: (relativePath: string) => void;
}) {
  return (
    <li className="rounded-lg border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-[color:var(--ink-strong)]">{finding.title}</p>
          <p className="text-xs text-muted-foreground">
            {formatInsightSeverityLabel(finding.severity)}
          </p>
        </div>
        {finding.relativePath ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onOpenFile(finding.relativePath as string)}
          >
            <ExternalLink className="size-4" />
            打开来源
          </Button>
        ) : null}
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{finding.message}</p>
      {finding.relativePath ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {finding.relativePath}
          {finding.lineNumber ? ` / 第 ${finding.lineNumber} 行` : null}
        </p>
      ) : null}
    </li>
  );
}

function ResearchPromptItem({
  prompt,
  onOpenFile,
}: {
  prompt: ProjectInsightResearchPrompt;
  onOpenFile: (relativePath: string) => void;
}) {
  const fileSources = prompt.sourceIds.map(parseFileSourceId).filter((path) => path !== null);

  return (
    <li className="rounded-lg border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-[color:var(--ink-strong)]">{prompt.title}</p>
          <p className="text-sm leading-6 text-muted-foreground">{prompt.question}</p>
        </div>
        {fileSources[0] ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onOpenFile(fileSources[0])}
          >
            <ExternalLink className="size-4" />
            打开来源
          </Button>
        ) : null}
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{prompt.reason}</p>
    </li>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] px-3 py-4 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function parseFileSourceId(sourceId: string) {
  return sourceId.startsWith("file:") ? sourceId.slice("file:".length) : null;
}

function stripFileSourceId(sourceId: string) {
  return parseFileSourceId(sourceId) ?? sourceId;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "洞察加载失败";
}
