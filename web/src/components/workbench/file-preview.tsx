import { FileText, Info, OctagonAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import type { FileReadResult } from "@/lib/types";

import { MarkdownReader } from "./markdown-reader";

export function FilePreview({ file }: { file: FileReadResult }) {
  if (file.mode === "preview") {
    if (file.relativePath.toLowerCase().endsWith(".md")) {
      return <MarkdownReader content={file.content ?? ""} />;
    }

    return <TextPreview file={file} />;
  }

  if (file.mode === "metadata") {
    return (
      <MetadataNotice
        icon={<Info className="size-4" />}
        title="仅显示元数据"
        description="这个文件以元数据形式提供，因为工作台预览不会显示它的内容。"
        metadata={file.metadata}
      />
    );
  }

  return (
    <MetadataNotice
      icon={<OctagonAlert className="size-4" />}
      title="无法预览"
      description="工作台无法预览这个文件类型。"
      metadata={file.metadata}
    />
  );
}

function TextPreview({ file }: { file: FileReadResult }) {
  const content = file.content ?? "";
  const isStructuredText = /\.(json|ya?ml)$/i.test(file.relativePath);

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-[color:var(--ink-strong)]">
        <FileText className="size-4 text-muted-foreground" />
        <span>只读预览</span>
      </div>

      {content.length > 0 ? (
        <pre
          className={[
            "overflow-x-auto whitespace-pre-wrap rounded-lg border border-[color:var(--paper-border)] bg-[color:var(--paper-elevated)]/70 p-4 text-sm leading-6 text-[color:var(--ink-strong)]",
            isStructuredText ? "font-mono" : "font-sans",
          ].join(" ")}
        >
          {content}
        </pre>
      ) : (
        <div className="rounded-lg border border-dashed border-[color:var(--paper-border)] bg-[color:var(--paper-elevated)]/60 p-4 text-sm text-muted-foreground">
          这个文件为空。
        </div>
      )}
    </section>
  );
}

function MetadataNotice({
  icon,
  title,
  description,
  metadata,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  metadata: FileReadResult["metadata"];
}) {
  const entries = Object.entries(metadata);

  return (
    <Alert>
      {icon}
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{description}</p>

        {entries.length > 0 ? (
          <>
            <Separator className="my-3" />
            <dl className="grid gap-2">
              {entries.map(([key, value]) => (
                <div key={key} className="grid gap-0.5">
                  <dt className="font-medium text-foreground">{key}</dt>
                  <dd className="break-words font-mono text-xs">{String(value)}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
