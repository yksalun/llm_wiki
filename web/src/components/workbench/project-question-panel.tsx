"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, LoaderCircle, MessageSquare, Plus, StopCircle } from "lucide-react";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type AppendMessage,
  type MessageState,
  type TextMessagePartProps,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  createQuestionConversation,
  listQuestionConversations,
  listQuestionMessages,
  streamQuestionMessage,
} from "@/lib/client/desktop-question-api";
import type {
  DesktopBridgeConversation,
  DesktopBridgeMessage,
  DesktopBridgeReference,
} from "@/lib/types";

interface ProjectQuestionPanelProps {
  projectId: string;
  onOpenFile: (relativePath: string) => void;
}

type QuestionStatus = "loading" | "ready" | "streaming" | "error";

export function ProjectQuestionPanel({ projectId, onOpenFile }: ProjectQuestionPanelProps) {
  return (
    <ProjectQuestionPanelSession key={projectId} projectId={projectId} onOpenFile={onOpenFile} />
  );
}

function ProjectQuestionPanelSession({ projectId, onOpenFile }: ProjectQuestionPanelProps) {
  const [conversations, setConversations] = useState<DesktopBridgeConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DesktopBridgeMessage[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [streamingReferences, setStreamingReferences] = useState<DesktopBridgeReference[]>([]);
  const [status, setStatus] = useState<QuestionStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const isStreaming = status === "streaming";

  useEffect(() => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;

    function isCurrentInitialRequest() {
      return !controller.signal.aborted && requestId === requestIdRef.current;
    }

    async function loadInitialConversation() {
      try {
        const loadedConversations = await listQuestionConversations(projectId, controller.signal);
        let activeConversation = loadedConversations[0] ?? null;
        let nextConversations = loadedConversations;

        if (!activeConversation) {
          activeConversation = await createQuestionConversation(projectId, controller.signal);
          nextConversations = [activeConversation];
        }

        const loadedMessages = await listQuestionMessages(
          projectId,
          activeConversation.id,
          controller.signal,
        );

        if (!isCurrentInitialRequest()) {
          return;
        }

        setConversations(nextConversations);
        setActiveConversationId(activeConversation.id);
        setMessages(loadedMessages);
        setStatus("ready");
      } catch (error: unknown) {
        if (isAbortError(error) || controller.signal.aborted) {
          return;
        }

        if (!isCurrentInitialRequest()) {
          return;
        }

        setErrorMessage(getErrorMessage(error));
        setStatus("error");
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    }

    void loadInitialConversation();

    return () => {
      requestIdRef.current += 1;
      controller.abort();
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, [projectId]);

  async function handleNewConversation() {
    if (isStreaming) {
      return;
    }

    const controller = replaceAbortController();
    const requestId = nextRequestId();

    setStatus("loading");
    setErrorMessage(null);
    setStreamingText("");
    setStreamingReferences([]);

    try {
      const conversation = await createQuestionConversation(projectId, controller.signal);
      const loadedMessages = await listQuestionMessages(projectId, conversation.id, controller.signal);

      if (!isCurrentRequest(controller, requestId)) {
        return;
      }

      setConversations((current) => [conversation, ...current]);
      setActiveConversationId(conversation.id);
      setMessages(loadedMessages);
      setStatus("ready");
    } catch (error: unknown) {
      if (isAbortError(error) || controller.signal.aborted) {
        return;
      }

      if (!isCurrentRequest(controller, requestId)) {
        return;
      }

      setErrorMessage(getErrorMessage(error));
      setStatus("error");
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  }

  async function handleSelectConversation(conversationId: string) {
    if (isStreaming || conversationId === activeConversationId) {
      return;
    }

    const controller = replaceAbortController();
    const requestId = nextRequestId();

    setStatus("loading");
    setErrorMessage(null);
    setStreamingText("");
    setStreamingReferences([]);

    try {
      const loadedMessages = await listQuestionMessages(projectId, conversationId, controller.signal);

      if (!isCurrentRequest(controller, requestId)) {
        return;
      }

      setActiveConversationId(conversationId);
      setMessages(loadedMessages);
      setStatus("ready");
    } catch (error: unknown) {
      if (isAbortError(error) || controller.signal.aborted) {
        return;
      }

      if (!isCurrentRequest(controller, requestId)) {
        return;
      }

      setErrorMessage(getErrorMessage(error));
      setStatus("error");
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  }

  const handleSendMessage = useCallback(
    async (submittedMessage: string) => {
      if (status !== "ready" || !activeConversationId) {
        return;
      }

      const controller = replaceAbortController();
      const requestId = nextRequestId();
      const optimisticMessage: DesktopBridgeMessage = {
        id: `local-${requestId}`,
        role: "user",
        content: submittedMessage,
        timestamp: Date.now(),
        conversationId: activeConversationId,
      };

      setMessages((current) => [...current, optimisticMessage]);
      setStreamingText("");
      setStreamingReferences([]);
      setErrorMessage(null);
      setStatus("streaming");

      void streamQuestionMessage(projectId, activeConversationId, submittedMessage, {
        signal: controller.signal,
        onToken: (text) => {
          if (!isCurrentRequest(controller, requestId)) {
            return;
          }

          setStreamingText((current) => `${current}${text}`);
        },
        onReferences: (references) => {
          if (!isCurrentRequest(controller, requestId)) {
            return;
          }

          setStreamingReferences(references);
        },
        onDone: (message) => {
          if (!isCurrentRequest(controller, requestId)) {
            return;
          }

          setMessages((current) => [...current, message]);
          setStreamingText("");
          setStreamingReferences([]);
          setStatus("ready");
        },
        onError: (_code, message) => {
          if (!isCurrentRequest(controller, requestId)) {
            return;
          }

          setErrorMessage(message || "桌面端问答服务不可用");
          setStatus("error");
        },
      })
        .catch((error: unknown) => {
          if (isAbortError(error) || controller.signal.aborted) {
            return;
          }

          if (!isCurrentRequest(controller, requestId)) {
            return;
          }

          setErrorMessage(getErrorMessage(error));
          setStatus("error");
        })
        .finally(() => {
          if (!isCurrentRequest(controller, requestId)) {
            return;
          }

          if (abortControllerRef.current === controller) {
            abortControllerRef.current = null;
          }

          setStreamingText("");
          setStreamingReferences([]);
          setStatus((current) => (current === "streaming" ? "ready" : current));
        });
    },
    [activeConversationId, projectId, status],
  );

  const handleStop = useCallback(() => {
    if (!isStreaming) {
      return;
    }

    requestIdRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setStreamingText("");
    setStreamingReferences([]);
    setStatus("ready");
  }, [isStreaming]);

  function replaceAbortController() {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    return controller;
  }

  function nextRequestId() {
    requestIdRef.current += 1;
    return requestIdRef.current;
  }

  function isCurrentRequest(controller: AbortController, requestId: number) {
    return !controller.signal.aborted && requestId === requestIdRef.current;
  }

  const activeConversation = conversations.find(
    (conversation) => conversation.id === activeConversationId,
  );
  const renderedMessages = useMemo(
    () => [
      ...messages,
      ...(streamingText || streamingReferences.length > 0
        ? [
            {
              id: "streaming",
              role: "assistant" as const,
              content: streamingText,
              timestamp: Date.now(),
              conversationId: activeConversationId ?? "",
              references: streamingReferences,
            },
          ]
        : []),
    ],
    [activeConversationId, messages, streamingReferences, streamingText],
  );
  const runtime = useExternalStoreRuntime<DesktopBridgeMessage>({
    messages: renderedMessages,
    isRunning: isStreaming,
    isLoading: status === "loading",
    isDisabled: status === "loading" || activeConversationId === null || status === "error",
    convertMessage: toThreadMessageLike,
    onNew: async (message) => {
      const text = getAppendMessageText(message);

      if (text) {
        await handleSendMessage(text);
      }
    },
    onCancel: async () => {
      handleStop();
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
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
                  void handleNewConversation();
                }}
                disabled={isStreaming || status === "loading"}
              >
                <Plus className="size-4" aria-hidden="true" />
                新会话
              </Button>
            </div>

            <div className="space-y-2">
              {conversations.length > 0 ? (
                conversations.map((conversation) => (
                  <Button
                    key={conversation.id}
                    type="button"
                    size="sm"
                    variant={conversation.id === activeConversationId ? "secondary" : "ghost"}
                    className="h-auto w-full justify-start whitespace-normal px-2 py-2 text-left"
                    onClick={() => {
                      void handleSelectConversation(conversation.id);
                    }}
                    disabled={isStreaming || status === "loading"}
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

          <ThreadPrimitive.Root className="flex min-h-[28rem] flex-col rounded-md border border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--paper-border)] px-4 py-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="size-4 text-muted-foreground" aria-hidden="true" />
                <h2 className="text-sm font-medium text-[color:var(--ink-strong)]">项目问答</h2>
              </div>
              {activeConversation ? (
                <p className="text-xs text-muted-foreground">当前会话：{activeConversation.title}</p>
              ) : null}
            </div>

            <ThreadPrimitive.Viewport
              className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4"
              autoScroll
            >
              <ThreadPrimitive.Empty>
                {status !== "loading" ? (
                  <p className="rounded-md border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] px-3 py-2 text-sm text-muted-foreground">
                    暂无消息
                  </p>
                ) : null}
              </ThreadPrimitive.Empty>
              <ThreadPrimitive.Messages>
                {({ message }) => <ChatMessage message={message} onOpenFile={onOpenFile} />}
              </ThreadPrimitive.Messages>
            </ThreadPrimitive.Viewport>

            {status === "loading" ? (
              <div className="mx-4 mb-3 flex items-center gap-2 rounded-md border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] px-3 py-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                正在加载项目问答
              </div>
            ) : null}

            {status === "error" ? (
              <Alert
                variant="destructive"
                className="mx-4 mb-3 border-destructive/20 bg-destructive/5"
              >
                <MessageSquare className="size-4" />
                <AlertTitle>问答失败</AlertTitle>
                <AlertDescription>{errorMessage ?? "桌面端问答服务不可用"}</AlertDescription>
              </Alert>
            ) : null}

            <ComposerPrimitive.Root className="border-t border-[color:var(--paper-border)] p-3">
              <ComposerPrimitive.Input
                aria-label="项目问答输入"
                placeholder="询问这个项目"
                submitMode="enter"
                className="min-h-20 w-full resize-none rounded-md border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] px-3 py-2 text-sm leading-6 text-[color:var(--ink-strong)] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {isStreaming ? "正在生成回答" : "回答来自桌面端项目问答服务"}
                </p>
                <div className="flex items-center gap-2">
                  {isStreaming ? (
                    <ComposerPrimitive.Cancel className="inline-flex h-8 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50">
                      <StopCircle className="size-4" aria-hidden="true" />
                      停止
                    </ComposerPrimitive.Cancel>
                  ) : null}
                  <ComposerPrimitive.Send className="inline-flex h-8 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50">
                    {isStreaming ? (
                      <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <MessageSquare className="size-4" aria-hidden="true" />
                    )}
                    发送
                  </ComposerPrimitive.Send>
                </div>
              </div>
            </ComposerPrimitive.Root>
          </ThreadPrimitive.Root>
        </div>
      </section>
    </AssistantRuntimeProvider>
  );
}

function ChatMessage({
  message,
  onOpenFile,
}: {
  message: MessageState;
  onOpenFile: (relativePath: string) => void;
}) {
  const label =
    message.role === "user" ? "用户" : message.role === "assistant" ? "助手" : "系统";

  return (
    <MessagePrimitive.Root className="rounded-md border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-1">
        <MessagePrimitive.Parts components={{ Text: MarkdownTextPart }} />
      </div>
      {getMessageReferences(message).length > 0 ? (
        <ul className="mt-3 space-y-2">
          {getMessageReferences(message).map((reference) => (
            <li key={`${reference.path}-${reference.title}`}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-auto w-full justify-start whitespace-normal text-left"
                onClick={() => onOpenFile(reference.path)}
              >
                <ExternalLink className="size-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block font-medium">{reference.title}</span>
                  <span className="block text-xs text-muted-foreground">{reference.path}</span>
                </span>
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </MessagePrimitive.Root>
  );
}

function MarkdownTextPart(_props: TextMessagePartProps) {
  return (
    <MarkdownTextPrimitive
      className="space-y-2 text-sm leading-6 text-[color:var(--ink-strong)]"
      components={{
        h1: ({ children }) => (
          <h1 className="text-lg font-semibold text-[color:var(--ink-strong)]">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-base font-semibold text-[color:var(--ink-strong)]">{children}</h2>
        ),
        ul: ({ children }) => <ul className="ml-5 list-disc space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="ml-5 list-decimal space-y-1">{children}</ol>,
        code: ({ children }) => (
          <code className="rounded bg-[color:var(--paper-elevated)] px-1 py-0.5 font-mono text-[0.85em]">
            {children}
          </code>
        ),
      }}
    />
  );
}

function toThreadMessageLike(message: DesktopBridgeMessage): ThreadMessageLike {
  const running = message.id === "streaming";

  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: new Date(message.timestamp || Date.now()),
    status:
      message.role === "assistant"
        ? running
          ? { type: "running" }
          : { type: "complete", reason: "stop" }
        : undefined,
    metadata: {
      custom: {
        references: message.references ?? [],
      },
    },
  };
}

function getAppendMessageText(message: AppendMessage) {
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
    .trim();
}

function getMessageReferences(message: MessageState): DesktopBridgeReference[] {
  const references = message.metadata.custom.references;

  if (!Array.isArray(references)) {
    return [];
  }

  return references.filter(isDesktopBridgeReference);
}

function isDesktopBridgeReference(reference: unknown): reference is DesktopBridgeReference {
  if (!reference || typeof reference !== "object") {
    return false;
  }

  const candidate = reference as Partial<DesktopBridgeReference>;
  return typeof candidate.title === "string" && typeof candidate.path === "string";
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "桌面端问答服务不可用";
}
