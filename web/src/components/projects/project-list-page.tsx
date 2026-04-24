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
  { key: "hasPurpose", label: "Purpose" },
  { key: "hasSchema", label: "Schema" },
  { key: "hasWikiDirectory", label: "Wiki" },
  { key: "hasRawSourcesDirectory", label: "Raw Sources" },
];

export function ProjectListPage() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    const abortController = new AbortController();

    setLoadState({ status: "loading" });

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

        const message =
          error instanceof Error ? error.message : "Unable to load project records.";

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
      eyebrow="Editorial Project Registry"
      title="Choose a project dossier to open."
      description="Browse the active archive before stepping into the workbench. Each record surfaces the structural readiness of a project, so the next page can open with context instead of guesswork."
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
            <CardHeader className="border-b border-black/5">
              <CardTitle className="text-[15px] uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">
                Reading Notes
              </CardTitle>
              <CardDescription>
                The list favors archive cues over dashboard chrome.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <SidebarMetric
                icon={FolderArchive}
                label="Status marker"
                value="Ready or Incomplete"
              />
              <SidebarMetric
                icon={BookOpenText}
                label="Required structure"
                value="Purpose / Schema / Wiki"
              />
              <SidebarMetric
                icon={FileSearch}
                label="Optional depth"
                value="Raw sources surfaced when present"
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
    <Card className="border-[color:var(--paper-border)] bg-[linear-gradient(180deg,rgba(255,252,246,0.92),rgba(245,239,229,0.86))] shadow-[0_18px_60px_rgba(88,67,42,0.10)]">
      <CardHeader className="border-b border-black/5">
        <CardTitle className="text-sm uppercase tracking-[0.22em] text-[color:var(--ink-soft)]">
          Intake Desk
        </CardTitle>
        <CardDescription>
          A calm front door for the research workbench.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              Listed dossiers
            </p>
            <p className="mt-1 text-4xl font-semibold tracking-[-0.05em] text-[color:var(--ink-strong)]">
              {projectCount ?? "-"}
            </p>
          </div>
          <Badge className="border border-amber-900/10 bg-amber-700/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-900">
            registry
          </Badge>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          Open the card that already has enough structure, or use the gaps as a quick editorial triage list.
        </p>
      </CardContent>
    </Card>
  );
}

function WarningsAlert({ warnings }: { warnings: string[] }) {
  return (
    <Alert className="border-[color:var(--paper-border)] bg-[linear-gradient(180deg,rgba(255,249,236,0.95),rgba(251,244,228,0.92))] px-4 py-3 text-[color:var(--ink-strong)] shadow-[0_14px_40px_rgba(135,98,41,0.08)]">
      <AlertTriangle className="mt-0.5 size-4 text-amber-800" />
      <AlertTitle className="font-medium tracking-[0.01em] text-amber-950">
        Archive note
      </AlertTitle>
      <AlertDescription className="text-amber-900/80">
        {warnings.length === 1 ? (
          warnings[0]
        ) : (
          <ul className="space-y-1 pl-4">
            {warnings.map((warning) => (
              <li key={warning} className="list-disc">
                {warning}
              </li>
            ))}
          </ul>
        )}
      </AlertDescription>
    </Alert>
  );
}

