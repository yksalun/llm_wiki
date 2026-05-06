"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MessageSquare, Plus, Settings2, UserCircle } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { fetchProjects } from "@/lib/client/api";
import type { ProjectsListResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: ProjectsListResponse }
  | { status: "error" };

export function ChatHomePage() {
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
      .catch(() => {
        if (abortController.signal.aborted) {
          return;
        }

        setLoadState({ status: "error" });
      });

    return () => {
      abortController.abort();
    };
  }, []);

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-72 shrink-0 flex-col border-r border-border bg-muted/35 p-3 md:flex">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <MessageSquare className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">LLM Wiki Chat</p>
            <p className="truncate text-xs text-muted-foreground">Knowledge workspace</p>
          </div>
        </div>

        <div className="mt-4 space-y-1">
          <Button className="w-full justify-start" variant="ghost">
            <Plus className="size-4" />
            New chat
          </Button>
          <Link
            href="/projects"
            className={cn(buttonVariants({ variant: "ghost" }), "w-full justify-start")}
          >
            <Settings2 className="size-4" />
            Knowledge config
          </Link>
        </div>

        <div className="mt-6 flex-1 px-2">
          <p className="text-xs font-medium text-muted-foreground">No recent chats</p>
        </div>

        <div className="border-t border-border pt-3">
          <Button className="w-full justify-start" variant="ghost">
            <UserCircle className="size-4" />
            Profile
          </Button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-border px-4">
          <div className="flex min-w-0 items-center gap-2">
            <MessageSquare className="size-5 text-muted-foreground md:hidden" />
            <h1 className="truncate text-base font-semibold">LLM Wiki Chat</h1>
          </div>
          <Link
            href="/projects"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <Settings2 className="size-4" />
            Knowledge config
          </Link>
        </header>

        <div className="flex flex-1 items-center justify-center p-4">
          <section className="w-full max-w-xl rounded-lg border border-border bg-card p-6 text-center shadow-sm">
            <div className="mx-auto flex size-12 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <MessageSquare className="size-6" />
            </div>
            <h2 className="mt-4 text-xl font-semibold">
              {loadState.status === "loading"
                ? "Loading knowledge bases..."
                : "Choose a knowledge base"}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {loadState.status === "loading"
                ? "Preparing your configured project list."
                : "Choose a knowledge base before asking."}
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
