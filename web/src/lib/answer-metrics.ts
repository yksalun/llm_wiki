import type {
  DesktopBridgeAnswerMetricStage,
  DesktopBridgeAnswerMetrics,
  DesktopBridgeAnswerTokenUsage,
} from "@/lib/types";

export function normalizeDesktopBridgeAnswerMetrics(
  metrics: unknown,
): DesktopBridgeAnswerMetrics | undefined {
  if (!isRecord(metrics)) {
    return undefined;
  }

  if (metrics.version !== 1 || !isDuration(metrics.totalDurationMs)) {
    return undefined;
  }

  const stages = Array.isArray(metrics.stages)
    ? metrics.stages
        .map(normalizeStage)
        .filter((stage): stage is DesktopBridgeAnswerMetricStage => stage !== undefined)
    : [];

  if (stages.length === 0) {
    return undefined;
  }

  return {
    version: 1,
    totalDurationMs: Math.round(metrics.totalDurationMs),
    stages,
  };
}

function normalizeStage(stage: unknown): DesktopBridgeAnswerMetricStage | undefined {
  if (!isRecord(stage)) {
    return undefined;
  }

  if (
    typeof stage.id !== "string" ||
    stage.id.trim().length === 0 ||
    typeof stage.name !== "string" ||
    stage.name.trim().length === 0 ||
    !isDuration(stage.durationMs)
  ) {
    return undefined;
  }

  const tokenUsage = normalizeTokenUsage(stage.tokenUsage);

  return {
    id: stage.id,
    name: stage.name,
    durationMs: Math.round(stage.durationMs),
    ...(tokenUsage ? { tokenUsage } : {}),
  };
}

function normalizeTokenUsage(usage: unknown): DesktopBridgeAnswerTokenUsage | undefined {
  if (!isRecord(usage)) {
    return undefined;
  }

  const normalized: DesktopBridgeAnswerTokenUsage = {};

  if (isTokenCount(usage.inputTokens)) {
    normalized.inputTokens = usage.inputTokens;
  }

  if (isTokenCount(usage.outputTokens)) {
    normalized.outputTokens = usage.outputTokens;
  }

  if (isTokenCount(usage.totalTokens)) {
    normalized.totalTokens = usage.totalTokens;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDuration(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
