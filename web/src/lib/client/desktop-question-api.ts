"use client";

import { requestJson } from "@/lib/client/api";
import { normalizeDesktopBridgeAnswerMetrics } from "@/lib/answer-metrics";
import type {
  DesktopBridgeConversation,
  DesktopBridgeMessage,
  DesktopBridgeMessageActionPayload,
  DesktopBridgeMessageActionResponse,
  DesktopBridgeReference,
  DesktopBridgeStreamEvent,
} from "@/lib/types";

interface ConversationsPayload {
  conversations: DesktopBridgeConversation[];
}

interface CreateConversationPayload {
  conversation: DesktopBridgeConversation;
}

interface MessagesPayload {
  messages: DesktopBridgeMessage[];
}

interface ApiErrorPayload {
  error?: {
    message?: string;
  };
}

type QuestionMessageAction = "copy" | "save-to-wiki" | "regenerate";

export interface StreamQuestionMessageHandlers {
  signal?: AbortSignal;
  onToken: (text: string) => void;
  onReferences: (references: DesktopBridgeReference[]) => void;
  onDone: (message: DesktopBridgeMessage) => void;
  onError: (code: string, message: string) => void;
}

export async function listQuestionConversations(projectId: string, signal?: AbortSignal) {
  const payload = await requestJson<ConversationsPayload>(
    `/api/projects/${encodeURIComponent(projectId)}/question/conversations`,
    {
      method: "GET",
      cache: "no-store",
      signal,
    },
  );

  return payload.conversations;
}

export async function createQuestionConversation(projectId: string, signal?: AbortSignal) {
  const payload = await requestJson<CreateConversationPayload>(
    `/api/projects/${encodeURIComponent(projectId)}/question/conversations`,
    {
      method: "POST",
      cache: "no-store",
      signal,
    },
  );

  return payload.conversation;
}

export async function listQuestionMessages(
  projectId: string,
  conversationId: string,
  signal?: AbortSignal,
) {
  const payload = await requestJson<MessagesPayload>(
    `/api/projects/${encodeURIComponent(projectId)}/question/conversations/${encodeURIComponent(
      conversationId,
    )}/messages`,
    {
      method: "GET",
      cache: "no-store",
      signal,
    },
  );

  return payload.messages;
}

export async function copyQuestionAnswer(
  projectId: string,
  conversationId: string,
  messageId: string,
  payload: DesktopBridgeMessageActionPayload,
  signal?: AbortSignal,
) {
  return postQuestionMessageAction(projectId, conversationId, messageId, "copy", payload, signal);
}

export async function saveQuestionAnswerToWiki(
  projectId: string,
  conversationId: string,
  messageId: string,
  payload: DesktopBridgeMessageActionPayload,
  signal?: AbortSignal,
) {
  return postQuestionMessageAction(
    projectId,
    conversationId,
    messageId,
    "save-to-wiki",
    payload,
    signal,
  );
}

export async function regenerateQuestionAnswer(
  projectId: string,
  conversationId: string,
  messageId: string,
  payload: DesktopBridgeMessageActionPayload,
  signal?: AbortSignal,
) {
  return postQuestionMessageAction(
    projectId,
    conversationId,
    messageId,
    "regenerate",
    payload,
    signal,
  );
}

export async function streamRegenerateQuestionAnswer(
  projectId: string,
  conversationId: string,
  messageId: string,
  payload: DesktopBridgeMessageActionPayload,
  handlers: StreamQuestionMessageHandlers,
) {
  return streamQuestionEvents(
    `/api/projects/${encodeURIComponent(projectId)}/question/conversations/${encodeURIComponent(
      conversationId,
    )}/messages/${encodeURIComponent(messageId)}/actions/regenerate/stream`,
    payload,
    handlers,
  );
}

export async function streamQuestionMessage(
  projectId: string,
  conversationId: string,
  message: string,
  handlers: StreamQuestionMessageHandlers,
) {
  return streamQuestionEvents(
    `/api/projects/${encodeURIComponent(projectId)}/question/conversations/${encodeURIComponent(
      conversationId,
    )}/messages/stream`,
    { message },
    handlers,
  );
}

