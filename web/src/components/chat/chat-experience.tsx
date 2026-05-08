"use client";

import { useEffect, useRef } from "react";
import { LoaderCircle, MessageSquare, StopCircle } from "lucide-react";

import { ChatMessage } from "@/components/chat/chat-message";
import { ChatSessionList } from "@/components/chat/chat-session-list";
import { useQuestionSession } from "@/components/chat/use-question-session";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { DesktopBridgeConversation } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface ChatExperienceProps {
  projectId: string | null;
  mode: "home" | "project";
  title: string;
  subtitle?: string;
  showSessionList: boolean;
  disabledMessage?: string;
  composerTopSlot?: React.ReactNode;
  className?: string;
  minHeightClassName?: string;
  requestedConversationId?: string | null;
  newConversationRequestId?: number;
  onConversationChange?: (event: {
    projectId: string;
    conversation: DesktopBridgeConversation | null;
  }) => void;
}

export function ChatExperience({
  projectId,
  mode,
  title,
  subtitle,
  showSessionList,
  disabledMessage = "请先选择知识库再提问。",
  composerTopSlot,
  className,
  minHeightClassName = "min-h-[28rem]",
  requestedConversationId,
  newConversationRequestId,
  onConversationChange,
}: ChatExperienceProps) {
  const isHomeMode = mode === "home";
  const emptyHomeComposerState = isHomeMode ? "empty" : undefined;

  if (!projectId) {
    return (
      <section
        data-chat-experience={mode}
        className={cn(
          isHomeMode
            ? "flex min-w-0 max-w-full flex-1 flex-col bg-transparent"
            : "flex min-w-0 max-w-full flex-1 flex-col overflow-hidden rounded-lg border border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]",
          minHeightClassName,
          className,
        )}
      >
        <div
          className={cn(
            "flex min-w-0 w-full flex-1",
            isHomeMode ? "items-center justify-center" : "items-center justify-center p-4",
          )}
        >
          <div
            data-chat-composer={mode}
            data-chat-composer-state={emptyHomeComposerState}
            className={cn(
              "min-w-0 w-full max-w-full",
              isHomeMode
                ? "z-10 mx-auto max-w-3xl bg-[color:var(--paper-base)]/95 px-0 pb-4 pt-3 backdrop-blur"
                : "rounded-lg border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] p-4 md:max-w-3xl",
            )}
          >
            <div
              className={cn(
                isHomeMode &&
                  "rounded-2xl border border-[color:var(--paper-border)] bg-[color:var(--paper-panel)] p-3 shadow-lg shadow-black/10",
              )}
            >
            {composerTopSlot}
            <div className={cn("mt-3", !composerTopSlot && "mt-0")}>
              <textarea
                aria-label="知识库问答输入"
                placeholder="询问这个知识库"
                disabled
                className={cn(
                  "min-h-20 w-full resize-none text-sm leading-6 text-[color:var(--ink-strong)] outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60",
                  isHomeMode
                    ? "rounded-lg border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] px-3 py-2 focus-visible:ring-2 focus-visible:ring-ring"
                    : "rounded-md border border-[color:var(--paper-border)] bg-[color:var(--paper-panel)] px-3 py-2",
                )}
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                <p className="min-w-0 flex-1 break-words text-xs text-muted-foreground">{disabledMessage}</p>
                <Button type="button" size="sm" disabled className="shrink-0">
                  <MessageSquare className="size-4" aria-hidden="true" />
                  发送
                </Button>
              </div>
            </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <ActiveChatExperience
      projectId={projectId}
      mode={mode}
      title={title}
      subtitle={subtitle}
      showSessionList={showSessionList}
      composerTopSlot={composerTopSlot}
      className={className}
      minHeightClassName={minHeightClassName}
      requestedConversationId={requestedConversationId}
      newConversationRequestId={newConversationRequestId}
      onConversationChange={onConversationChange}
    />
  );
}

interface ActiveChatExperienceProps extends Omit<ChatExperienceProps, "projectId"> {
  projectId: string;
}

function ActiveChatExperience({
  projectId,
  mode,
  title,
  subtitle,
  showSessionList,
  composerTopSlot,
  className,
  minHeightClassName = "min-h-[28rem]",
  requestedConversationId,
  newConversationRequestId,
  onConversationChange,
}: ActiveChatExperienceProps) {
  const isHomeMode = mode === "home";
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);
  const isComposingRef = useRef(false);
  const lastRequestedConversationIdRef = useRef<string | null>(null);
  const lastNewConversationRequestIdRef = useRef<number | null>(null);
  const session = useQuestionSession({
    projectId,
    autoStartConversation: !isHomeMode,
    onConversationChange,
  });
  const trimmedDraft = session.draft.trim();
  const lastRenderedMessage =
    session.renderedMessages[session.renderedMessages.length - 1] ?? null;
  const hasHomeConversationContent = isHomeMode && session.renderedMessages.length > 0;

  useEffect(() => {
    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    if (typeof viewport.scrollTo === "function") {
      viewport.scrollTo({ top: viewport.scrollHeight });
      return;
    }

    viewport.scrollTop = viewport.scrollHeight;
  }, [
    session.renderedMessages.length,
    hasHomeConversationContent,
    isHomeMode,
    lastRenderedMessage?.content,
    session.status,
  ]);

  useEffect(() => {
    if (!requestedConversationId) {
      lastRequestedConversationIdRef.current = null;
      if (isHomeMode && session.activeConversationId) {
        session.handleClearConversation();
      }
      return;
    }

    if (session.status !== "ready") {
      return;
    }

    if (requestedConversationId === session.activeConversationId) {
      lastRequestedConversationIdRef.current = requestedConversationId;
      return;
    }

    if (lastRequestedConversationIdRef.current === requestedConversationId) {
      return;
    }

    lastRequestedConversationIdRef.current = requestedConversationId;
    void session.handleSelectConversation(requestedConversationId);
  }, [
    isHomeMode,
    requestedConversationId,
    session.activeConversationId,
    session.handleClearConversation,
    session.handleSelectConversation,
    session,
    session.status,
  ]);

  useEffect(() => {
    if (!newConversationRequestId) {
      return;
    }

    if (session.status !== "ready") {
      return;
    }

    if (lastNewConversationRequestIdRef.current === newConversationRequestId) {
      return;
    }

    lastNewConversationRequestIdRef.current = newConversationRequestId;
    void session.handleNewConversation();
  }, [newConversationRequestId, session.handleNewConversation, session.status, session]);

  function handleDraftKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    if (event.nativeEvent.isComposing || isComposingRef.current) {
      return;
    }

    event.preventDefault();

    if (!session.canSendMessage) {
      return;
    }

    void session.handleSendMessage(trimmedDraft);
  }

  const chatPanel = (
    <div
      className={cn(
        isHomeMode
          ? "flex h-full min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden bg-transparent"
          : "flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden rounded-md border border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]",
        isHomeMode && !hasHomeConversationContent && "justify-center",
        minHeightClassName,
      )}
    >
      {!isHomeMode ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--paper-border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-sm font-medium text-[color:var(--ink-strong)]">{title}</h2>
        </div>
        {session.activeConversation ? (
          <p className="text-xs text-muted-foreground">
            {subtitle ?? `当前会话：${session.activeConversation.title}`}
          </p>
        ) : null}
        </div>
      ) : null}

      <div
        ref={viewportRef}
        data-chat-message-viewport={mode}
        className={cn(
          isHomeMode
            ? "chat-home-message-scrollbar mr-0 min-h-0 w-full max-w-none flex-1 overflow-y-auto pl-0 pr-0 py-4"
            : "min-h-0 flex-1 space-y-3 overflow-y-auto p-4",
          isHomeMode && !hasHomeConversationContent && "hidden",
        )}
      >
        <div
          data-chat-message-rail={mode}
          className={cn(isHomeMode ? "mx-auto w-full max-w-3xl space-y-3" : "space-y-3")}
        >
          {!isHomeMode && session.renderedMessages.length === 0 && session.status !== "loading" ? (
            <p className="rounded-md border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] px-3 py-2 text-sm text-muted-foreground">
              暂无消息
            </p>
          ) : null}
          {session.renderedMessages.map((message, index) => (
            <ChatMessage
              key={message.id}
              projectId={projectId}
              message={message}
              hiddenMessageId={session.hiddenMessageId}
              isLast={index === session.renderedMessages.length - 1}
              onAnswerAction={session.handleAnswerAction}
            />
          ))}
        </div>
      </div>

      {session.status === "loading" ? (
        <div
          data-chat-status-rail={mode}
          className={cn(isHomeMode ? "mx-auto w-full max-w-3xl" : "mx-4")}
        >
          <div className="mb-3 flex items-center gap-2 rounded-md border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] px-3 py-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            正在加载项目问答
          </div>
        </div>
      ) : null}

      {session.errorMessage ? (
        <div
          data-chat-status-rail={mode}
          className={cn(isHomeMode ? "mx-auto w-full max-w-3xl" : "mx-4")}
        >
          <Alert variant="destructive" className="mb-3 border-destructive/20 bg-destructive/5">
            <MessageSquare className="size-4" />
            <AlertTitle>问答失败</AlertTitle>
            <AlertDescription>{session.errorMessage}</AlertDescription>
          </Alert>
        </div>
      ) : null}

      <form
        ref={composerRef}
        data-chat-composer={mode}
        data-chat-composer-state={isHomeMode ? (hasHomeConversationContent ? "active" : "empty") : undefined}
        className={cn(
          isHomeMode
            ? hasHomeConversationContent
              ? "shrink-0 bg-[color:var(--paper-base)]/95 pb-4 pt-3 backdrop-blur"
              : "z-10 mx-auto w-full max-w-3xl bg-[color:var(--paper-base)]/95 px-0 pb-4 pt-3 backdrop-blur"
            : "border-t border-[color:var(--paper-border)] p-3",
        )}
        onSubmit={(event) => {
          event.preventDefault();
          if (session.canSendMessage) {
            void session.handleSendMessage(trimmedDraft);
          }
        }}
      >
        <div
          className={cn(
            isHomeMode &&
              "mx-auto w-full max-w-3xl rounded-2xl border border-[color:var(--paper-border)] bg-[color:var(--paper-panel)] p-3 shadow-lg shadow-black/10",
          )}
        >
        {composerTopSlot ? <div className="mb-2">{composerTopSlot}</div> : null}
        <textarea
          aria-label="知识库问答输入"
          placeholder="询问这个知识库"
          value={session.draft}
          disabled={session.status === "loading"}
          onChange={(event) => session.setDraft(event.target.value)}
          onKeyDown={handleDraftKeyDown}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={(event) => {
            isComposingRef.current = false;
            session.setDraft(event.currentTarget.value);
          }}
          className={cn(
            "min-h-20 w-full resize-none text-sm leading-6 text-[color:var(--ink-strong)] outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60",
            isHomeMode
              ? "rounded-lg border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] px-3 py-2 focus-visible:ring-2 focus-visible:ring-ring"
              : "rounded-md border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] px-3 py-2 focus-visible:ring-2 focus-visible:ring-ring",
          )}
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-1 break-words text-xs text-muted-foreground">
            {session.isStreaming ? "正在生成回答" : "回答将基于所选知识库生成。"}
          </p>
          <div className="flex items-center gap-2">
            {session.isStreaming ? (
              <Button type="button" variant="outline" size="sm" onClick={session.handleStop}>
                <StopCircle className="size-4" aria-hidden="true" />
                停止
              </Button>
            ) : null}
            <Button type="submit" size="sm" disabled={!session.canSendMessage}>
              {session.isStreaming ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <MessageSquare className="size-4" aria-hidden="true" />
              )}
              发送
            </Button>
          </div>
        </div>
        </div>
      </form>
    </div>
  );

  return (
    <section data-chat-experience={mode} className={cn("min-w-0 max-w-full rounded-lg", className)}>
      {showSessionList ? (
        <div className="grid gap-3 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <ChatSessionList
            title="历史对话"
            conversations={session.conversations}
            activeConversationId={session.activeConversationId}
            disabled={session.isStreaming || session.status === "loading"}
            newConversationLabel="新会话"
            emptyLabel="暂无对话"
            onNewConversation={() => {
              void session.handleNewConversation();
            }}
            onSelectConversation={(conversationId) => {
              void session.handleSelectConversation(conversationId);
            }}
          />
          {chatPanel}
        </div>
      ) : (
        chatPanel
      )}
    </section>
  );
}
