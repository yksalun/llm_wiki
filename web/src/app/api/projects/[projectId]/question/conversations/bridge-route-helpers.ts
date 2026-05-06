import { AppError } from "@/lib/server/app-error";
import { getProjectRootsFromEnv } from "@/lib/server/env";
import { resolveProjectById } from "@/lib/server/project-registry";
import type {
  DesktopBridgeMessageActionPayload,
  DesktopBridgeReference,
} from "@/lib/types";

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

export interface MessageActionRouteContext {
  params: Promise<{
    projectId: string;
    conversationId: string;
    messageId: string;
  }>;
}

export async function resolveRouteProject(projectId: string) {
  return resolveProjectById(getProjectRootsFromEnv(), projectId);
}

export function encodeRouteSegment(segment: string): string {
  return encodeURIComponent(segment);
}

export function buildMessageActionBridgePath({
  projectId,
  conversationId,
  messageId,
  action,
}: {
  projectId: string;
  conversationId: string;
  messageId: string;
  action: "copy" | "save-to-wiki" | "regenerate";
}) {
  return `/projects/${encodeRouteSegment(projectId)}/conversations/${encodeRouteSegment(
    conversationId,
  )}/messages/${encodeRouteSegment(messageId)}/actions/${action}`;
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

export function requireMessageActionPayload(payload: unknown): DesktopBridgeMessageActionPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AppError("INVALID_REQUEST_BODY", 400, "Request body must be an object.");
  }

  const candidate = payload as {
    content?: unknown;
    references?: unknown;
  };

  if (typeof candidate.content !== "string") {
    throw new AppError("INVALID_REQUEST_BODY", 400, "Content must be a string.");
  }

  if (!Array.isArray(candidate.references)) {
    throw new AppError("INVALID_REQUEST_BODY", 400, "References must be an array.");
  }

  const references = candidate.references.filter(isDesktopBridgeReference);
  if (references.length !== candidate.references.length) {
    throw new AppError("INVALID_REQUEST_BODY", 400, "References must include title and path.");
  }

  return {
    content: candidate.content,
    references,
  };
}

function isDesktopBridgeReference(reference: unknown): reference is DesktopBridgeReference {
  if (!reference || typeof reference !== "object") {
    return false;
  }

  const candidate = reference as Partial<DesktopBridgeReference>;
  return typeof candidate.title === "string" && typeof candidate.path === "string";
}
