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
  X,
} from "lucide-react";

import { ChatExperience } from "@/components/chat/chat-experience";
import {
  loadChatHomeState,
  removeRecentConversation,
  saveChatHomeState,
  upsertRecentConversation,
  type ChatHomeState,
} from "@/components/chat/chat-home-storage";
import { KnowledgeBaseSelector } from "@/components/chat/knowledge-base-selector";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button, buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { fetchProjects } from "@/lib/client/api";
import type { DesktopBridgeConversation, ProjectSummary, ProjectsListResponse } from "@/lib/types";
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
            message: error instanceof Error ? error.message : "无法加载项目列表。",
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
        title: conversation.title || "新会话",
        updatedAt: conversation.updatedAt || Date.now(),
      }),
    );
  }

  const knowledgeBaseEmptyAction =
    projectsState.status === "loading" ? null : (
      <Link
        href="/projects"
        className={buttonVariants({
          variant: "outline",
          size: "sm",
          className: "w-full justify-start",
        })}
      >
        <Settings2 className="size-3.5" aria-hidden="true" />
        打开知识库配置
      </Link>
    );

  const selector = (
    <KnowledgeBaseSelector
      projects={projects}
      selectedProjectId={selectedProject?.id ?? null}
      disabled={projectsState.status !== "ready"}
      emptyMessage={getKnowledgeBaseEmptyMessage(projectsState)}
      emptyAction={knowledgeBaseEmptyAction}
      onSelectProject={handleSelectProject}
    />
  );

  return (
    <main className="flex min-h-screen overflow-x-hidden bg-[color:var(--paper-base)] text-[color:var(--ink-strong)]">
      <DesktopSidebar
        collapsed={homeState.sidebarCollapsed}
        projects={projects}
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
        onRemoveRecent={(projectId, conversationId) =>
          updateHomeState((current) => {
            const nextState = removeRecentConversation(current, projectId, conversationId);

            return nextState.selectedProjectId === projectId
              ? { ...nextState, selectedProjectId: null }
              : nextState;
          })
        }
      />

      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <SheetContent side="left" className="w-80 max-w-[85vw]">
          <SheetHeader>
            <SheetTitle>会话导航</SheetTitle>
          </SheetHeader>
          <MobileSidebarBody
            projects={projects}
            recentConversations={homeState.recentConversations}
            onSelectRecent={(projectId) => {
              setMobileSidebarOpen(false);
              updateHomeState((current) => ({
                ...current,
                selectedProjectId: projectId,
              }));
            }}
            onRemoveRecent={(projectId, conversationId) =>
              updateHomeState((current) => {
                const nextState = removeRecentConversation(current, projectId, conversationId);

                return nextState.selectedProjectId === projectId
                  ? { ...nextState, selectedProjectId: null }
                  : nextState;
              })
            }
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
              aria-label="打开会话导航"
            >
              <Menu className="size-4" aria-hidden="true" />
            </Button>
            <MessageSquare className="hidden size-4 text-muted-foreground sm:block" aria-hidden="true" />
            <div>
              <h1 className="text-sm font-medium">知识库问答</h1>
              <p className="text-xs text-muted-foreground">
                {selectedProject ? selectedProject.name : "选择知识库"}
              </p>
            </div>
          </div>
          <ThemeToggle />
        </header>

        <div className="flex h-[calc(100vh-3.75rem)] min-h-0 min-w-0 w-full flex-1 justify-center px-3 pb-0 pt-3 md:px-5 md:pt-5">
          <ChatExperience
            key={selectedProject?.id ?? "no-project"}
            projectId={selectedProject?.id ?? null}
            mode="home"
            title="知识库问答"
            showSessionList={false}
            disabledMessage={getComposerDisabledMessage(projectsState, projects.length)}
            composerTopSlot={selector}
            className="flex h-full min-h-0 min-w-0 w-full max-w-3xl flex-1"
            minHeightClassName="min-h-0"
            onConversationChange={handleConversationChange}
          />
        </div>
      </section>
    </main>
  );
}

function getKnowledgeBaseEmptyMessage(projectsState: ProjectsState) {
  if (projectsState.status === "loading") {
    return "正在加载知识库...";
  }

  if (projectsState.status === "error") {
    return `无法加载知识库：${projectsState.message}`;
  }

  return "暂无知识库，请先打开知识库配置添加项目。";
}

function getComposerDisabledMessage(projectsState: ProjectsState, projectCount: number) {
  if (projectsState.status === "loading") {
    return "知识库正在加载，请稍候。";
  }

  if (projectsState.status === "error") {
    return "知识库列表加载失败，请打开知识库配置检查项目根目录。";
  }

  if (projectCount === 0) {
    return "暂无知识库，请先打开知识库配置添加项目。";
  }

  return "请先选择知识库再提问。";
}

