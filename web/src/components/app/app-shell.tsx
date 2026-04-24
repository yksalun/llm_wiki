import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface AppShellProps {
  eyebrow?: string;
  title: string;
  description: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function AppShell({
  eyebrow,
  title,
  description,
  aside,
  children,
  className,
}: AppShellProps) {
  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(168,112,40,0.16),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(47,41,35,0.08),transparent_30%)]" />
        <div className="absolute inset-x-0 top-0 h-48 border-b border-black/5 bg-[linear-gradient(180deg,rgba(255,250,240,0.86),rgba(255,250,240,0))]" />
      </div>

      <div className={cn("relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10", className)}>
        <header className="relative overflow-hidden rounded-[28px] border border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]/95 p-6 shadow-[0_22px_80px_rgba(61,52,40,0.08)] backdrop-blur-sm sm:p-8">
          <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(135,98,41,0.35),transparent)]" />
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-end">
            <div className="space-y-4">
              {eyebrow ? (
                <p className="font-mono text-[11px] font-medium uppercase tracking-[0.28em] text-[color:var(--ink-soft)]">
                  {eyebrow}
                </p>
              ) : null}
              <div className="space-y-3">
                <h1 className="max-w-4xl text-4xl font-semibold tracking-[-0.04em] text-[color:var(--ink-strong)] sm:text-5xl lg:text-6xl">
                  {title}
                </h1>
                <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                  {description}
                </p>
              </div>
            </div>
            {aside ? <div className="lg:justify-self-end">{aside}</div> : null}
          </div>
        </header>

        <section className="relative mt-6 flex-1">{children}</section>
      </div>
    </main>
  );
}
