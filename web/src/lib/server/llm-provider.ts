import { AppError } from "./app-error";
import type { ProjectQuestionAnswerConfig } from "./env";

const PROVIDER_TIMEOUT_MS = 30_000;

export interface GenerateProjectAnswerInput {
  question: string;
  prompt: string;
  config: ProjectQuestionAnswerConfig;
}

export interface GenerateProjectAnswerResult {
  answer: string;
  model: string;
}

export function parseOpenAIResponseText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const response = payload as { output_text?: unknown; output?: unknown };

  if (typeof response.output_text === "string" && response.output_text.trim().length > 0) {
    return response.output_text.trim();
  }

  if (!Array.isArray(response.output)) {
    return null;
  }

  const text = response.output
    .flatMap((item) => {
      if (!item || typeof item !== "object") {
        return [];
      }

      const content = (item as { content?: unknown }).content;

      if (!Array.isArray(content)) {
        return [];
      }

      return content.flatMap((contentItem) => {
        if (!contentItem || typeof contentItem !== "object") {
          return [];
        }

        const { text: contentText, type } = contentItem as { text?: unknown; type?: unknown };
        if (type !== "output_text") {
          return [];
        }

        return typeof contentText === "string" && contentText.length > 0 ? [contentText] : [];
      });
    })
    .join("")
    .trim();

  return text.length > 0 ? text : null;
}

export async function generateProjectAnswer({
  question,
  prompt,
  config,
}: GenerateProjectAnswerInput): Promise<GenerateProjectAnswerResult> {
  const timeout = createTimeoutSignal(PROVIDER_TIMEOUT_MS);

  try {
    const response = await fetch(config.baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        input: [
          { role: "system", content: prompt },
          { role: "user", content: question },
        ],
      }),
      signal: timeout.signal,
    });

    if (!response.ok) {
      throw new AppError(
        "PROJECT_QA_PROVIDER_ERROR",
        502,
        "项目问答服务返回了错误。",
        {
          publicDetails: {
            providerStatus: response.status,
          },
        },
      );
    }

    let payload: unknown;

    try {
      payload = await response.json();
    } catch (error) {
      throw new AppError(
        "PROJECT_QA_PROVIDER_INVALID_RESPONSE",
        502,
        "项目问答服务返回的数据无效。",
        {
          cause: error,
        },
      );
    }

    assertCompletedOpenAIResponse(payload);

    const answer = parseOpenAIResponseText(payload);

    if (!answer) {
      throw new AppError(
        "PROJECT_QA_PROVIDER_INVALID_RESPONSE",
        502,
        "项目问答服务返回的数据无效。",
      );
    }

    return {
      answer,
      model: config.model,
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(
      "PROJECT_QA_PROVIDER_ERROR",
      502,
      "项目问答服务请求失败。",
      {
        cause: error,
      },
    );
  } finally {
    timeout.cleanup();
  }
}

function assertCompletedOpenAIResponse(payload: unknown): void {
  if (!payload || typeof payload !== "object") {
    return;
  }

  const response = payload as {
    status?: unknown;
    error?: unknown;
    incomplete_details?: unknown;
  };
  const status = typeof response.status === "string" ? response.status : undefined;
  const hasError = hasNonEmptyValue(response.error);

  if ((!status || status === "completed") && !hasError) {
    return;
  }

  throw new AppError(
    "PROJECT_QA_PROVIDER_ERROR",
    502,
    "项目问答服务返回了错误。",
    {
      publicDetails: buildOpenAIProviderErrorDetails(status, response),
    },
  );
}

function buildOpenAIProviderErrorDetails(
  status: string | undefined,
  response: { error?: unknown; incomplete_details?: unknown },
): Record<string, string | number | boolean | null> {
  const providerReason = getOpenAIProviderReason(response);
  return {
    ...(status ? { providerStatus: status } : {}),
    ...(providerReason ? { providerReason } : {}),
  };
}

function getOpenAIProviderReason(response: { error?: unknown; incomplete_details?: unknown }): string | null {
  if (response.incomplete_details && typeof response.incomplete_details === "object") {
    const reason = (response.incomplete_details as { reason?: unknown }).reason;
    if (typeof reason === "string" && reason.length > 0) {
      return reason;
    }
  }

  if (response.error && typeof response.error === "object") {
    const code = (response.error as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) {
      return code;
    }
  }

  return null;
}

function hasNonEmptyValue(value: unknown): boolean {
  if (value == null) {
    return false;
  }

  if (typeof value === "string") {
    return value.length > 0;
  }

  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }

  return true;
}

function createTimeoutSignal(milliseconds: number): { signal: AbortSignal; cleanup: () => void } {
  const abortSignal = AbortSignal as typeof AbortSignal & {
    timeout?: (milliseconds: number) => AbortSignal;
  };

  if (typeof abortSignal.timeout === "function") {
    return {
      signal: abortSignal.timeout(milliseconds),
      cleanup: () => {},
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), milliseconds);

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeout),
  };
}
