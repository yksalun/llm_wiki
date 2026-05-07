"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Menu,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings2,
  UserCircle,
} from "lucide-react";

import { ChatExperience } from "@/components/chat/chat-experience";
import {
  loadChatHomeState,
  saveChatHomeState,
  upsertRecentConversation,
  type ChatHomeState,
} from "@/components/chat/chat-home-storage";
import { KnowledgeBaseSelector } from "@/components/chat/knowledge-base-selector";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button, buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { fetchProjects } from "@/lib/client/api";
import type { DesktopBridgeConversation, ProjectsListResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

type ProjectsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ProjectsListResponse };

export function ChatHomePage() {
  const [projectsState, setProjectsState] = useState<ProjectsState>({ status: "loading" });
  const [homeState, setHomeState] = useState<ChatHomeState>(() => loadChatHomeState());
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useEffect(() => {
    saveChatHomeState(homeState);
  }, [homeState]);

  useEffect(() => {
    const controller = new AbortController();

    fetchProjects(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setProjectsState({ status: "ready", data });
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setProjectsState({
            status: "error",
            message: error instanceof Error ? error.message : "Unable to load projects.",
          });
        }
      });

    return () => {
      controller.abort();
    };
  }, []);

  const projects = projectsState.status === "ready" ? projectsState.data.projects : [];
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === homeState.selectedProjectId) ?? null,
    [homeState.selectedProjectId, projects],
  );

  function updateHomeState(updater: (current: ChatHomeState) => ChatHomeState) {
    setHomeState((current) => updater(current));
  }

  function handleSelectProject(projectId: string) {
    updateHomeState((current) => ({
      ...current,
      selectedProjectId: projectId,
    }));
  }

  function handleConversationChange(event: {
    projectId: string;
    conversation: DesktopBridgeConversation | null;
  }) {
    const conversation = event.conversation;

    if (!conversation) {
      return;
    }

    const project = projects.find((candidate) => candidate.id === event.projectId);
    updateHomeState((current) =>
      upsertRecentConversation(current, {
        projectId: event.projectId,
        projectName: project?.name ?? event.projectId,
        conversationId: conversation.id,
        title: conversation.title || "New conversation",
        updatedAt: conversation.updatedAt || Date.now(),
      }),
    );
  }

  const selector = (
    <KnowledgeBaseSelector
      projects={projects}
      selectedProjectId={selectedProject?.id ?? null}
      disabled={projectsState.status !== "ready"}
      onSelectProject={handleSelectProject}
    />
  );

  return (
    <main className="flex min-h-screen bg-[color:var(--paper-base)] text-[color:var(--ink-strong)]">
      <DesktopSidebar
        collapsed={homeState.sidebarCollapsed}
        recentConversations={homeState.recentConversations}
        selectedProjectId={selectedProject?.id ?? null}
        onToggleCollapsed={() =>
          updateHomeState((current) => ({
            ...current,
            sidebarCollapsed: !current.sidebarCollapsed,
          }))
        }
        onSelectRecent={(projectId) =>
          updateHomeState((current) => ({
            ...current,
            selectedProjectId: projectId,
          }))
        }
      />

      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <SheetContent side="left" className="w-80 max-w-[85vw]">
          <SheetHeader>
            <SheetTitle>Chat navigation</SheetTitle>
          </SheetHeader>
          <MobileSidebarBody
            recentConversations={homeState.recentConversations}
            onSelectRecent={(projectId) => {
              setMobileSidebarOpen(false);
              updateHomeState((current) => ({
                ...current,
                selectedProjectId: projectId,
              }));
            }}
          />
        </SheetContent>
      </Sheet>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]/80 px-4 py-3">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="md:hidden"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Open chat navigation"
            >
              <Menu className="size-4" aria-hidden="true" />
            </Button>
            <MessageSquare className="hidden size-4 text-muted-foreground sm:block" aria-hidden="true" />
            <div>
              <h1 className="text-sm font-medium">LLM Wiki Chat</h1>
              <p className="text-xs text-muted-foreground">
                {selectedProject ? selectedProject.name : "Choose a knowledge base"}
              </p>
            </div>
          </div>
          <ThemeToggle />
        </header>

        <div className="flex min-h-0 flex-1 p-3 md:p-5">
          <ChatExperience
            key={selectedProject?.id ?? "no-project"}
            projectId={selectedProject?.id ?? null}
            mode="home"
            title="Knowledge chat"
            showSessionList={false}
            disabledMessage={
              projects.length === 0
                ? "No knowledge bases are available. Open knowledge config to add one."
                : "Choose a knowledge base before asking."
            }
            composerTopSlot={selector}
            className="flex min-h-0 flex-1"
            minHeightClassName="min-h-[calc(100vh-8rem)]"
            onConversationChange={handleConversationChange}
          />
        </div>
      </section>
    </main>
  );
}

