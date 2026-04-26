"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import {
  AlertTriangle,
  ArrowRight,
  BookOpenText,
  Boxes,
  FileSearch,
  FolderArchive,
} from "lucide-react";

import { AppShell } from "@/components/app/app-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchProjects } from "@/lib/client/api";
import { formatProjectStatusLabel } from "@/lib/display-labels";
import type { ProjectSummary, ProjectsListResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ProjectsListResponse };

const structureItems: Array<{
  key: "hasPurpose" | "hasSchema" | "hasWikiDirectory" | "hasRawSourcesDirectory";
  label: string;
}> = [
  { key: "hasPurpose", label: "目标" },
  { key: "hasSchema", label: "结构" },
  { key: "hasWikiDirectory", label: "知识库" },
  { key: "hasRawSourcesDirectory", label: "原始资料" },
];

export function ProjectListPage() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    const abortController = new AbortController();

    fetchProjects(abortController.signal)
      .then((data) => {
        if (abortController.signal.aborted) {
          return;
        }

        setLoadState({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (abortController.signal.aborted) {
          return;
        }

        const message = error instanceof Error ? error.message : "无法加载项目记录。";

        setLoadState({ status: "error", message });
      });

    return () => {
      abortController.abort();
    };
  }, []);

  const projectCount =
    loadState.status === "ready" ? loadState.data.projects.length : undefined;

  return (
    <AppShell
      eyebrow="项目登记册"
      title="选择要打开的项目档案"
      description="浏览当前可用项目，查看结构完整度，然后进入工作台继续阅读、编辑和分析。"
      aside={<HeaderAside projectCount={projectCount} />}
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-4">
          {loadState.status === "ready" && loadState.data.warnings.length > 0 ? (
            <WarningsAlert warnings={loadState.data.warnings} />
          ) : null}

          {loadState.status === "loading" ? <LoadingState /> : null}
          {loadState.status === "error" ? (
            <ErrorState message={loadState.message} />
          ) : null}
          {loadState.status === "ready" ? (
            loadState.data.projects.length > 0 ? (
              <ProjectGrid projects={loadState.data.projects} />
            ) : (
              <EmptyState />
            )
          ) : null}
        </div>

        <aside className="space-y-4">
          <Card className="border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]/90 shadow-[0_16px_48px_rgba(61,52,40,0.08)]">
            <CardHeader className="border-b border-[color:var(--paper-border)]">
              <CardTitle className="text-[15px] uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">
                阅读提示
              </CardTitle>
              <CardDescription>
                列表优先呈现项目结构和进入工作台所需的线索。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <SidebarMetric
                icon={FolderArchive}
                label="状态标记"
                value="就绪或不完整"
              />
              <SidebarMetric
                icon={BookOpenText}
                label="必需结构"
                value="目标 / 结构 / 知识库"
              />
              <SidebarMetric
                icon={FileSearch}
                label="可选资料"
                value="存在时展示原始资料"
              />
            </CardContent>
          </Card>
        </aside>
      </div>
    </AppShell>
  );
}

function HeaderAside({ projectCount }: { projectCount?: number }) {
  return (
    <Card className="border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]/95 shadow-[0_18px_60px_rgba(88,67,42,0.10)]">
      <CardHeader className="border-b border-[color:var(--paper-border)]">
        <CardTitle className="text-sm uppercase tracking-[0.22em] text-[color:var(--ink-soft)]">
          项目入口
        </CardTitle>
        <CardDescription>
          进入研究工作台前的项目选择台。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              已列项目
            </p>
            <p className="mt-1 text-4xl font-semibold tracking-[-0.05em] text-[color:var(--ink-strong)]">
              {projectCount ?? "-"}
            </p>
          </div>
          <Badge className="border border-amber-900/10 bg-amber-700/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-900 dark:border-amber-300/20 dark:bg-amber-300/10 dark:text-amber-100">
            登记册
          </Badge>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          打开结构已经足够完整的项目，或把缺失项作为整理线索。
        </p>
      </CardContent>
    </Card>
  );
}

