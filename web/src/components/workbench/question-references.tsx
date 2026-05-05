"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { BookOpen, FileText, LoaderCircle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { FilePreview } from "@/components/workbench/file-preview";
import { fetchProjectFile } from "@/lib/client/api";
import type { DesktopBridgeReference, FileReadResult } from "@/lib/types";

type PreviewStatus = "idle" | "loading" | "ready" | "error";

interface QuestionReferencesProps {
  projectId: string;
  references: DesktopBridgeReference[];
}

export function QuestionReferences({
  projectId,
  references,
}: QuestionReferencesProps) {
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedReference, setSelectedReference] =
    useState<DesktopBridgeReference | null>(null);
  const [file, setFile] = useState<FileReadResult | null>(null);
  const [status, setStatus] = useState<PreviewStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  const closePreview = useCallback(() => {
    requestIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setOpen(false);
    setSelectedReference(null);
    setFile(null);
    setStatus("idle");
    setErrorMessage(null);
  }, []);

  const openReference = useCallback(
    (reference: DesktopBridgeReference) => {
      requestIdRef.current += 1;
      const requestId = requestIdRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setSelectedReference(reference);
      setFile(null);
      setStatus("loading");
      setErrorMessage(null);
      setOpen(true);

      void fetchProjectFile(projectId, reference.path, controller.signal)
        .then((nextFile) => {
          if (controller.signal.aborted || requestId !== requestIdRef.current) {
            return;
          }

          setFile(nextFile);
          setStatus("ready");
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || requestId !== requestIdRef.current) {
            return;
          }

          setErrorMessage(getErrorMessage(error));
          setStatus("error");
        })
        .finally(() => {
          if (abortRef.current === controller) {
            abortRef.current = null;
          }
        });
    },
    [projectId],
  );

  useEffect(() => closePreview, [closePreview]);

  if (references.length === 0) {
    return null;
  }

  const hasOverflowReferences = references.length > 3;
  const visibleReferences =
    hasOverflowReferences && !expanded ? references.slice(0, 3) : references;

  return (
    <>
      <Card
        data-reference-panel="true"
        size="sm"
        className="mt-2 gap-1.5 rounded-md border border-transparent bg-muted/15 py-1.5 text-[11px] text-muted-foreground shadow-none ring-0"
        role="group"
        aria-label="引用文件"
      >
        <CardHeader className="grid-cols-[1fr_auto] gap-1.5 px-2.5">
          <div>
            <CardTitle className="flex items-center gap-1.5 text-[11px] font-normal text-muted-foreground">
              <BookOpen className="size-3" aria-hidden="true" />
              引用文件
            </CardTitle>
            <CardDescription className="mt-0.5 text-[10px] text-muted-foreground/80">
              引用 {references.length} 个文件
            </CardDescription>
          </div>
          {hasOverflowReferences ? (
            <CardAction>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-[11px] text-muted-foreground hover:bg-muted/20 hover:text-foreground"
                onClick={() => setExpanded((current) => !current)}
              >
                {expanded ? "收起引用" : `展开全部 ${references.length} 个引用`}
              </Button>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent className="px-2.5">
          <div className="grid gap-1">
            {visibleReferences.map((reference, index) => (
              <ReferenceButton
                key={`${reference.path}-${reference.title}-${index}`}
                index={index}
                reference={reference}
                onOpen={() => openReference(reference)}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <Sheet
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            closePreview();
          }
        }}
      >
        <SheetContent className="flex w-[min(42rem,calc(100vw-2rem))] flex-col overflow-hidden sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle className="truncate">
              {selectedReference?.title ?? "引用文件"}
            </SheetTitle>
            <SheetDescription className="break-all">
              {selectedReference?.path ?? "未选择文件"}
            </SheetDescription>
          </SheetHeader>
          <div
            data-reference-preview-body="true"
            className="min-h-0 flex-1 overflow-y-auto px-4 pb-4"
          >
            <ReferencePreviewBody
              status={status}
              file={file}
              errorMessage={errorMessage}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function ReferenceButton({
  index,
  reference,
  onOpen,
}: {
  index: number;
  reference: DesktopBridgeReference;
  onOpen: () => void;
}) {
  return (
    <Button
      data-reference-item="true"
      type="button"
      variant="ghost"
      size="sm"
      className="h-auto w-full justify-start whitespace-normal bg-transparent px-1.5 py-1 text-left text-[11px] text-muted-foreground hover:bg-muted/20 hover:text-foreground"
      onClick={onOpen}
    >
      <span className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-muted/40 text-[10px] font-medium text-muted-foreground/80">
        {index + 1}
      </span>
      <BookOpen
        className="size-3 shrink-0 text-muted-foreground/80"
        aria-hidden="true"
      />
      <span className="min-w-0">
        <span className="block truncate font-normal">{reference.title}</span>
        <span className="block break-all text-[10px] text-muted-foreground/75">
          {reference.path}
        </span>
      </span>
    </Button>
  );
}

function ReferencePreviewBody({
  status,
  file,
  errorMessage,
}: {
  status: PreviewStatus;
  file: FileReadResult | null;
  errorMessage: string | null;
}) {
  if (status === "loading") {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          正在加载引用文件
        </div>
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (status === "error") {
    return (
      <Alert
        variant="destructive"
        className="border-destructive/20 bg-destructive/5"
      >
        <FileText className="size-4" />
        <AlertTitle>无法打开引用文件</AlertTitle>
        <AlertDescription>{errorMessage ?? "文件读取失败"}</AlertDescription>
      </Alert>
    );
  }

  if (status === "ready" && file) {
    return <FilePreview file={file} />;
  }

  return null;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "文件读取失败";
}
