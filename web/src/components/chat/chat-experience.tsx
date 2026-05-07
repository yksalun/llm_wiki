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
  disabledMessage = "Choose a knowledge base before asking.",
  composerTopSlot,
  className,
  minHeightClassName = "min-h-[28rem]",
  onConversationChange,
}: ChatExperienceProps) {
  if (!projectId) {
    return (
      <section
        data-chat-experience={mode}
        className={cn(
          "flex flex-1 flex-col rounded-lg border border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]",
          minHeightClassName,
          className,
        )}
      >
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="w-full max-w-3xl space-y-3 rounded-lg border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] p-4">
            {composerTopSlot}
            <p className="text-sm text-muted-foreground">{disabledMessage}</p>
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
  onConversationChange,
}: ActiveChatExperienceProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const isComposingRef = useRef(false);
  const session = useQuestionSession({ projectId, onConversationChange });
  const trimmedDraft = session.draft.trim();
  const lastRenderedMessage =
    session.renderedMessages[session.renderedMessages.length - 1] ?? null;

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
    lastRenderedMessage?.content,
    session.status,
  ]);

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
        "flex min-h-0 flex-1 flex-col rounded-md border border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]",
        minHeightClassName,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--paper-border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-sm font-medium text-[color:var(--ink-strong)]">{title}</h2>
        </div>
        {session.activeConversation ? (
          <p className="text-xs text-muted-foreground">
            {subtitle ?? `Current conversation: ${session.activeConversation.title}`}
          </p>
        ) : null}
      </div>

      <div ref={viewportRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {session.renderedMessages.length === 0 && session.status !== "loading" ? (
          <p className="rounded-md border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] px-3 py-2 text-sm text-muted-foreground">
            No messages yet
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

      {session.status === "loading" ? (
        <div className="mx-4 mb-3 flex items-center gap-2 rounded-md border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] px-3 py-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          Loading project chat
        </div>
      ) : null}

      {session.errorMessage ? (
        <Alert variant="destructive" className="mx-4 mb-3 border-destructive/20 bg-destructive/5">
          <MessageSquare className="size-4" />
          <AlertTitle>Chat failed</AlertTitle>
          <AlertDescription>{session.errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      <form
        className="border-t border-[color:var(--paper-border)] p-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (session.canSendMessage) {
            void session.handleSendMessage(trimmedDraft);
          }
        }}
      >
        {composerTopSlot ? <div className="mb-2">{composerTopSlot}</div> : null}
        <textarea
          aria-label="Project question input"
          placeholder="Ask this knowledge base"
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
          className="min-h-20 w-full resize-none rounded-md border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] px-3 py-2 text-sm leading-6 text-[color:var(--ink-strong)] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {session.isStreaming ? "Generating answer" : "Answers use the selected knowledge base."}
          </p>
          <div className="flex items-center gap-2">
            {session.isStreaming ? (
              <Button type="button" variant="outline" size="sm" onClick={session.handleStop}>
                <StopCircle className="size-4" aria-hidden="true" />
                Stop
              </Button>
            ) : null}
            <Button type="submit" size="sm" disabled={!session.canSendMessage}>
              {session.isStreaming ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <MessageSquare className="size-4" aria-hidden="true" />
              )}
              Send
            </Button>
          </div>
        </div>
      </form>
    </div>
  );

  return (
    <section data-chat-experience={mode} className={cn("rounded-lg", className)}>
      {showSessionList ? (
        <div className="grid gap-3 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <ChatSessionList
            title="History"
            conversations={session.conversations}
            activeConversationId={session.activeConversationId}
            disabled={session.isStreaming || session.status === "loading"}
            newConversationLabel="New chat"
            emptyLabel="No conversations"
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