function LoadingState() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }, (_, index) => (
        <Card
          key={index}
          className="border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]/90 shadow-[0_16px_48px_rgba(61,52,40,0.06)]"
        >
          <CardHeader className="space-y-3 border-b border-black/5">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <Skeleton className="h-4 w-24 rounded-full bg-black/8" />
                <Skeleton className="h-8 w-44 bg-black/8" />
              </div>
              <Skeleton className="h-6 w-20 rounded-full bg-black/8" />
            </div>
            <Skeleton className="h-4 w-full bg-black/8" />
            <Skeleton className="h-4 w-3/4 bg-black/8" />
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: 4 }, (_, itemIndex) => (
                <Skeleton key={itemIndex} className="h-16 rounded-2xl bg-black/7" />
              ))}
            </div>
          </CardContent>
          <CardFooter className="justify-between border-black/5 bg-black/[0.02]">
            <Skeleton className="h-4 w-28 bg-black/8" />
            <Skeleton className="h-4 w-16 bg-black/8" />
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <Card className="border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]/90 shadow-[0_16px_48px_rgba(61,52,40,0.08)]">
      <CardHeader className="border-b border-black/5">
        <CardTitle>Unable to open the registry</CardTitle>
        <CardDescription>
          The intake list could not be assembled from `/api/projects`.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <Alert variant="destructive" className="border-destructive/20 bg-destructive/5 px-4 py-3">
          <AlertTriangle className="mt-0.5 size-4" />
          <AlertTitle>Request failed</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <Card className="border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]/90 shadow-[0_16px_48px_rgba(61,52,40,0.08)]">
      <CardHeader className="border-b border-black/5">
        <CardTitle>No dossiers found</CardTitle>
        <CardDescription>
          The registry is reachable, but there are no projects to present yet.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="rounded-[24px] border border-dashed border-black/10 bg-[linear-gradient(180deg,rgba(255,252,246,0.7),rgba(245,239,229,0.45))] p-6">
          <p className="max-w-xl text-sm leading-7 text-muted-foreground">
            Once project roots resolve to valid workspaces, this page will promote them into archive cards with structure markers and entry points.
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
      <Card className="h-full border-[color:var(--paper-border)] bg-[linear-gradient(180deg,rgba(255,252,246,0.92),rgba(247,242,234,0.84))] shadow-[0_18px_60px_rgba(61,52,40,0.08)] transition-transform duration-300 hover:-translate-y-1 hover:shadow-[0_22px_70px_rgba(61,52,40,0.12)]">
        <CardHeader className="gap-3 border-b border-black/5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <Badge
                variant={project.status === "ready" ? "secondary" : "outline"}
                className={cn(
                  "h-6 rounded-full border px-2.5 text-[11px] font-semibold uppercase tracking-[0.16em]",
                  project.status === "ready"
                    ? "border-emerald-900/10 bg-emerald-900/8 text-emerald-950"
                    : "border-amber-900/15 bg-amber-800/8 text-amber-950",
                )}
              >
                {project.status}
              </Badge>
              <CardTitle className="text-2xl tracking-[-0.03em] text-[color:var(--ink-strong)]">
                {project.name}
              </CardTitle>
            </div>
            <div className="rounded-full border border-black/8 bg-white/70 p-2 text-[color:var(--ink-soft)]">
              <Boxes className="size-4" />
            </div>
          </div>
          <CardDescription className="leading-6">
            Project ID: <span className="font-mono text-xs text-[color:var(--ink-soft)]">{project.id}</span>
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
              ? "Core editorial structure is in place for immediate handoff into the workbench."
              : "This record still exposes missing structure, making it useful as a triage target before editing."}
          </p>
        </CardContent>

        <CardFooter className="justify-between border-black/5 bg-black/[0.02]">
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            {updatedAtLabel}
          </div>
          <div className="inline-flex items-center gap-2 text-sm font-medium text-[color:var(--ink-strong)]">
            Open dossier
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
          ? "border-emerald-900/10 bg-emerald-900/[0.05]"
          : "border-amber-900/10 bg-amber-900/[0.04]",
      )}
    >
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium text-[color:var(--ink-strong)]">
        {present ? "Present" : "Missing"}
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
    <div className="flex items-start gap-3 rounded-[20px] border border-black/6 bg-white/55 p-3">
      <div className="rounded-full border border-black/8 bg-[color:var(--paper-accent)]/20 p-2 text-[color:var(--ink-soft)]">
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
    return "No timestamp";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Timestamp unavailable";
  }

  return `Updated ${new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)}`;
}
