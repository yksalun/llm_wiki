"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  stripHiddenHtmlComments,
  type AnswerActionHandler,
} from "@/components/chat/chat-message";
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

export type QuestionStatus = "loading" | "ready" | "streaming" | "error";

const STREAM_TYPE_INTERVAL_MS = 8;

export interface QuestionSessionSnapshot {
  projectId: string;
  conversations: DesktopBridgeConversation[];
  activeConversationId: string | null;
  activeConversation: DesktopBridgeConversation | null;
  messages: DesktopBridgeMessage[];
  renderedMessages: DesktopBridgeMessage[];
  draft: string;
  status: QuestionStatus;
  errorMessage: string | null;
  hiddenMessageId: string | null;
  isStreaming: boolean;
  canSendMessage: boolean;
  setDraft: (value: string) => void;
  handleClearConversation: () => void;
  handleNewConversation: () => Promise<void>;
  handleSelectConversation: (conversationId: string) => Promise<void>;
  handleSendMessage: (submittedMessage: string) => Promise<void>;
  handleStop: () => void;
  handleAnswerAction: AnswerActionHandler;
}

export interface UseQuestionSessionOptions {
  projectId: string;
  autoStartConversation?: boolean;
  onConversationChange?: (event: {
    projectId: string;
    conversation: DesktopBridgeConversation | null;
  }) => void;
  onConversationsChange?: (event: {
    projectId: string;
    conversations: DesktopBridgeConversation[];
  }) => void;
}

