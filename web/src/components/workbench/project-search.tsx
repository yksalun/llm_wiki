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
    const totalLabel = summary.totalMatches === 1 ? "1 match" : `${summary.totalMatches} matches`;
    const scannedLabel = `${summary.scannedFiles} scanned`;
    const truncatedLabel = summary.truncated ? "truncated" : null;

    return [totalLabel, scannedLabel, truncatedLabel].filter(Boolean).join(" / ");
  }, [response]);

  function handleQueryChange(nextQuery: string) {
    const nextTrimmedQuery = nextQuery.trim();

    setQuery(nextQuery);
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
    <section className="space-y-3 rounded-lg border border-black/10 bg-white/60 p-3">
      <div className="flex items-center gap-2">
        <Search className="size-4 text-muted-foreground" aria-hidden="true" />
        <Input
          type="search"
          value={query}
          onChange={(event) => handleQueryChange(event.target.value)}
          placeholder="Search project files"
          aria-label="Search project files"
        />
      </div>

      {status === "idle" ? (
        <p className="text-sm text-muted-foreground">Search paths and file text.</p>
      ) : null}

      {status === "short" ? (
        <Alert className="border-amber-900/15 bg-amber-700/5 text-amber-950">
          <FileSearch className="size-4" />
          <AlertTitle>Type at least 2 characters</AlertTitle>
          <AlertDescription>Shorter queries stay local.</AlertDescription>
        </Alert>
      ) : null}

      {status === "loading" ? (
        <div className="flex items-center gap-2 rounded-lg border border-black/10 bg-white/70 px-3 py-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          Searching
        </div>
      ) : null}

      {status === "error" ? (
        <Alert variant="destructive" className="border-destructive/20 bg-destructive/5">
          <FileSearch className="size-4" />
          <AlertTitle>Search failed</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{errorMessage ?? "Search failed."}</p>
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
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {status === "ready" ? (
        <div className="space-y-3">
          {summaryText ? <p className="text-xs text-muted-foreground">{summaryText}</p> : null}
          {results.length === 0 ? (
            <div className="rounded-lg border border-dashed border-black/10 bg-white/55 px-3 py-4 text-sm text-muted-foreground">
              No results
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
    <li className="rounded-lg border border-black/10 bg-white/75 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="truncate text-sm font-medium text-[color:var(--ink-strong)]">
            {result.relativePath}
          </p>
          <p className="text-xs text-muted-foreground">Line {result.lineNumber}</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onOpenFile(result.relativePath)}
        >
          Open result
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

  return "Search failed.";
}
