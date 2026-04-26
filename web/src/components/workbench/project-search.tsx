"use client";

import { useEffect, useMemo, useState } from "react";
import { FileSearch, LoaderCircle, RotateCcw, Search } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { searchProject } from "@/lib/client/api";
import type { ProjectSearchResponse, ProjectSearchResult } from "@/lib/types";

interface ProjectSearchProps {
  projectId: string;
  onOpenFile: (relativePath: string) => void;
  searchFn?: typeof searchProject;
  debounceMs?: number;
}

type SearchStatus = "idle" | "short" | "loading" | "ready" | "error";

export function ProjectSearch({
  projectId,
  onOpenFile,
  searchFn = searchProject,
  debounceMs = 250,
}: ProjectSearchProps) {
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<ProjectSearchResponse | null>(null);
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const trimmedQuery = query.trim();

  useEffect(() => {
    if (trimmedQuery.length < 2) {
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      setStatus("loading");
      setErrorMessage(null);

      searchFn(projectId, trimmedQuery, controller.signal)
        .then((nextResponse) => {
          if (controller.signal.aborted) {
            return;
          }

          setResponse(nextResponse);
          setStatus("ready");
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || isAbortError(error)) {
            return;
          }

          setResponse(null);
          setErrorMessage(getErrorMessage(error));
          setStatus("error");
        });
    }, debounceMs);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [debounceMs, projectId, retryKey, searchFn, trimmedQuery]);

  const results = response?.results ?? [];
  const summaryText = useMemo(() => {
    if (!response) {
      return null;
    }

    const { summary } = response;
    const totalLabel = `${summary.totalMatches} 个匹配`;
    const scannedLabel = `已扫描 ${summary.scannedFiles} 个文件`;
    const truncatedLabel = summary.truncated ? "结果已截断" : null;

    return [totalLabel, scannedLabel, truncatedLabel].filter(Boolean).join(" / ");
  }, [response]);

  function handleQueryChange(nextQuery: string) {
    const nextTrimmedQuery = nextQuery.trim();

    setQuery(nextQuery);

    if (nextTrimmedQuery === trimmedQuery) {
      return;
    }

    setRetryKey(0);

    if (nextTrimmedQuery.length === 0) {
      setStatus("idle");
      setResponse(null);
      setErrorMessage(null);
      return;
    }

    if (nextTrimmedQuery.length === 1) {
      setStatus("short");
      setResponse(null);
      setErrorMessage(null);
      return;
    }

    setStatus("loading");
    setResponse(null);
    setErrorMessage(null);
  }

  return (
    <section className="space-y-3 rounded-lg border border-[color:var(--paper-border)] bg-[color:var(--paper-panel)] p-3">
      <div className="flex items-center gap-2">
        <Search className="size-4 text-muted-foreground" aria-hidden="true" />
        <Input
          type="search"
          value={query}
          onChange={(event) => handleQueryChange(event.target.value)}
          placeholder="搜索项目文件"
          aria-label="搜索项目文件"
        />
      </div>

      {status === "idle" ? (
        <p className="text-sm text-muted-foreground">搜索路径和文件内容。</p>
      ) : null}

      {status === "short" ? (
        <Alert className="border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] text-[color:var(--ink-strong)]">
          <FileSearch className="size-4" />
          <AlertTitle>请输入至少 2 个字符</AlertTitle>
          <AlertDescription>更短的查询会留在本地。</AlertDescription>
        </Alert>
      ) : null}

      {status === "loading" ? (
        <div className="flex items-center gap-2 rounded-lg border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] px-3 py-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          正在搜索
        </div>
      ) : null}

      {status === "error" ? (
        <Alert variant="destructive" className="border-destructive/20 bg-destructive/5">
          <FileSearch className="size-4" />
          <AlertTitle>搜索失败</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{errorMessage ?? "搜索失败"}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setStatus("loading");
                setRetryKey((key) => key + 1);
              }}
            >
              <RotateCcw className="size-4" />
              重试
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {status === "ready" ? (
        <div className="space-y-3">
          {summaryText ? <p className="text-xs text-muted-foreground">{summaryText}</p> : null}
          {results.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] px-3 py-4 text-sm text-muted-foreground">
              没有结果
            </div>
          ) : (
            <ul className="space-y-2">
              {results.map((result) => (
                <SearchResultItem
                  key={`${result.relativePath}:${result.lineNumber}:${result.matchStart}`}
                  result={result}
                  onOpenFile={onOpenFile}
                />
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

function SearchResultItem({
  result,
  onOpenFile,
}: {
  result: ProjectSearchResult;
  onOpenFile: (relativePath: string) => void;
}) {
  return (
    <li className="rounded-lg border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="truncate text-sm font-medium text-[color:var(--ink-strong)]">
            {result.relativePath}
          </p>
          <p className="text-xs text-muted-foreground">第 {result.lineNumber} 行</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onOpenFile(result.relativePath)}
        >
          打开结果
        </Button>
      </div>
      <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">
        {result.preview || result.lineText}
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

  return "搜索失败";
}