export function useQuestionSession({
  projectId,
  autoStartConversation = true,
  onConversationChange,
  onConversationsChange,
}: UseQuestionSessionOptions): QuestionSessionSnapshot {
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
  const previousDraftConversationIdRef = useRef<string | null>(null);
  const visibleStreamingTextRef = useRef("");
  const pendingStreamingTextRef = useRef("");
  const streamTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamFinalizerRef = useRef<(() => void) | null>(null);
  const onConversationChangeRef = useRef(onConversationChange);
  const onConversationsChangeRef = useRef(onConversationsChange);
  const isStreaming = status === "streaming";
  const trimmedDraft = draft.trim();
  const canSendMessage =
    status === "ready" &&
    (activeConversationId !== null || !autoStartConversation) &&
    trimmedDraft.length > 0;

  useEffect(() => {
    onConversationChangeRef.current = onConversationChange;
  }, [onConversationChange]);

  useEffect(() => {
    onConversationsChangeRef.current = onConversationsChange;
  }, [onConversationsChange]);

  const notifyConversationChange = useCallback(
    (conversation: DesktopBridgeConversation | null) => {
      onConversationChangeRef.current?.({ projectId, conversation });
    },
    [projectId],
  );

  const notifyConversationsChange = useCallback(
    (conversations: DesktopBridgeConversation[]) => {
      onConversationsChangeRef.current?.({ projectId, conversations });
    },
    [projectId],
  );

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
        let activeConversation = autoStartConversation ? loadedConversations[0] ?? null : null;
        let nextConversations = loadedConversations;

        if (!activeConversation && autoStartConversation) {
          activeConversation = await createQuestionConversation(projectId, controller.signal);
          nextConversations = [activeConversation];
        }

        if (!activeConversation) {
          if (!isCurrentInitialRequest()) {
            return;
          }

          setConversations(nextConversations);
          setActiveConversationId(null);
          setMessages([]);
          setHiddenMessageId(null);
          setStatus("ready");
          notifyConversationsChange(nextConversations);
          notifyConversationChange(null);
          return;
        }

        const loadedMessages = await listQuestionMessages(
          projectId,
          activeConversation.id,
          controller.signal,
        );

        if (!isCurrentInitialRequest()) {
          return;
        }

        const titledConversations = deriveConversationTitlesFromMessages(
          nextConversations,
          activeConversation.id,
          loadedMessages,
        );
        const titledActiveConversation =
          titledConversations.find((conversation) => conversation.id === activeConversation?.id) ??
          activeConversation;

        setConversations(titledConversations);
        setActiveConversationId(activeConversation.id);
        setMessages(loadedMessages);
        setHiddenMessageId(null);
        setStatus("ready");
        notifyConversationsChange(titledConversations);
        notifyConversationChange(titledActiveConversation);
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
  }, [autoStartConversation, notifyConversationChange, notifyConversationsChange, projectId]);

  function handleClearConversation() {
    if (isStreaming) {
      return;
    }

    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    requestIdRef.current += 1;
    setActiveConversationId(null);
    setMessages([]);
    setHiddenMessageId(null);
    setDraft("");
    resetStreamingState();
    setErrorMessage(null);
    setStatus("ready");
    notifyConversationChange(null);
  }

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

      const titledConversations = deriveConversationTitlesFromMessages(
        [conversation, ...conversations],
        conversation.id,
        loadedMessages,
      );
      const titledConversation =
        titledConversations.find((candidate) => candidate.id === conversation.id) ?? conversation;

      setConversations(titledConversations);
      setActiveConversationId(conversation.id);
      setMessages(loadedMessages);
      setHiddenMessageId(null);
      setStatus("ready");
      notifyConversationsChange(titledConversations);
      notifyConversationChange(titledConversation);
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

      const titledConversations = deriveConversationTitlesFromMessages(
        conversations,
        conversationId,
        loadedMessages,
      );

      setActiveConversationId(conversationId);
      setMessages(loadedMessages);
      setConversations(titledConversations);
      setHiddenMessageId(null);
      setStatus("ready");
      notifyConversationsChange(titledConversations);
      notifyConversationChange(
        titledConversations.find((conversation) => conversation.id === conversationId) ?? null,
      );
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
      if (status !== "ready") {
        return;
      }

      const controller = replaceAbortController();
      const requestId = nextRequestId();
      let conversationId = activeConversationId;
      let nextConversations = conversations;

      if (!conversationId) {
        if (autoStartConversation) {
          return;
        }

        try {
          const conversation = await createQuestionConversation(projectId, controller.signal);

          if (!isCurrentRequest(controller, requestId)) {
            return;
          }

          conversationId = conversation.id;
          nextConversations = [conversation, ...conversations];
        } catch (error: unknown) {
          if (isAbortError(error) || controller.signal.aborted) {
            return;
          }

          if (!isCurrentRequest(controller, requestId)) {
            return;
          }

          setErrorMessage(getErrorMessage(error));
          setStatus("error");
          return;
        }
      }

      const optimisticMessage: DesktopBridgeMessage = {
        id: `local-${requestId}`,
        role: "user",
        content: submittedMessage,
        timestamp: 0,
        conversationId,
      };
      const renamedConversations = renamePlaceholderConversationFromQuestion(
        nextConversations,
        conversationId,
        conversationId === activeConversationId ? messages : [],
        submittedMessage,
      );

      setHiddenMessageId(null);
      setConversations(renamedConversations);
      setActiveConversationId(conversationId);
      notifyConversationsChange(renamedConversations);
      notifyConversationChange(
        renamedConversations.find((conversation) => conversation.id === conversationId) ?? null,
      );
      setMessages((current) =>
        conversationId === activeConversationId ? [...current, optimisticMessage] : [optimisticMessage],
      );
      setDraft("");
      resetStreamingState();
      setErrorMessage(null);
      setStatus("streaming");

      void streamQuestionMessage(projectId, conversationId, submittedMessage, {
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
    [
      activeConversationId,
      autoStartConversation,
      conversations,
      messages,
      notifyConversationChange,
      notifyConversationsChange,
      projectId,
      status,
    ],
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
    [activeConversationId, isStreaming, messages, streamingReferences, streamingText],
  );

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

  return {
    projectId,
    conversations,
    activeConversationId,
    activeConversation: activeConversation ?? null,
    messages,
    renderedMessages,
    draft,
    status,
    errorMessage,
    hiddenMessageId,
    isStreaming,
    canSendMessage,
    setDraft,
    handleClearConversation,
    handleNewConversation,
    handleSelectConversation,
    handleSendMessage,
    handleStop,
    handleAnswerAction,
  };
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

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "桌面端问答服务不可用";
}
