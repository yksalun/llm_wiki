"use client";

import { useMemo, useState } from "react";
import { Activity, ChevronDown, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { normalizeDesktopBridgeAnswerMetrics } from "@/lib/answer-metrics";
import type {
  DesktopBridgeAnswerMetricStage,
  DesktopBridgeAnswerMetrics,
  DesktopBridgeAnswerTokenUsage,
} from "@/lib/types";

interface AnswerMetricsPanelProps {
  metrics?: DesktopBridgeAnswerMetrics;
}

export function AnswerMetricsPanel({ metrics }: AnswerMetricsPanelProps) {
  const normalized = useMemo(
    () => normalizeDesktopBridgeAnswerMetrics(metrics),
    [metrics],
  );
  const [expanded, setExpanded] = useState(false);

  if (!normalized) {
    return null;
  }

  const totalTokens = getOfficialTokenSummary(normalized.stages);
  const summary = [
    `${normalized.stages.length} 个阶段`,
    formatDuration(normalized.totalDurationMs),
    totalTokens !== null ? `${formatNumber(totalTokens)} tokens` : null,
  ]
    .filter(Boolean)
    .join(" / ");
  const ExpandIcon = expanded ? ChevronDown : ChevronRight;

  return (
    <div
      data-answer-metrics="true"
      className="mt-2 rounded-md border border-transparent bg-muted/10 px-2 py-1 text-[11px] text-muted-foreground"
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 w-full min-w-0 justify-between gap-2 px-0 text-[11px] font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
        aria-label={expanded ? "收起回答数据" : "展开回答数据"}
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="inline-flex min-w-0 items-center gap-1">
          <Activity className="size-3 shrink-0" aria-hidden="true" />
          <span className="shrink-0">回答数据</span>
          <span className="min-w-0 truncate text-muted-foreground/80">{summary}</span>
        </span>
        <ExpandIcon className="size-3 shrink-0" aria-hidden="true" />
      </Button>
      {expanded ? (
        <div className="mt-1 grid gap-1 border-t border-[color:var(--paper-border)] pt-1">
          {normalized.stages.map((stage) => (
            <div
              key={`${stage.id}:${stage.name}:${stage.durationMs}`}
              className="grid gap-1 rounded-sm px-1 py-0.5 sm:grid-cols-[minmax(0,1fr)_auto]"
            >
              <span className="min-w-0 truncate text-muted-foreground/90">
                {stage.name}
              </span>
              <span className="shrink-0 text-muted-foreground/80">
                {formatDuration(stage.durationMs)}
                {stage.tokenUsage ? ` / ${formatTokenUsage(stage.tokenUsage)}` : ""}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function getOfficialTokenSummary(stages: DesktopBridgeAnswerMetricStage[]) {
  let hasTotal = false;
  let total = 0;

  for (const stage of stages) {
    if (stage.tokenUsage?.totalTokens !== undefined) {
      hasTotal = true;
      total += stage.tokenUsage.totalTokens;
    }
  }

  if (hasTotal) {
    return total;
  }

  let hasInputOrOutput = false;

  for (const stage of stages) {
    if (stage.tokenUsage?.inputTokens !== undefined) {
      hasInputOrOutput = true;
      total += stage.tokenUsage.inputTokens;
    }

    if (stage.tokenUsage?.outputTokens !== undefined) {
      hasInputOrOutput = true;
      total += stage.tokenUsage.outputTokens;
    }
  }

  return hasInputOrOutput ? total : null;
}

function formatDuration(durationMs: number) {
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${(durationMs / 1000).toFixed(1)} 秒`;
}

function formatTokenUsage(usage: DesktopBridgeAnswerTokenUsage) {
  return [
    usage.inputTokens !== undefined ? `输入 ${formatNumber(usage.inputTokens)}` : null,
    usage.outputTokens !== undefined ? `输出 ${formatNumber(usage.outputTokens)}` : null,
    usage.totalTokens !== undefined ? `总计 ${formatNumber(usage.totalTokens)}` : null,
  ]
    .filter(Boolean)
    .join(" / ");
}

function formatNumber(value: number) {
  return value.toLocaleString("en-US");
}
