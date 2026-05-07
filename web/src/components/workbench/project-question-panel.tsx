"use client";

import { useEffect, useRef } from "react";
import {
  LoaderCircle,
  MessageSquare,
  Plus,
  StopCircle,
} from "lucide-react";

import { ChatMessage } from "@/components/chat/chat-message";
import { useQuestionSession } from "@/components/chat/use-question-session";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ProjectQuestionPanelProps {
  projectId: string;
  onOpenFile: (relativePath: string) => void;
}

export function ProjectQuestionPanel({ projectId }: ProjectQuestionPanelProps) {
  return <ProjectQuestionPanelSession key={projectId} projectId={projectId} />;
}

function ProjectQuestionPanelSession({ projectId }: { projectId: string }) {
  const session = useQuestionSession({ projectId });
  const isComposingRef = useRef(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const trimmedDraft = session.draft.trim();
  const lastRenderedMessage =
    session.renderedMessages[session.renderedMessages.length - 1] ?? null;

  useEffect(() => {
    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    viewport.scrollTo({ top: viewport.scrollHeight });
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

  return (
    <>
      <section className="rounded-lg border border-[color:var(--paper-border)] bg-[color:var(--paper-panel)] p-3">
        <div className="grid gap-3 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <aside className="space-y-3 rounded-md border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <MessageSquare className="size-4 text-muted-foreground" aria-hidden="true" />
                <h2 className="text-sm font-medium text-[color:var(--ink-strong)]">历史会话</h2>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  void session.handleNewConversation();
                }}
                disabled={session.isStreaming || session.status === "loading"}
              >
                <Plus className="size-4" aria-hidden="true" />
                新会话
              </Button>
            </div>

            <div className="space-y-2">
              {session.conversations.length > 0 ? (
                session.conversations.map((conversation) => (
                  <Button
                    key={conversation.id}
                    type="button"
                    size="sm"
                    aria-current={
                      conversation.id === session.activeConversationId ? "true" : undefined
                    }
                    variant="ghost"
                    className={cn(
                      "h-auto w-full justify-start whitespace-normal border px-2 py-2 text-left",
                      conversation.id === session.activeConversationId
                        ? "border-[color:var(--ring)] bg-[color:var(--paper-panel)] font-semibold text-[color:var(--ink-strong)] shadow-sm"
                        : "border-transparent text-muted-foreground",
                    )}
                    onClick={() => {
                      void session.handleSelectConversation(conversation.id);
                    }}
                    disabled={session.isStreaming || session.status === "loading"}
                  >
                    {conversation.title || "未命名会话"}
                  </Button>
                ))
              ) : (
                <p className="rounded-md border border-[color:var(--paper-border)] bg-[color:var(--paper-panel)] px-3 py-2 text-sm text-muted-foreground">
                  暂无会话
                </p>
              )}
            </div>
          </aside>

          <div
            className="flex min-h-[28rem] flex-col rounded-md border border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--paper-border)] px-4 py-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="size-4 text-muted-foreground" aria-hidden="true" />
                <h2 className="text-sm font-medium text-[color:var(--ink-strong)]">项目问答</h2>
              </div>
              {session.activeConversation ? (
                <p className="text-xs text-muted-foreground">
                  当前会话：{session.activeConversation.title}
                </p>
              ) : null}
            </div>

            <div
              ref={viewportRef}
              className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4"
            >
              {session.renderedMessages.length === 0 && session.status !== "loading" ? (
                <p className="rounded-md border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] px-3 py-2 text-sm text-muted-foreground">
                  暂无消息
                </p>
              ) : null}
              {session.renderedMessages.map((message, index) => (
                <ChatMessage
                  key={message.id}
                  projectId={session.projectId}
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
                正在加载项目问答
              </div>
            ) : null}

            {session.errorMessage ? (
              <Alert
                variant="destructive"
                className="mx-4 mb-3 border-destructive/20 bg-destructive/5"
              >
                <MessageSquare className="size-4" />
                <AlertTitle>问答失败</AlertTitle>
                <AlertDescription>{session.errorMessage}</AlertDescription>
              </Alert>
            ) : null}

            <form
              className="border-t border-[color:var(--paper-border)] p-3"
              onSubmit={(event) => {
                event.preventDefault();

                if (!session.canSendMessage) {
                  return;
                }

                void session.handleSendMessage(trimmedDraft);
              }}
            >
              <textarea
                aria-label="项目问答输入"
                placeholder="询问这个项目"
                value={session.draft}
                disabled={session.status === "loading"}
                onChange={(event) => {
                  session.setDraft(event.target.value);
                }}
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
                  {session.isStreaming
                    ? "正在生成回答"
                    : "回答来自桌面端项目问答服务"}
                </p>
                <div className="flex items-center gap-2">
                  {session.isStreaming ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={session.handleStop}
                    >
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
            </form>
          </div>
        </div>
      </section>
    </>
  );
}
