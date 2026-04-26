"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, LoaderCircle, MessageSquare, RotateCcw } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { askProjectQuestion } from "@/lib/client/api";
import type {
  ProjectQuestionMessage,
  ProjectQuestionResponse,
  ProjectQuestionSource,
} from "@/lib/types";

interface ProjectQuestionPanelProps {
  projectId: string;
  onOpenFile: (relativePath: string) => void;
  askFn?: typeof askProjectQuestion;
}

type QuestionStatus = "idle" | "loading" | "ready" | "error";

export function ProjectQuestionPanel({
  projectId,
  onOpenFile,
  askFn = askProjectQuestion,
}: ProjectQuestionPanelProps) {
  return (
    <ProjectQuestionPanelSession
      key={projectId}
      projectId={projectId}
      onOpenFile={onOpenFile}
      askFn={askFn}
    />
  );
}

function ProjectQuestionPanelSession({
  projectId,
  onOpenFile,
  askFn,
}: Required<ProjectQuestionPanelProps>) {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ProjectQuestionMessage[]>([]);
  const [lastResponse, setLastResponse] = useState<ProjectQuestionResponse | null>(null);
  const [status, setStatus] = useState<QuestionStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastRequest, setLastRequest] = useState<{
    question: string;
    history: ProjectQuestionMessage[];
  } | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const trimmedQuestion = question.trim();
  const canAsk = trimmedQuestion.length >= 2 && status !== "loading";

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, []);

  function submitQuestion(nextQuestion: string, history: ProjectQuestionMessage[]) {
    controllerRef.current?.abort();

    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus("loading");
    setErrorMessage(null);
    setLastResponse(null);
    setLastRequest({ question: nextQuestion, history });

    askFn(projectId, { question: nextQuestion, history }, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) {
          return;
        }

        setMessages([
          ...history,
          { role: "user", content: nextQuestion },
          { role: "assistant", content: response.answer },
        ]);
        setLastResponse(response);
        setQuestion("");
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) {
          return;
        }

        setErrorMessage(getErrorMessage(error));
        setStatus("error");
      })
      .finally(() => {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
        }
      });
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canAsk) {
      return;
    }

    submitQuestion(trimmedQuestion, messages);
  }

  function handleRetry() {
    if (!lastRequest || status === "loading") {
      return;
    }

    submitQuestion(lastRequest.question, lastRequest.history);
  }

  return (
    <section className="space-y-3 rounded-lg border border-[color:var(--paper-border)] bg-[color:var(--paper-panel)] p-3">
      <div className="flex items-center gap-2">
        <MessageSquare className="size-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-medium text-[color:var(--ink-strong)]">项目问答</h2>
      </div>

      <form className="space-y-2" onSubmit={handleSubmit}>
        <Textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="询问这个项目"
          aria-label="询问项目问题"
          className="min-h-20 resize-none bg-[color:var(--paper-muted)]"
          disabled={status === "loading"}
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {status === "loading" ? "正在询问项目..." : "回答会使用项目来源。"}
          </p>
          <Button type="submit" size="sm" disabled={!canAsk}>
            {status === "loading" ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <MessageSquare className="size-4" aria-hidden="true" />
            )}
            提问
          </Button>
        </div>
      </form>

      {status === "loading" ? (
        <div className="flex items-center gap-2 rounded-lg border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] px-3 py-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          正在询问项目
        </div>
      ) : null}

      {status === "error" ? (
        <Alert variant="destructive" className="border-destructive/20 bg-destructive/5">
          <MessageSquare className="size-4" />
          <AlertTitle>提问失败</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{errorMessage ?? "提问失败"}</p>
            <Button type="button" size="sm" variant="outline" onClick={handleRetry}>
              <RotateCcw className="size-4" />
              重试
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {status === "ready" && lastResponse ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] p-3">
            <p className="whitespace-pre-wrap text-sm leading-6 text-[color:var(--ink-strong)]">
              {lastResponse.answer}
            </p>
          </div>

          {lastResponse.sources.length > 0 ? (
            <ul className="space-y-2">
              {lastResponse.sources.map((source) => (
                <SourceItem key={source.id} source={source} onOpenFile={onOpenFile} />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function SourceItem({
  source,
  onOpenFile,
}: {
  source: ProjectQuestionSource;
  onOpenFile: (relativePath: string) => void;
}) {
  return (
    <li className="rounded-lg border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="truncate text-sm font-medium text-[color:var(--ink-strong)]">
            {source.relativePath}
          </p>
          <p className="text-xs text-muted-foreground">第 {source.lineNumber} 行</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onOpenFile(source.relativePath)}
        >
          <ExternalLink className="size-4" />
          打开来源
        </Button>
      </div>
      <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">
        {source.preview}
      </p>
    </li>
  );
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "提问失败";
}
