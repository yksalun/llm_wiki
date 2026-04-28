"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, LoaderCircle, MessageSquare, Plus, StopCircle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
  const [input, setInput] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [streamingReferences, setStreamingReferences] = useState<DesktopBridgeReference[]>([]);
  const [status, setStatus] = useState<QuestionStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const trimmedInput = input.trim();
  const isStreaming = status === "streaming";
  const canSend = trimmedInput.length > 0 && activeConversationId !== null && status === "ready";

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
      setInput("");
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
      setInput("");
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

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSend || !activeConversationId) {
      return;
    }

    const controller = replaceAbortController();
    const requestId = nextRequestId();
    const submittedMessage = trimmedInput;
    const optimisticMessage: DesktopBridgeMessage = {
      id: `local-${requestId}`,
      role: "user",
      content: submittedMessage,
      timestamp: 0,
      conversationId: activeConversationId,
    };

    setMessages((current) => [...current, optimisticMessage]);
    setInput("");
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
  }

  function handleStop() {
    if (!isStreaming) {
      return;
    }

    requestIdRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setStreamingText("");
    setStreamingReferences([]);
    setStatus("ready");
  }

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

  return (
    <section className="space-y-3 rounded-lg border border-[color:var(--paper-border)] bg-[color:var(--paper-panel)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MessageSquare className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-sm font-medium text-[color:var(--ink-strong)]">项目问答</h2>
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

      {conversations.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {conversations.map((conversation) => (
            <Button
              key={conversation.id}
              type="button"
              size="sm"
              variant={conversation.id === activeConversationId ? "secondary" : "outline"}
              onClick={() => {
                void handleSelectConversation(conversation.id);
              }}
              disabled={isStreaming || status === "loading"}
            >
              {conversation.title || "未命名会话"}
            </Button>
          ))}
        </div>
      ) : null}

      {activeConversation ? (
        <p className="text-xs text-muted-foreground">当前会话：{activeConversation.title}</p>
      ) : null}

      <div className="space-y-2">
        {messages.length === 0 && status !== "loading" ? (
          <p className="rounded-lg border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] px-3 py-2 text-sm text-muted-foreground">
            暂无消息
          </p>
        ) : null}
        {messages.map((message) => (
          <MessageItem key={message.id} message={message} onOpenFile={onOpenFile} />
        ))}
        {streamingText || streamingReferences.length > 0 ? (
          <MessageItem
            message={{
              id: "streaming",
              role: "assistant",
              content: streamingText,
              timestamp: 0,
              conversationId: activeConversationId ?? "",
              references: streamingReferences,
            }}
            onOpenFile={onOpenFile}
          />
        ) : null}
      </div>

      {status === "loading" ? (
        <div className="flex items-center gap-2 rounded-lg border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] px-3 py-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          正在加载项目问答
        </div>
      ) : null}

      {status === "error" ? (
        <Alert variant="destructive" className="border-destructive/20 bg-destructive/5">
          <MessageSquare className="size-4" />
          <AlertTitle>问答失败</AlertTitle>
          <AlertDescription>{errorMessage ?? "桌面端问答服务不可用"}</AlertDescription>
        </Alert>
      ) : null}

      <form className="space-y-2" onSubmit={handleSubmit}>
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="询问这个项目"
          aria-label="项目问答输入"
          className="min-h-20 resize-none bg-[color:var(--paper-muted)]"
          disabled={status === "loading" || isStreaming}
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {isStreaming ? "正在生成回答" : "回答来自桌面端项目问答服务"}
          </p>
          <div className="flex items-center gap-2">
            {isStreaming ? (
              <Button type="button" size="sm" variant="outline" onClick={handleStop}>
                <StopCircle className="size-4" aria-hidden="true" />
                停止
              </Button>
            ) : null}
            <Button type="submit" size="sm" disabled={!canSend}>
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
    </section>
  );
}

function MessageItem({
  message,
  onOpenFile,
}: {
  message: DesktopBridgeMessage;
  onOpenFile: (relativePath: string) => void;
}) {
  const label =
    message.role === "user" ? "用户" : message.role === "assistant" ? "助手" : "系统";

  return (
    <div className="rounded-lg border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[color:var(--ink-strong)]">
        {message.content}
      </p>
      {message.references && message.references.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {message.references.map((reference) => (
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
    </div>
  );
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
