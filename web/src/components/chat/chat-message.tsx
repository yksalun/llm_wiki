"use client";

import { useEffect, useRef, useState } from "react";
import {
  BookmarkPlus,
  Check,
  Copy,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { QuestionReferences } from "@/components/workbench/question-references";
import type { DesktopBridgeMessage, DesktopBridgeReference } from "@/lib/types";
import { cn } from "@/lib/utils";

export type AnswerActionKind = "copy" | "save" | "regenerate";

export interface AnswerActionRequest {
  conversationId: string;
  messageId: string;
  content: string;
  references: DesktopBridgeReference[];
  signal?: AbortSignal;
}

export type AnswerActionHandler = (
  action: AnswerActionKind,
  request: AnswerActionRequest,
) => Promise<void>;

export function ChatMessage({
  projectId,
  message,
  hiddenMessageId,
  isLast,
  onAnswerAction,
}: {
  projectId: string;
  message: DesktopBridgeMessage;
  hiddenMessageId: string | null;
  isLast: boolean;
  onAnswerAction: AnswerActionHandler;
}) {
  if (hiddenMessageId === message.id) {
    return null;
  }

  const isUserMessage = message.role === "user";
  const references = getMessageReferences(message.references);
  const isAssistantMessage = message.role === "assistant";

  return (
    <div
      data-message-role={message.role}
      data-message-align={isUserMessage ? "right" : "left"}
      className={cn("flex w-full", isUserMessage ? "justify-end" : "justify-start")}
    >
      {isAssistantMessage ? (
        <AssistantAnswerMessage
          projectId={projectId}
          message={message}
          references={references}
          isLast={isLast}
          onAnswerAction={onAnswerAction}
        />
      ) : (
        <div
          className={cn(
            "max-w-[78%] rounded-md border p-3",
            isUserMessage
              ? "border-primary/25 bg-primary text-primary-foreground"
              : "border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] text-[color:var(--ink-strong)]",
          )}
        >
          <MessageContent content={message.content} />
        </div>
      )}
    </div>
  );
}

function AssistantAnswerMessage({
  projectId,
  message,
  references,
  isLast,
  onAnswerAction,
}: {
  projectId: string;
  message: DesktopBridgeMessage;
  references: DesktopBridgeReference[];
  isLast: boolean;
  onAnswerAction: AnswerActionHandler;
}) {
  return (
    <div
      data-answer-message="true"
      className="group max-w-[78%] rounded-md border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] p-3 text-[color:var(--ink-strong)]"
    >
      <AnswerContent message={message} />
      {references.length > 0 ? (
        <div data-answer-references="true">
          <QuestionReferences projectId={projectId} references={references} />
        </div>
      ) : null}
      <AnswerActions
        message={message}
        references={references}
        isLast={isLast}
        onAnswerAction={onAnswerAction}
      />
    </div>
  );
}

function AnswerContent({ message }: { message: DesktopBridgeMessage }) {
  const isThinking = isStreamingMessageId(message.id) && getMessageText(message.content).length === 0;

  return (
    <div data-answer-content="true">
      {isThinking ? <ThinkingIndicator /> : <MarkdownContent content={message.content} />}
    </div>
  );
}

function MessageContent({ content }: { content: string }) {
  return (
    <div>
      <MarkdownContent content={content} />
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div
      data-thinking-indicator="true"
      className="inline-flex items-center gap-2 text-sm text-muted-foreground"
    >
      <span>思考中</span>
      <span className="inline-flex items-center gap-1" aria-hidden="true">
        <span className="size-1.5 rounded-full bg-current opacity-60 animate-[pulse_1s_ease-in-out_infinite]" />
        <span className="size-1.5 rounded-full bg-current opacity-60 animate-[pulse_1s_ease-in-out_0.15s_infinite]" />
        <span className="size-1.5 rounded-full bg-current opacity-60 animate-[pulse_1s_ease-in-out_0.3s_infinite]" />
      </span>
    </div>
  );
}

function AnswerActions({
  message,
  references,
  isLast,
  onAnswerAction,
}: {
  message: DesktopBridgeMessage;
  references: DesktopBridgeReference[];
  isLast: boolean;
  onAnswerAction: AnswerActionHandler;
}) {
  const [pendingAction, setPendingAction] = useState<AnswerActionKind | null>(null);
  const [completedAction, setCompletedAction] = useState<AnswerActionKind | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const conversationId = message.conversationId;
  const canRunActions =
    !isStreamingMessageId(message.id) &&
    conversationId.length > 0;
  const canRegenerate = canRunActions && isLast;

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  if (!canRunActions) {
    return null;
  }

  async function runAction(action: AnswerActionKind) {
    if (pendingAction) {
      return;
    }

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setPendingAction(action);
    setCompletedAction(null);
    setErrorMessage(null);

    try {
      const content = getMessageText(message.content);

      if (action === "copy") {
        await navigator.clipboard.writeText(content);

        if (!controller.signal.aborted) {
          setCompletedAction(action);
        }

        return;
      }

      await onAnswerAction(action, {
        conversationId,
        messageId: message.id,
        content,
        references,
        signal: controller.signal,
      });

      if (!controller.signal.aborted) {
        setCompletedAction(action);
      }
    } catch (error: unknown) {
      if (!controller.signal.aborted) {
        setErrorMessage(getErrorMessage(error));
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }

      if (!controller.signal.aborted) {
        setPendingAction(null);
      }
    }
  }

  return (
    <div
      data-answer-actions="true"
      className="mt-2 flex flex-col items-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
    >
      <div className="flex flex-wrap items-center justify-end gap-1">
        <AnswerActionButton
          action="copy"
          label="复制"
          icon={Copy}
          pendingAction={pendingAction}
          completedAction={completedAction}
          onClick={runAction}
        />
        <AnswerActionButton
          action="save"
          label="保存到 Wiki"
          icon={BookmarkPlus}
          pendingAction={pendingAction}
          completedAction={completedAction}
          onClick={runAction}
        />
        {canRegenerate ? (
          <AnswerActionButton
            action="regenerate"
            label="重新生成"
            icon={RefreshCw}
            pendingAction={pendingAction}
            completedAction={completedAction}
            onClick={runAction}
          />
        ) : null}
      </div>
      {errorMessage ? (
        <p
          data-answer-action-error="true"
          className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive"
        >
          <TriangleAlert className="size-3" aria-hidden="true" />
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}

function AnswerActionButton({
  action,
  label,
  icon: Icon,
  pendingAction,
  completedAction,
  onClick,
}: {
  action: AnswerActionKind;
  label: string;
  icon: typeof Copy;
  pendingAction: AnswerActionKind | null;
  completedAction: AnswerActionKind | null;
  onClick: (action: AnswerActionKind) => void;
}) {
  const isPending = pendingAction === action;
  const isCompleted = completedAction === action;
  const ButtonIcon = isCompleted ? Check : Icon;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:bg-muted/30 hover:text-foreground"
      disabled={pendingAction !== null}
      onClick={() => {
        onClick(action);
      }}
    >
      <ButtonIcon
        className={cn("size-3.5", isPending && "animate-spin")}
        aria-hidden="true"
      />
      {label}
    </Button>
  );
}

function MarkdownContent({ content }: { content: string }) {
  const blocks = parseMarkdownBlocks(stripHiddenHtmlComments(content));

  return (
    <div className="space-y-2 text-sm leading-6 text-inherit">
      {blocks.map((block, index) => {
        if (block.type === "h1") {
          return (
            <h1 key={index} className="text-lg font-semibold text-inherit">
              {renderInlineMarkdown(block.text)}
            </h1>
          );
        }

        if (block.type === "h2") {
          return (
            <h2 key={index} className="text-base font-semibold text-inherit">
              {renderInlineMarkdown(block.text)}
            </h2>
          );
        }

        if (block.type === "ul") {
          return (
            <ul key={index} className="ml-5 list-disc space-y-1">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
              ))}
            </ul>
          );
        }

        if (block.type === "ol") {
          return (
            <ol key={index} className="ml-5 list-decimal space-y-1">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
              ))}
            </ol>
          );
        }

        if (block.type === "p") {
          return <p key={index}>{renderInlineMarkdown(block.text)}</p>;
        }

        return null;
      })}
    </div>
  );
}

