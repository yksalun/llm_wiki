"use client";

import { useRef, useState } from "react";
import { Database, RefreshCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { syncLawDatabaseSources } from "@/lib/client/api";
import type { LawDatabaseSyncResponse } from "@/lib/types";

interface LawDatabaseSyncCardProps {
  projectId: string;
}

type SyncState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "success"; result: LawDatabaseSyncResponse }
  | { status: "error"; message: string };

export function LawDatabaseSyncCard({ projectId }: LawDatabaseSyncCardProps) {
  const [state, setState] = useState<SyncState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  async function handleSync() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ status: "running" });

    try {
      const result = await syncLawDatabaseSources(projectId, controller.signal);
      setState({ status: "success", result });
    } catch (error) {
      if (!controller.signal.aborted) {
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "同步法规数据库失败。",
        });
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }

  return (
    <div className="rounded-[20px] border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)]/55 p-4 md:col-span-2 xl:col-span-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <div className="rounded-full border border-[color:var(--paper-border)] bg-[color:var(--paper-accent)]/20 p-2 text-[color:var(--ink-soft)]">
            <Database className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[color:var(--ink-strong)]">法规数据库资料源</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              从 Web 服务端配置的 MySQL law 表生成本地 source 文件；不会自动生成 wiki 页面。
            </p>
          </div>
        </div>
        <Button onClick={() => void handleSync()} disabled={state.status === "running"}>
          <RefreshCcw className="size-4" />
          {state.status === "running" ? "正在同步..." : "同步法规数据库"}
        </Button>
      </div>

      {state.status === "success" ? <SyncSuccess result={state.result} /> : null}
      {state.status === "error" ? (
        <p className="mt-3 text-sm text-destructive">{state.message}</p>
      ) : null}
    </div>
  );
}

function SyncSuccess({ result }: { result: LawDatabaseSyncResponse }) {
  return (
    <div className="mt-4 space-y-3 text-sm text-[color:var(--ink-strong)]">
      <div className="flex flex-wrap gap-2">
        <SyncPill label="读取" value={result.summary.read} />
        <SyncPill label="新增" value={result.summary.created} />
        <SyncPill label="更新" value={result.summary.updated} />
        <SyncPill label="跳过" value={result.summary.skipped} />
        <SyncPill label="失败" value={result.summary.failed} />
      </div>
      {result.changedFiles.length > 0 ? (
        <div className="rounded-[16px] border border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]/70 p-3">
          <p className="font-medium">变更文件</p>
          <ul className="mt-2 space-y-1 font-mono text-xs text-muted-foreground">
            {result.changedFiles.slice(0, 8).map((file) => (
              <li key={file}>{file}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function SyncPill({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded-full border border-[color:var(--paper-border)] bg-[color:var(--paper-panel)] px-3 py-1">
      {label} {value}
    </span>
  );
}
