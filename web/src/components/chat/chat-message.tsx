"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  BookmarkPlus,
  Check,
  Copy,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";

import { AnswerMetricsPanel } from "@/components/chat/answer-metrics-panel";
import { useAnswerMetricsPreferences } from "@/components/chat/answer-metrics-preferences";
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
  const { preferences } = useAnswerMetricsPreferences();

  return (
    <div
      data-answer-message="true"
      className="group max-w-[78%] py-1 text-[color:var(--ink-strong)]"
    >
      <AnswerContent message={message} />
      {references.length > 0 ? (
        <div data-answer-references="true">
          <QuestionReferences projectId={projectId} references={references} />
        </div>
      ) : null}
      {preferences.showAnswerMetrics && message.metrics ? (
        <AnswerMetricsPanel metrics={message.metrics} />
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
  const markdown = stripHiddenHtmlComments(content);

  return (
    <div className="markdown-answer space-y-2 text-sm leading-6 text-inherit">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-lg font-semibold text-inherit">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-base font-semibold text-inherit">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-[15px] font-semibold text-inherit">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-sm font-semibold text-inherit">{children}</h4>
          ),
          p: ({ children }) => <p>{children}</p>,
          ul: ({ children }) => <ul className="ml-5 list-disc space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="ml-5 list-decimal space-y-1">{children}</ol>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-[color:var(--paper-border)] pl-3 text-muted-foreground">
              {children}
            </blockquote>
          ),
          code: ({ children, className }) => {
            const isBlock = className?.startsWith("language-");

            return isBlock ? (
              <code className={cn("font-mono text-[0.85em]", className)}>
                {children}
              </code>
            ) : (
              <code className="rounded bg-[color:var(--paper-elevated)] px-1 py-0.5 font-mono text-[0.85em]">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-md bg-[color:var(--paper-elevated)] p-3 leading-6">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] px-2 py-1 font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-[color:var(--paper-border)] px-2 py-1">{children}</td>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              className="font-medium underline underline-offset-2"
              rel="noreferrer"
              target="_blank"
            >
              {children}
            </a>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
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
