import type { AnswerMetricStage, AnswerMetrics, AnswerTokenUsage } from "@/stores/chat-store"

export type AnswerMetricStageId =
  | "prepare_request"
  | "search_wiki"
  | "expand_graph"
  | "read_pages"
  | "model_generation"

export type MetricsNow = () => number

export interface AnswerMetricsRecorder {
  measure<T>(
    id: AnswerMetricStageId,
    name: string,
    run: () => Promise<T>,
    tokenUsage?: AnswerTokenUsage,
  ): Promise<T>
  measureSync<T>(
    id: AnswerMetricStageId,
    name: string,
    run: () => T,
    tokenUsage?: AnswerTokenUsage,
  ): T
  record(
    id: AnswerMetricStageId,
    name: string,
    durationMs: number,
    tokenUsage?: AnswerTokenUsage,
  ): void
  build(): AnswerMetrics
}

export function createAnswerMetricsRecorder(
  now: MetricsNow = () => Date.now(),
): AnswerMetricsRecorder {
  const startedAt = now()
  const stages: AnswerMetricStage[] = []

  function record(
    id: AnswerMetricStageId,
    name: string,
    durationMs: number,
    tokenUsage?: AnswerTokenUsage,
  ) {
    const normalizedUsage = normalizeAnswerTokenUsage(tokenUsage)
    stages.push({
      id,
      name,
      durationMs: clampDuration(durationMs),
      ...(normalizedUsage ? { tokenUsage: normalizedUsage } : {}),
    })
  }

  return {
    async measure(id, name, run, tokenUsage) {
      const stageStartedAt = now()
      try {
        return await run()
      } finally {
        record(id, name, now() - stageStartedAt, tokenUsage)
      }
    },
    measureSync(id, name, run, tokenUsage) {
      const stageStartedAt = now()
      try {
        return run()
      } finally {
        record(id, name, now() - stageStartedAt, tokenUsage)
      }
    },
    record,
    build() {
      return {
        version: 1,
        totalDurationMs: clampDuration(now() - startedAt),
        stages: [...stages],
      }
    },
  }
}

export function normalizeAnswerTokenUsage(
  usage: AnswerTokenUsage | undefined,
): AnswerTokenUsage | undefined {
  if (!usage) return undefined

  const normalized: AnswerTokenUsage = {}
  if (isValidTokenCount(usage.inputTokens)) normalized.inputTokens = usage.inputTokens
  if (isValidTokenCount(usage.outputTokens)) normalized.outputTokens = usage.outputTokens
  if (isValidTokenCount(usage.totalTokens)) normalized.totalTokens = usage.totalTokens

  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function isValidTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
}

function clampDuration(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}
