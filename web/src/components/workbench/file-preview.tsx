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
        title="Metadata only"
        description="This file is available as metadata because its contents are not shown in the workbench preview."
        metadata={file.metadata}
      />
    );
  }

  return (
    <MetadataNotice
      icon={<OctagonAlert className="size-4" />}
      title="Unsupported preview"
      description="This file type cannot be previewed in the workbench."
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
        <span>Read-only preview</span>
      </div>

      {content.length > 0 ? (
        <pre
          className={[
            "overflow-x-auto whitespace-pre-wrap rounded-lg border border-black/10 bg-white/70 p-4 text-sm leading-6 text-[color:var(--ink-strong)]",
            isStructuredText ? "font-mono" : "font-sans",
          ].join(" ")}
        >
          {content}
        </pre>
      ) : (
        <div className="rounded-lg border border-dashed border-black/10 bg-white/60 p-4 text-sm text-muted-foreground">
          This file is empty.
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
