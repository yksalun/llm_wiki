import { AppError } from "@/lib/server/app-error";
import { getProjectRootsFromEnv } from "@/lib/server/env";
import { resolveProjectById } from "@/lib/server/project-registry";

export interface ProjectRouteContext {
  params: Promise<{
    projectId: string;
  }>;
}

export interface ConversationRouteContext {
  params: Promise<{
    projectId: string;
    conversationId: string;
  }>;
}

export async function resolveRouteProject(projectId: string) {
  return resolveProjectById(getProjectRootsFromEnv(), projectId);
}

export function encodeRouteSegment(segment: string): string {
  return encodeURIComponent(segment);
}

export async function parseJsonRequestBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (error) {
    throw new AppError("INVALID_REQUEST_BODY", 400, "Request body must be valid JSON.", {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

export function requireMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AppError("INVALID_REQUEST_BODY", 400, "Request body must be an object.");
  }

  const message = (payload as { message?: unknown }).message;
  if (typeof message !== "string") {
    throw new AppError("INVALID_REQUEST_BODY", 400, "Message must be a non-empty string.");
  }

  const trimmed = message.trim();
  if (!trimmed) {
    throw new AppError("INVALID_REQUEST_BODY", 400, "Message must be a non-empty string.");
  }

  return trimmed;
}