async function streamQuestionEvents(
  path: string,
  body: object,
  handlers: StreamQuestionMessageHandlers,
) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: handlers.signal,
  });

  if (!response.ok) {
    throw new Error(await getStreamErrorMessage(response));
  }

  if (!response.body) {
    throw new Error("桌面端问答请求失败。");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    buffer = consumeSseBuffer(buffer, handlers);
  }

  buffer += decoder.decode();
  consumeSseBuffer(buffer, handlers, true);
}

async function postQuestionMessageAction(
  projectId: string,
  conversationId: string,
  messageId: string,
  action: QuestionMessageAction,
  payload: DesktopBridgeMessageActionPayload,
  signal?: AbortSignal,
) {
  return requestJson<DesktopBridgeMessageActionResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/question/conversations/${encodeURIComponent(
      conversationId,
    )}/messages/${encodeURIComponent(messageId)}/actions/${action}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    },
  );
}

export function parseSseBlock(block: string): DesktopBridgeStreamEvent | null {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();

  if (data.length === 0) {
    return null;
  }

  try {
    const event = JSON.parse(data) as Partial<DesktopBridgeStreamEvent>;

    if (event.type === "token" && typeof event.text === "string") {
      return event as DesktopBridgeStreamEvent;
    }

    if (event.type === "references" && Array.isArray(event.references)) {
      return event as DesktopBridgeStreamEvent;
    }

    if (event.type === "done") {
      const message = normalizeDesktopBridgeMessage(
        (event as { message?: unknown }).message,
      );

      if (message) {
        return { type: "done", message };
      }
    }

    if (
      event.type === "error" &&
      typeof event.code === "string" &&
      typeof event.message === "string"
    ) {
      return event as DesktopBridgeStreamEvent;
    }
  } catch {
    return null;
  }

  return null;
}

function normalizeDesktopBridgeMessage(value: unknown): DesktopBridgeMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Partial<DesktopBridgeMessage>;

  if (
    typeof candidate.id !== "string" ||
    !isDesktopBridgeMessageRole(candidate.role) ||
    typeof candidate.content !== "string" ||
    typeof candidate.timestamp !== "number" ||
    !Number.isFinite(candidate.timestamp) ||
    typeof candidate.conversationId !== "string"
  ) {
    return null;
  }

  const message: DesktopBridgeMessage = {
    id: candidate.id,
    role: candidate.role,
    content: candidate.content,
    timestamp: candidate.timestamp,
    conversationId: candidate.conversationId,
  };

  if (Array.isArray(candidate.references)) {
    message.references = candidate.references.filter(isDesktopBridgeReference);
  }

  const metrics = normalizeDesktopBridgeAnswerMetrics(candidate.metrics);

  if (metrics) {
    message.metrics = metrics;
  }

  return message;
}

function isDesktopBridgeMessageRole(
  role: unknown,
): role is DesktopBridgeMessage["role"] {
  return role === "user" || role === "assistant" || role === "system";
}

function isDesktopBridgeReference(reference: unknown): reference is DesktopBridgeReference {
  if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
    return false;
  }

  const candidate = reference as Partial<DesktopBridgeReference>;
  return typeof candidate.title === "string" && typeof candidate.path === "string";
}

function consumeSseBuffer(
  buffer: string,
  handlers: StreamQuestionMessageHandlers,
  flush = false,
) {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const blocks = normalized.split("\n\n");
  const completeBlocks = flush ? blocks : blocks.slice(0, -1);

  for (const block of completeBlocks) {
    dispatchStreamEvent(parseSseBlock(block), handlers);
  }

  return flush ? "" : blocks.at(-1) ?? "";
}

function dispatchStreamEvent(
  event: DesktopBridgeStreamEvent | null,
  handlers: StreamQuestionMessageHandlers,
) {
  if (!event) {
    return;
  }

  if (event.type === "token") {
    handlers.onToken(event.text);
    return;
  }

  if (event.type === "references") {
    handlers.onReferences(event.references);
    return;
  }

  if (event.type === "done") {
    handlers.onDone(event.message);
    return;
  }

  handlers.onError(event.code, event.message);
}

async function getStreamErrorMessage(response: Response) {
  try {
    const payload = (await response.json()) as ApiErrorPayload;
    const message = payload.error?.message?.trim();

    if (message) {
      return message;
    }
  } catch {
    return "桌面端问答请求失败。";
  }

  return "桌面端问答请求失败。";
}