function DesktopSidebar({
  collapsed,
  recentConversations,
  selectedProjectId,
  onToggleCollapsed,
  onSelectRecent,
}: {
  collapsed: boolean;
  recentConversations: ChatHomeState["recentConversations"];
  selectedProjectId: string | null;
  onToggleCollapsed: () => void;
  onSelectRecent: (projectId: string) => void;
}) {
  return (
    <aside
      className={cn(
        "hidden shrink-0 border-r border-[color:var(--paper-border)] bg-[color:var(--paper-panel)] p-3 transition-[width] md:flex md:flex-col",
        collapsed ? "w-16" : "w-72",
      )}
    >
      <div className="space-y-2">
        <Button type="button" variant="outline" className={cn("w-full", collapsed ? "px-0" : "justify-start")}>
          <Plus className="size-4" aria-hidden="true" />
          {!collapsed ? "New chat" : null}
        </Button>
        <Link
          href="/projects"
          className={buttonVariants({
            variant: "ghost",
            className: cn("w-full", collapsed ? "px-0" : "justify-start"),
          })}
        >
          <Settings2 className="size-4" aria-hidden="true" />
          {!collapsed ? "Knowledge config" : null}
        </Link>
        <Button
          type="button"
          variant="ghost"
          className={cn("w-full", collapsed ? "px-0" : "justify-start")}
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" aria-hidden="true" />
          ) : (
            <PanelLeftClose className="size-4" aria-hidden="true" />
          )}
          {!collapsed ? "Collapse" : null}
        </Button>
      </div>

      <div className="mt-4 min-h-0 flex-1 space-y-1 overflow-y-auto">
        {!collapsed && recentConversations.length === 0 ? (
          <p className="rounded-md border border-dashed border-[color:var(--paper-border)] px-3 py-2 text-sm text-muted-foreground">
            No recent chats
          </p>
        ) : null}
        {!collapsed
          ? recentConversations.map((item) => (
              <Button
                key={`${item.projectId}:${item.conversationId}`}
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  "h-auto w-full justify-start whitespace-normal px-2 py-2 text-left",
                  item.projectId === selectedProjectId
                    ? "bg-[color:var(--paper-muted)] text-[color:var(--ink-strong)]"
                    : "text-muted-foreground",
                )}
                onClick={() => onSelectRecent(item.projectId)}
              >
                <span className="min-w-0">
                  <span className="block truncate">{item.title}</span>
                  <span className="block truncate text-[11px] opacity-75">{item.projectName}</span>
                </span>
              </Button>
            ))
          : null}
      </div>

      <Button type="button" variant="ghost" className={cn("mt-3 w-full", collapsed ? "px-0" : "justify-start")}>
        <UserCircle className="size-4" aria-hidden="true" />
        {!collapsed ? "Profile" : null}
      </Button>
    </aside>
  );
}

function MobileSidebarBody({
  recentConversations,
  onSelectRecent,
}: {
  recentConversations: ChatHomeState["recentConversations"];
  onSelectRecent: (projectId: string) => void;
}) {
  return (
    <div className="space-y-3 px-4 pb-4">
      <Link href="/projects" className={buttonVariants({ variant: "outline", className: "w-full justify-start" })}>
        <Settings2 className="size-4" aria-hidden="true" />
        Knowledge config
      </Link>
      <div className="space-y-1">
        {recentConversations.length === 0 ? (
          <p className="rounded-md border border-dashed border-[color:var(--paper-border)] px-3 py-2 text-sm text-muted-foreground">
            No recent chats
          </p>
        ) : (
          recentConversations.map((item) => (
            <Button
              key={`${item.projectId}:${item.conversationId}`}
              type="button"
              variant="ghost"
              className="h-auto w-full justify-start whitespace-normal px-2 py-2 text-left"
              onClick={() => onSelectRecent(item.projectId)}
            >
              <span className="min-w-0">
                <span className="block truncate">{item.title}</span>
                <span className="block truncate text-[11px] opacity-75">{item.projectName}</span>
              </span>
            </Button>
          ))
        )}
      </div>
    </div>
  );
}