function WarningsAlert({ warnings }: { warnings: string[] }) {
  return (
    <Alert className="border-[color:var(--paper-border)] bg-[color:var(--paper-muted)]/80 px-4 py-3 text-[color:var(--ink-strong)] shadow-[0_14px_40px_rgba(135,98,41,0.08)]">
      <AlertTriangle className="mt-0.5 size-4 text-amber-800 dark:text-amber-200" />
      <AlertTitle className="font-medium tracking-[0.01em] text-amber-950 dark:text-amber-100">
        档案提示
      </AlertTitle>
      <AlertDescription className="text-amber-900/80 dark:text-amber-100/80">
        {warnings.length === 1 ? (
          formatWarningMessage(warnings[0])
        ) : (
          <ul className="space-y-1 pl-4">
            {warnings.map((warning) => (
              <li key={warning} className="list-disc">
                {formatWarningMessage(warning)}
              </li>
            ))}
          </ul>
        )}
      </AlertDescription>
    </Alert>
  );
}

function formatWarningMessage(warning: string) {
  if (warning === "无法扫描已配置的项目根目录。") {
    return "无法扫描已配置的项目根目录。";
  }

  return "项目扫描返回了未知警告。";
}

function LoadingState() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }, (_, index) => (
        <Card
          key={index}
          className="border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]/90 shadow-[0_16px_48px_rgba(61,52,40,0.06)]"
        >
          <CardHeader className="space-y-3 border-b border-[color:var(--paper-border)]">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <Skeleton className="h-4 w-24 rounded-full bg-[color:var(--paper-muted)]" />
                <Skeleton className="h-8 w-44 bg-[color:var(--paper-muted)]" />
              </div>
              <Skeleton className="h-6 w-20 rounded-full bg-[color:var(--paper-muted)]" />
            </div>
            <Skeleton className="h-4 w-full bg-[color:var(--paper-muted)]" />
            <Skeleton className="h-4 w-3/4 bg-[color:var(--paper-muted)]" />
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: 4 }, (_, itemIndex) => (
                <Skeleton key={itemIndex} className="h-16 rounded-2xl bg-[color:var(--paper-muted)]" />
              ))}
            </div>
          </CardContent>
          <CardFooter className="justify-between border-[color:var(--paper-border)] bg-[color:var(--paper-muted)]/45">
            <Skeleton className="h-4 w-28 bg-[color:var(--paper-panel)]" />
            <Skeleton className="h-4 w-16 bg-[color:var(--paper-panel)]" />
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <Card className="border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]/90 shadow-[0_16px_48px_rgba(61,52,40,0.08)]">
      <CardHeader className="border-b border-[color:var(--paper-border)]">
        <CardTitle>无法打开登记册</CardTitle>
        <CardDescription>
          无法从 `/api/projects` 组装项目入口列表。
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <Alert variant="destructive" className="border-destructive/20 bg-destructive/5 px-4 py-3">
          <AlertTriangle className="mt-0.5 size-4" />
          <AlertTitle>请求失败</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <Card className="border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]/90 shadow-[0_16px_48px_rgba(61,52,40,0.08)]">
      <CardHeader className="border-b border-[color:var(--paper-border)]">
        <CardTitle>未找到项目档案</CardTitle>
        <CardDescription>
          登记册可以访问，但目前没有可展示的项目。
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="rounded-[24px] border border-dashed border-[color:var(--paper-border)] bg-[color:var(--paper-muted)]/45 p-6">
          <p className="max-w-xl text-sm leading-7 text-muted-foreground">
            当项目根目录解析为有效工作区后，这里会显示带结构标记和入口的项目档案卡片。
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function ProjectGrid({ projects }: { projects: ProjectSummary[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {projects.map((project, index) => (
        <motion.div
          key={project.id}
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
        >
          <ProjectCard project={project} />
        </motion.div>
      ))}
    </div>
  );
}

function ProjectCard({ project }: { project: ProjectSummary }) {
  const updatedAtLabel = formatUpdatedAt(project.updatedAt);

  return (
    <Link
      href={`/projects/${project.id}`}
      className="block h-full rounded-[28px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)] focus-visible:ring-offset-4 focus-visible:ring-offset-[color:var(--paper-base)]"
    >
      <Card className="h-full border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]/95 shadow-[0_18px_60px_rgba(61,52,40,0.08)] transition-transform duration-300 hover:-translate-y-1 hover:shadow-[0_22px_70px_rgba(61,52,40,0.12)]">
        <CardHeader className="gap-3 border-b border-[color:var(--paper-border)]">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <Badge
                variant={project.status === "ready" ? "secondary" : "outline"}
                className={cn(
                  "h-6 rounded-full border px-2.5 text-[11px] font-semibold uppercase tracking-[0.16em]",
                  project.status === "ready"
                    ? "border-emerald-900/10 bg-emerald-900/8 text-emerald-950 dark:border-emerald-300/20 dark:bg-emerald-300/10 dark:text-emerald-100"
                    : "border-amber-900/15 bg-amber-800/8 text-amber-950 dark:border-amber-300/20 dark:bg-amber-300/10 dark:text-amber-100",
                )}
              >
                {formatProjectStatusLabel(project.status)}
              </Badge>
              <CardTitle className="text-2xl tracking-[-0.03em] text-[color:var(--ink-strong)]">
                {project.name}
              </CardTitle>
            </div>
            <div className="rounded-full border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)]/70 p-2 text-[color:var(--ink-soft)]">
              <Boxes className="size-4" />
            </div>
          </div>
          <CardDescription className="leading-6">
            项目编号：<span className="font-mono text-xs text-[color:var(--ink-soft)]">{project.id}</span>
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-1 flex-col gap-4 pt-4">
          <div className="grid grid-cols-2 gap-2">
            {structureItems.map((item) => (
              <StructurePill
                key={item.key}
                label={item.label}
                present={project[item.key]}
              />
            ))}
          </div>
          <p className="text-sm leading-6 text-muted-foreground">
            {project.status === "ready"
              ? "核心项目结构已经就绪，可以直接进入工作台继续阅读、编辑和分析。"
              : "这个项目仍有结构缺失，可先把缺失项作为进入编辑前的整理线索。"}
          </p>
        </CardContent>

        <CardFooter className="justify-between border-[color:var(--paper-border)] bg-[color:var(--paper-muted)]/45">
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            {updatedAtLabel}
          </div>
          <div className="inline-flex items-center gap-2 text-sm font-medium text-[color:var(--ink-strong)]">
            打开档案
            <ArrowRight className="size-4" />
          </div>
        </CardFooter>
      </Card>
    </Link>
  );
}

function StructurePill({
  label,
  present,
}: {
  label: string;
  present: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-[20px] border p-3",
        present
          ? "border-emerald-900/10 bg-emerald-900/[0.05] dark:border-emerald-300/20 dark:bg-emerald-300/10"
          : "border-amber-900/10 bg-amber-900/[0.04] dark:border-amber-300/20 dark:bg-amber-300/10",
      )}
    >
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium text-[color:var(--ink-strong)]">
        {present ? "已存在" : "缺失"}
      </p>
    </div>
  );
}

function SidebarMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof FolderArchive;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-[20px] border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)]/45 p-3">
      <div className="rounded-full border border-[color:var(--paper-border)] bg-[color:var(--paper-accent)]/20 p-2 text-[color:var(--ink-soft)]">
        <Icon className="size-4" />
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
        <p className="mt-1 text-sm font-medium text-[color:var(--ink-strong)]">{value}</p>
      </div>
    </div>
  );
}

function formatUpdatedAt(value: string | null) {
  if (!value) {
    return "无更新时间";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "时间不可用";
  }

  return `更新于 ${new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date)}`;
}