function DesktopSidebar({
  collapsed,
  projects,
  recentConversations,
  selectedProjectId,
  onToggleCollapsed,
  onSelectRecent,
  onRemoveRecent,
}: {
  collapsed: boolean;
  projects: ProjectSummary[];
  recentConversations: ChatHomeState["recentConversations"];
  selectedProjectId: string | null;
  onToggleCollapsed: () => void;
  onSelectRecent: (projectId: string) => void;
  onRemoveRecent: (projectId: string, conversationId: string) => void;
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
          {!collapsed ? "新会话" : null}
        </Button>
        <Link
          href="/projects"
          className={buttonVariants({
            variant: "ghost",
            className: cn("w-full", collapsed ? "px-0" : "justify-start"),
          })}
        >
          <Settings2 className="size-4" aria-hidden="true" />
          {!collapsed ? "知识库配置" : null}
        </Link>
        <Button
          type="button"
          variant="ghost"
          className={cn("w-full", collapsed ? "px-0" : "justify-start")}
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" aria-hidden="true" />
          ) : (
            <PanelLeftClose className="size-4" aria-hidden="true" />
          )}
          {!collapsed ? "收起" : null}
        </Button>
      </div>

      <div className="mt-4 min-h-0 flex-1 space-y-1 overflow-y-auto">
        {!collapsed && recentConversations.length === 0 ? (
          <p className="rounded-md border border-dashed border-[color:var(--paper-border)] px-3 py-2 text-sm text-muted-foreground">
            暂无最近会话
          </p>
        ) : null}
        {!collapsed
          ? recentConversations.map((item) => {
              const unavailable =
                projects.length > 0
                  ? !projects.some((project) => project.id === item.projectId)
                  : true;

              return (
                <div key={`${item.projectId}:${item.conversationId}`} className="flex items-start gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={unavailable}
                    className={cn(
                      "h-auto min-w-0 flex-1 justify-start whitespace-normal px-2 py-2 text-left",
                      item.projectId === selectedProjectId
                        ? "bg-[color:var(--paper-muted)] text-[color:var(--ink-strong)]"
                        : "text-muted-foreground",
                    )}
                    onClick={() => onSelectRecent(item.projectId)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{item.title}</span>
                      {unavailable ? (
                        <span className="block text-[11px] text-destructive">不可用</span>
                      ) : (
                        <span className="block truncate text-[11px] opacity-75">
                          {item.projectName}
                        </span>
                      )}
                    </span>
                  </Button>
                  {unavailable ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`移除 ${item.title}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onRemoveRecent(item.projectId, item.conversationId);
                      }}
                    >
                      <X className="size-3" aria-hidden="true" />
                    </Button>
                  ) : null}
                </div>
              );
            })
          : null}
      </div>

      <Button type="button" variant="ghost" className={cn("mt-3 w-full", collapsed ? "px-0" : "justify-start")}>
        <UserCircle className="size-4" aria-hidden="true" />
        {!collapsed ? "个人中心" : null}
      </Button>
    </aside>
  );
}

function MobileSidebarBody({
  projects,
  recentConversations,
  onSelectRecent,
  onRemoveRecent,
}: {
  projects: ProjectSummary[];
  recentConversations: ChatHomeState["recentConversations"];
  onSelectRecent: (projectId: string) => void;
  onRemoveRecent: (projectId: string, conversationId: string) => void;
}) {
  return (
    <div className="space-y-3 px-4 pb-4">
      <Link href="/projects" className={buttonVariants({ variant: "outline", className: "w-full justify-start" })}>
        <Settings2 className="size-4" aria-hidden="true" />
        知识库配置
      </Link>
      <div className="space-y-1">
        {recentConversations.length === 0 ? (
          <p className="rounded-md border border-dashed border-[color:var(--paper-border)] px-3 py-2 text-sm text-muted-foreground">
            暂无最近会话
          </p>
        ) : (
          recentConversations.map((item) => {
            const unavailable =
              projects.length > 0
                ? !projects.some((project) => project.id === item.projectId)
                : true;

            return (
              <div key={`${item.projectId}:${item.conversationId}`} className="flex items-start gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={unavailable}
                  className="h-auto min-w-0 flex-1 justify-start whitespace-normal px-2 py-2 text-left"
                  onClick={() => onSelectRecent(item.projectId)}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{item.title}</span>
                    {unavailable ? (
                      <span className="block text-[11px] text-destructive">不可用</span>
                    ) : (
                      <span className="block truncate text-[11px] opacity-75">
                        {item.projectName}
                      </span>
                    )}
                  </span>
                </Button>
                {unavailable ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`移除 ${item.title}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemoveRecent(item.projectId, item.conversationId);
                    }}
                  >
                    <X className="size-3" aria-hidden="true" />
                  </Button>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
