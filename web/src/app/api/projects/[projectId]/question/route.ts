import type { ProjectQuestionMessage, ProjectQuestionRequest } from "@/lib/types";
import { AppError } from "@/lib/server/app-error";
import { getProjectRootsFromEnv } from "@/lib/server/env";
import { answerProjectQuestion } from "@/lib/server/project-question-answer";
import { resolveProjectById } from "@/lib/server/project-registry";
import { errorJson, okJson } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

interface ProjectRouteContext {
  params: Promise<{
    projectId: string;
  }>;
}

export async function POST(request: Request, context: ProjectRouteContext) {
  try {
    const roots = getProjectRootsFromEnv();
    const { projectId } = await context.params;
    const project = await resolveProjectById(roots, projectId);
    const payload = validateProjectQuestionRequest(await parseJsonRequestBody(request));
    const response = await answerProjectQuestion(project.rootDir, payload);

    return okJson(response);
  } catch (error) {
    return errorJson(error);
  }
}

async function parseJsonRequestBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (error) {
    throw new AppError("INVALID_REQUEST_BODY", 400, "Request body must be valid JSON.", {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

function validateProjectQuestionRequest(payload: unknown): ProjectQuestionRequest {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AppError("INVALID_REQUEST_BODY", 400, "Request body must be a JSON object.");
  }

  const candidate = payload as {
    question?: unknown;
    history?: unknown;
  };

  if (typeof candidate.question !== "string") {
    throw new AppError("INVALID_REQUEST_BODY", 400, "question must be a string.");
  }

  if (candidate.history !== undefined && !Array.isArray(candidate.history)) {
    throw new AppError("INVALID_REQUEST_BODY", 400, "history must be an array.");
  }

  return {
    question: candidate.question,
    ...(Array.isArray(candidate.history) ? { history: normalizeHistory(candidate.history) } : {}),
  };
}

function normalizeHistory(history: unknown[]): ProjectQuestionMessage[] {
  return history.flatMap((message) => {
    if (!message || typeof message !== "object") {
      return [];
    }

    const candidate = message as {
      role?: unknown;
      content?: unknown;
    };

    if (
      (candidate.role !== "user" && candidate.role !== "assistant") ||
      typeof candidate.content !== "string"
    ) {
      return [];
    }

    return [
      {
        role: candidate.role,
        content: candidate.content,
      },
    ];
  });
}
