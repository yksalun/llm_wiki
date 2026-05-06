"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookmarkPlus,
  Check,
  Copy,
  LoaderCircle,
  MessageSquare,
  Plus,
  RefreshCw,
  StopCircle,
  TriangleAlert,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { QuestionReferences } from "@/components/workbench/question-references";
import { cn } from "@/lib/utils";
import {
  createQuestionConversation,
  listQuestionConversations,
  listQuestionMessages,
  saveQuestionAnswerToWiki,
  streamRegenerateQuestionAnswer,
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
type AnswerActionKind = "copy" | "save" | "regenerate";
const STREAM_TYPE_INTERVAL_MS = 8;

interface AnswerActionRequest {
  conversationId: string;
  messageId: string;
  content: string;
  references: DesktopBridgeReference[];
  signal?: AbortSignal;
}

type AnswerActionHandler = (
  action: AnswerActionKind,
  request: AnswerActionRequest,
) => Promise<void>;

export function ProjectQuestionPanel({ projectId }: ProjectQuestionPanelProps) {
  return <ProjectQuestionPanelSession key={projectId} projectId={projectId} />;
}

function ProjectQuestionPanelSession({ projectId }: { projectId: string }) {
  const [conversations, setConversations] = useState<DesktopBridgeConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DesktopBridgeMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [streamingReferences, setStreamingReferences] = useState<DesktopBridgeReference[]>([]);
  const [hiddenMessageId, setHiddenMessageId] = useState<string | null>(null);
  const [status, setStatus] = useState<QuestionStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const activeConversationIdRef = useRef<string | null>(null);
  const isComposingRef = useRef(false);
  const previousDraftConversationIdRef = useRef<string | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const visibleStreamingTextRef = useRef("");
  const pendingStreamingTextRef = useRef("");
  const streamTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamFinalizerRef = useRef<(() => void) | null>(null);
  const isStreaming = status === "streaming";
  const trimmedDraft = draft.trim();
  const canSendMessage =
    status === "ready" && activeConversationId !== null && trimmedDraft.length > 0;

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

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

  function resetStreamingState() {
    if (streamTypingTimerRef.current) {
      clearTimeout(streamTypingTimerRef.current);
      streamTypingTimerRef.current = null;
    }

    visibleStreamingTextRef.current = "";
    pendingStreamingTextRef.current = "";
    streamFinalizerRef.current = null;
    setStreamingText("");
    setStreamingReferences([]);
  }

  function scheduleStreamingTextReveal(controller: AbortController, requestId: number) {
    if (streamTypingTimerRef.current) {
      return;
    }

    streamTypingTimerRef.current = setTimeout(() => {
      streamTypingTimerRef.current = null;

      if (!isCurrentRequest(controller, requestId)) {
        return;
      }

      const pendingText = pendingStreamingTextRef.current;
      if (pendingText.length > 0) {
        const take = getStreamCharacterBatchSize(pendingText.length);
        const nextText = pendingText.slice(0, take);
        pendingStreamingTextRef.current = pendingText.slice(take);
        visibleStreamingTextRef.current += nextText;
        setStreamingText(visibleStreamingTextRef.current);
        scheduleStreamingTextReveal(controller, requestId);
        return;
      }

      const finalizer = streamFinalizerRef.current;
      if (finalizer) {
        streamFinalizerRef.current = null;
        finalizer();
      }
    }, STREAM_TYPE_INTERVAL_MS);
  }

  function enqueueStreamingText(
    text: string,
    controller: AbortController,
    requestId: number,
  ) {
    if (text.length === 0) {
      return;
    }

    pendingStreamingTextRef.current += text;
    scheduleStreamingTextReveal(controller, requestId);
  }

  function finishStreamingText(
    message: DesktopBridgeMessage,
    finalize: () => void,
    controller: AbortController,
    requestId: number,
  ) {
    const finalText = stripHiddenHtmlComments(message.content);
    const queuedText = visibleStreamingTextRef.current + pendingStreamingTextRef.current;

    if (finalText.startsWith(queuedText)) {
      pendingStreamingTextRef.current += finalText.slice(queuedText.length);
    } else if (queuedText.length === 0) {
      pendingStreamingTextRef.current += finalText;
    }

    streamFinalizerRef.current = () => {
      finalize();
      resetStreamingState();
      setStatus("ready");
    };
    scheduleStreamingTextReveal(controller, requestId);
  }

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

        setConversations(
          deriveConversationTitlesFromMessages(
            nextConversations,
            activeConversation.id,
            loadedMessages,
          ),
        );
        setActiveConversationId(activeConversation.id);
        setMessages(loadedMessages);
        setHiddenMessageId(null);
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
    setHiddenMessageId(null);
    setStreamingText("");
    setStreamingReferences([]);

    try {
      const conversation = await createQuestionConversation(projectId, controller.signal);
      const loadedMessages = await listQuestionMessages(projectId, conversation.id, controller.signal);

      if (!isCurrentRequest(controller, requestId)) {
        return;
      }

      setConversations((current) =>
        deriveConversationTitlesFromMessages(
          [conversation, ...current],
          conversation.id,
          loadedMessages,
        ),
      );
      setActiveConversationId(conversation.id);
      setMessages(loadedMessages);
      setHiddenMessageId(null);
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
    setHiddenMessageId(null);
    setStreamingText("");
    setStreamingReferences([]);

    try {
      const loadedMessages = await listQuestionMessages(projectId, conversationId, controller.signal);

      if (!isCurrentRequest(controller, requestId)) {
        return;
      }

      setActiveConversationId(conversationId);
      setMessages(loadedMessages);
      setConversations((current) =>
        deriveConversationTitlesFromMessages(current, conversationId, loadedMessages),
      );
      setHiddenMessageId(null);
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
        timestamp: 0,
        conversationId: activeConversationId,
      };

      setHiddenMessageId(null);
      setConversations((current) =>
        renamePlaceholderConversationFromQuestion(
          current,
          activeConversationId,
          messages,
          submittedMessage,
        ),
      );
      setMessages((current) => [...current, optimisticMessage]);
      setDraft("");
      resetStreamingState();
      setErrorMessage(null);
      setStatus("streaming");

      let terminalReceived = false;
      void streamQuestionMessage(projectId, activeConversationId, submittedMessage, {
        signal: controller.signal,
        onToken: (text) => {
          if (!isCurrentRequest(controller, requestId)) {
            return;
          }

          enqueueStreamingText(text, controller, requestId);
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

          terminalReceived = true;
          finishStreamingText(
            message,
            () => {
              setMessages((current) => [...current, message]);
            },
            controller,
            requestId,
          );
        },
        onError: (_code, message) => {
          if (!isCurrentRequest(controller, requestId)) {
            return;
          }

          terminalReceived = true;
          resetStreamingState();
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

          terminalReceived = true;
          resetStreamingState();
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
        });
    },
    [activeConversationId, messages, projectId, status],
  );

  const handleStop = useCallback(() => {
    if (!isStreaming) {
      return;
    }

    requestIdRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setHiddenMessageId(null);
    resetStreamingState();
    setStatus("ready");
  }, [isStreaming]);

  const handleAnswerAction = useCallback<AnswerActionHandler>(
    async (action, request) => {
      if (action === "save") {
        await saveQuestionAnswerToWiki(
          projectId,
          request.conversationId,
          request.messageId,
          {
            content: request.content,
            references: request.references,
          },
          request.signal,
        );
        return;
      }

      if (status !== "ready" || activeConversationIdRef.current !== request.conversationId) {
        return;
      }

      const controller = replaceAbortController();
      const requestId = nextRequestId();
      setHiddenMessageId(request.messageId);
      resetStreamingState();
      setErrorMessage(null);
      setStatus("streaming");

      let terminalReceived = false;
      try {
        await streamRegenerateQuestionAnswer(
          projectId,
          request.conversationId,
          request.messageId,
          {
            content: request.content,
            references: request.references,
          },
          {
            signal: controller.signal,
            onToken: (text) => {
              if (!isCurrentRequest(controller, requestId)) {
                return;
              }

              enqueueStreamingText(text, controller, requestId);
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

              terminalReceived = true;
              finishStreamingText(
                message,
                () => {
                  setMessages((current) =>
                    current.map((candidate) =>
                      candidate.id === request.messageId ? message : candidate,
                    ),
                  );
                  setHiddenMessageId(null);
                },
                controller,
                requestId,
              );
            },
            onError: (_code, message) => {
              if (!isCurrentRequest(controller, requestId)) {
                return;
              }

              terminalReceived = true;
              setHiddenMessageId(null);
              resetStreamingState();
              setErrorMessage(message || "桌面端问答服务不可用");
              setStatus("ready");
            },
          },
        );
      } catch (error: unknown) {
        if (isAbortError(error) || controller.signal.aborted) {
          setHiddenMessageId(null);
          return;
        }

        if (!isCurrentRequest(controller, requestId)) {
          return;
        }

        terminalReceived = true;
        setHiddenMessageId(null);
        resetStreamingState();
        setErrorMessage(getErrorMessage(error));
        setStatus("ready");
        throw error;
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [projectId, status],
  );

  const activeConversation = conversations.find(
    (conversation) => conversation.id === activeConversationId,
  );
  const renderedMessages = useMemo(
    () => [
      ...messages,
      ...(isStreaming
        ? [
            {
              id: "streaming",
              role: "assistant" as const,
              content: streamingText,
              timestamp: 0,
              conversationId: activeConversationId ?? "",
              references: streamingReferences,
            },
          ]
        : []),
    ],
    [
      activeConversationId,
      hiddenMessageId,
      isStreaming,
      messages,
      streamingReferences,
      streamingText,
    ],
  );

  useEffect(() => {
    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    viewport.scrollTo({ top: viewport.scrollHeight });
  }, [renderedMessages.length, status, streamingText]);

  useEffect(() => {
    if (!activeConversationId) {
      return;
    }

    if (previousDraftConversationIdRef.current === activeConversationId) {
      return;
    }

    previousDraftConversationIdRef.current = activeConversationId;
    setDraft("");
  }, [activeConversationId]);

  function handleDraftKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    if (event.nativeEvent.isComposing || isComposingRef.current) {
      return;
    }

    event.preventDefault();

    if (!canSendMessage) {
      return;
    }

    void handleSendMessage(trimmedDraft);
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
                    aria-current={conversation.id === activeConversationId ? "true" : undefined}
                    variant="ghost"
                    className={cn(
                      "h-auto w-full justify-start whitespace-normal border px-2 py-2 text-left",
                      conversation.id === activeConversationId
                        ? "border-[color:var(--ring)] bg-[color:var(--paper-panel)] font-semibold text-[color:var(--ink-strong)] shadow-sm"
                        : "border-transparent text-muted-foreground",
                    )}
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

          <div
            className="flex min-h-[28rem] flex-col rounded-md border border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--paper-border)] px-4 py-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="size-4 text-muted-foreground" aria-hidden="true" />
                <h2 className="text-sm font-medium text-[color:var(--ink-strong)]">项目问答</h2>
              </div>
              {activeConversation ? (
                <p className="text-xs text-muted-foreground">当前会话：{activeConversation.title}</p>
              ) : null}
            </div>

            <div
              ref={viewportRef}
              className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4"
            >
              {renderedMessages.length === 0 && status !== "loading" ? (
                <p className="rounded-md border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] px-3 py-2 text-sm text-muted-foreground">
                  暂无消息
                </p>
              ) : null}
              {renderedMessages.map((message, index) => (
                  <ChatMessage
                    key={message.id}
                    projectId={projectId}
                    message={message}
                    hiddenMessageId={hiddenMessageId}
                    isLast={index === renderedMessages.length - 1}
                    onAnswerAction={handleAnswerAction}
                  />
              ))}
            </div>

            {status === "loading" ? (
              <div className="mx-4 mb-3 flex items-center gap-2 rounded-md border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] px-3 py-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                正在加载项目问答
              </div>
            ) : null}

            {errorMessage ? (
              <Alert
                variant="destructive"
                className="mx-4 mb-3 border-destructive/20 bg-destructive/5"
              >
                <MessageSquare className="size-4" />
                <AlertTitle>问答失败</AlertTitle>
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            ) : null}

            <form
              className="border-t border-[color:var(--paper-border)] p-3"
              onSubmit={(event) => {
                event.preventDefault();

                if (!canSendMessage) {
                  return;
                }

                void handleSendMessage(trimmedDraft);
              }}
            >
              <textarea
                aria-label="项目问答输入"
                placeholder="询问这个项目"
                value={draft}
                disabled={status === "loading"}
                onChange={(event) => {
                  setDraft(event.target.value);
                }}
                onKeyDown={handleDraftKeyDown}
                onCompositionStart={() => {
                  isComposingRef.current = true;
                }}
                onCompositionEnd={(event) => {
                  isComposingRef.current = false;
                  setDraft(event.currentTarget.value);
                }}
                className="min-h-20 w-full resize-none rounded-md border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] px-3 py-2 text-sm leading-6 text-[color:var(--ink-strong)] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {isStreaming ? "正在生成回答" : "回答来自桌面端项目问答服务"}
                </p>
                <div className="flex items-center gap-2">
                  {isStreaming ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleStop}
                    >
                      <StopCircle className="size-4" aria-hidden="true" />
                      停止
                    </Button>
                  ) : null}
                  <Button type="submit" size="sm" disabled={!canSendMessage}>
                    {isStreaming ? (
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

function ChatMessage({
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

function getStreamCharacterBatchSize(pendingLength: number) {
  if (pendingLength > 600) {
    return 8;
  }

  if (pendingLength > 240) {
    return 4;
  }

  if (pendingLength > 80) {
    return 2;
  }

  return 1;
}

function deriveConversationTitlesFromMessages(
  conversations: DesktopBridgeConversation[],
  conversationId: string,
  messages: DesktopBridgeMessage[],
) {
  const title = getFirstUserMessageTitle(messages, conversationId);

  if (!title) {
    return conversations;
  }

  return conversations.map((conversation) =>
    conversation.id === conversationId && isPlaceholderConversationTitle(conversation.title)
      ? { ...conversation, title }
      : conversation,
  );
}

function renamePlaceholderConversationFromQuestion(
  conversations: DesktopBridgeConversation[],
  conversationId: string,
  messages: DesktopBridgeMessage[],
  question: string,
) {
  const hasPriorUserMessage = messages.some(
    (message) => message.conversationId === conversationId && message.role === "user",
  );

  if (hasPriorUserMessage) {
    return conversations;
  }

  const title = makeConversationTitle(question);

  if (!title) {
    return conversations;
  }

  return conversations.map((conversation) =>
    conversation.id === conversationId && isPlaceholderConversationTitle(conversation.title)
      ? { ...conversation, title, updatedAt: Date.now() }
      : conversation,
  );
}

function getFirstUserMessageTitle(
  messages: DesktopBridgeMessage[],
  conversationId: string,
) {
  const firstUserMessage = messages.find(
    (message) => message.conversationId === conversationId && message.role === "user",
  );

  return firstUserMessage ? makeConversationTitle(firstUserMessage.content) : "";
}

function makeConversationTitle(content: string) {
  return content.trim().replace(/\s+/g, " ").slice(0, 50);
}

function isPlaceholderConversationTitle(title: string) {
  const trimmedTitle = title.trim();
  return trimmedTitle.length === 0 || trimmedTitle === "New Conversation";
}

function stripHiddenHtmlComments(content: string) {
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

function getMessageText(content: string) {
  return stripHiddenHtmlComments(content).trim();
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