type MarkdownBlock =
  | { type: "h1" | "h2" | "p"; text: string }
  | { type: "ul" | "ol"; items: string[] };

function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.split(/\r?\n/);
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("# ")) {
      blocks.push({ type: "h1", text: trimmed.slice(2).trim() });
      index += 1;
      continue;
    }

    if (trimmed.startsWith("## ")) {
      blocks.push({ type: "h2", text: trimmed.slice(3).trim() });
      index += 1;
      continue;
    }

    if (trimmed.startsWith("- ")) {
      const items: string[] = [];
      while (index < lines.length && (lines[index] ?? "").trim().startsWith("- ")) {
        items.push((lines[index] ?? "").trim().slice(2).trim());
        index += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test((lines[index] ?? "").trim())) {
        items.push((lines[index] ?? "").trim().replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const paragraphLine = (lines[index] ?? "").trim();
      if (
        !paragraphLine ||
        paragraphLine.startsWith("# ") ||
        paragraphLine.startsWith("## ") ||
        paragraphLine.startsWith("- ") ||
        /^\d+\.\s+/.test(paragraphLine)
      ) {
        break;
      }

      paragraph.push(paragraphLine);
      index += 1;
    }
    blocks.push({ type: "p", text: paragraph.join(" ") });
  }

  return blocks;
}

function renderInlineMarkdown(text: string) {
  return text.split(/(`[^`]+`|\*\*[^*]+?\*\*)/g).map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={index}
          className="rounded bg-[color:var(--paper-elevated)] px-1 py-0.5 font-mono text-[0.85em]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={index} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }

    return part;
  });
}

export function stripHiddenHtmlComments(content: string) {
  return content.replace(/<!--[\s\S]*?-->/g, "").trimEnd();
}

function getMessageReferences(
  references: DesktopBridgeMessage["references"],
): DesktopBridgeReference[] {
  if (!Array.isArray(references)) {
    return [];
  }

  return references.filter(isDesktopBridgeReference);
}

function isStreamingMessageId(messageId: string) {
  return messageId === "streaming";
}

export function getMessageText(content: string) {
  return stripHiddenHtmlComments(content).trim();
}

function isDesktopBridgeReference(reference: unknown): reference is DesktopBridgeReference {
  if (!reference || typeof reference !== "object") {
    return false;
  }

  const candidate = reference as Partial<DesktopBridgeReference>;
  return typeof candidate.title === "string" && typeof candidate.path === "string";
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "桌面端问答服务不可用";
}
