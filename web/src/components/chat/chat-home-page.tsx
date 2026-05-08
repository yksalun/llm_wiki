"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  Menu,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PencilLine,
  Plus,
  Search,
  Settings2,
  Trash2,
  UserCircle,
} from "lucide-react";

import { ChatExperience } from "@/components/chat/chat-experience";
import {
  loadChatHomeState,
  renameRecentConversation,
  removeRecentConversation,
  saveChatHomeState,
  upsertRecentConversation,
  type ChatHomeState,
} from "@/components/chat/chat-home-storage";
import { KnowledgeBaseSelector } from "@/components/chat/knowledge-base-selector";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { fetchProjects } from "@/lib/client/api";
import type { DesktopBridgeConversation, ProjectSummary, ProjectsListResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

type ProjectsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ProjectsListResponse };

const EMPTY_PROJECTS: ProjectSummary[] = [];

export function ChatHomePage() {
  const [projectsState, setProjectsState] = useState<ProjectsState>({ status: "loading" });
  const [homeState, setHomeState] = useState<ChatHomeState>(() => loadChatHomeState());
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [newConversationRequestId, setNewConversationRequestId] = useState(0);

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

  const projects = projectsState.status === "ready" ? projectsState.data.projects : EMPTY_PROJECTS;
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === homeState.selectedProjectId) ?? null,
    [homeState.selectedProjectId, projects],
  );
  const sidebarWidthStyle = {
    "--chat-home-sidebar-width": homeState.sidebarCollapsed ? "4rem" : "18rem",
  } as CSSProperties;

  function updateHomeState(updater: (current: ChatHomeState) => ChatHomeState) {
    setHomeState((current) => updater(current));
  }

  function handleSelectProject(projectId: string) {
    updateHomeState((current) => ({
      ...current,
      selectedProjectId: projectId,
      selectedConversationId: null,
    }));
  }

  function handleNewConversation() {
    if (!selectedProject) {
      return;
    }

    updateHomeState((current) => ({
      ...current,
      selectedConversationId: null,
    }));
    setNewConversationRequestId((current) => current + 1);
  }

  function handleSelectRecent(projectId: string, conversationId: string) {
    updateHomeState((current) => ({
      ...current,
      selectedProjectId: projectId,
      selectedConversationId: conversationId,
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
    updateHomeState((current) => {
      const hasPendingConversationSelection =
        current.selectedProjectId === event.projectId &&
        current.selectedConversationId !== null &&
        current.selectedConversationId !== conversation.id;

      return {
        ...upsertRecentConversation(current, {
          projectId: event.projectId,
          projectName: project?.name ?? event.projectId,
          conversationId: conversation.id,
          title: conversation.title || "新会话",
          updatedAt: conversation.updatedAt || Date.now(),
        }),
        selectedProjectId: event.projectId,
        selectedConversationId: hasPendingConversationSelection
          ? current.selectedConversationId
          : conversation.id,
      };
    });
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
    <main
      className="flex h-screen overflow-hidden bg-[color:var(--paper-base)] text-[color:var(--ink-strong)]"
      style={sidebarWidthStyle}
    >
      <DesktopSidebar
        collapsed={homeState.sidebarCollapsed}
        projects={projects}
        recentConversations={homeState.recentConversations}
        selectedProjectId={selectedProject?.id ?? null}
        selectedConversationId={homeState.selectedConversationId}
        onNewConversation={handleNewConversation}
        onToggleCollapsed={() =>
          updateHomeState((current) => ({
            ...current,
            sidebarCollapsed: !current.sidebarCollapsed,
          }))
        }
        onSelectRecent={handleSelectRecent}
        onRenameRecent={(projectId, conversationId, title) =>
          updateHomeState((current) =>
            renameRecentConversation(current, projectId, conversationId, title),
          )
        }
        onRemoveRecent={(projectId, conversationId) =>
          updateHomeState((current) => {
            const nextState = removeRecentConversation(current, projectId, conversationId);

            return nextState.selectedProjectId === projectId &&
              nextState.selectedConversationId === conversationId
              ? { ...nextState, selectedConversationId: null }
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
            selectedProjectId={selectedProject?.id ?? null}
            selectedConversationId={homeState.selectedConversationId}
            onNewConversation={() => {
              setMobileSidebarOpen(false);
              handleNewConversation();
            }}
            onSelectRecent={(projectId, conversationId) => {
              setMobileSidebarOpen(false);
              handleSelectRecent(projectId, conversationId);
            }}
            onRenameRecent={(projectId, conversationId, title) =>
              updateHomeState((current) =>
                renameRecentConversation(current, projectId, conversationId, title),
              )
            }
            onRemoveRecent={(projectId, conversationId) =>
              updateHomeState((current) => {
                const nextState = removeRecentConversation(current, projectId, conversationId);

                return nextState.selectedProjectId === projectId &&
                  nextState.selectedConversationId === conversationId
                  ? { ...nextState, selectedConversationId: null }
                  : nextState;
              })
            }
          />
        </SheetContent>
      </Sheet>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between border-b border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]/80 px-4 py-3">
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

        <div
          data-chat-home-scroll-area="true"
          className="flex min-h-0 min-w-0 w-full flex-1 justify-center overflow-y-auto px-3 pb-0 pt-3 md:px-5 md:pt-5"
        >
          <ChatExperience
            key={selectedProject?.id ?? "no-project"}
            projectId={selectedProject?.id ?? null}
            mode="home"
            title="知识库问答"
            showSessionList={false}
            disabledMessage={getComposerDisabledMessage(projectsState, projects.length)}
            composerTopSlot={selector}
            className="flex min-h-[calc(100vh-3.75rem)] min-w-0 w-full max-w-3xl flex-1"
            minHeightClassName="min-h-0"
            requestedConversationId={homeState.selectedConversationId}
            newConversationRequestId={newConversationRequestId}
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
  selectedConversationId,
  onNewConversation,
  onToggleCollapsed,
  onSelectRecent,
  onRenameRecent,
  onRemoveRecent,
}: {
  collapsed: boolean;
  projects: ProjectSummary[];
  recentConversations: ChatHomeState["recentConversations"];
  selectedProjectId: string | null;
  selectedConversationId: string | null;
  onNewConversation: () => void;
  onToggleCollapsed: () => void;
  onSelectRecent: (projectId: string, conversationId: string) => void;
  onRenameRecent: (projectId: string, conversationId: string, title: string) => void;
  onRemoveRecent: (projectId: string, conversationId: string) => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const searchResults = normalizedSearchQuery
    ? recentConversations.filter((item) =>
        item.title.toLowerCase().includes(normalizedSearchQuery),
      )
    : recentConversations;

  return (
    <aside
      className={cn(
        "hidden h-screen shrink-0 border-r border-[color:var(--paper-border)] bg-[color:var(--paper-panel)] p-3 transition-[width] md:flex md:flex-col",
        collapsed ? "w-16" : "w-72",
      )}
    >
      <div className="space-y-2">
        <div className={cn("flex items-center", collapsed ? "justify-center" : "justify-between")}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="size-4" aria-hidden="true" />
            )}
          </Button>
          {!collapsed ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="搜索历史记录"
              onClick={() => {
                setSearchQuery("");
                setSearchOpen(true);
              }}
            >
              <Search className="size-4" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          className={cn("w-full", collapsed ? "px-0" : "justify-start")}
          disabled={!selectedProjectId}
          onClick={onNewConversation}
        >
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
              const active =
                item.projectId === selectedProjectId &&
                item.conversationId === selectedConversationId;

              return (
                <RecentConversationRow
                  key={`${item.projectId}:${item.conversationId}`}
                  item={item}
                  unavailable={unavailable}
                  active={active}
                  onSelectRecent={onSelectRecent}
                  onRenameRecent={onRenameRecent}
                  onRemoveRecent={onRemoveRecent}
                  hideActionsUntilHover
                />
              );
            })
          : null}
      </div>

      <Button type="button" variant="ghost" className={cn("mt-3 w-full", collapsed ? "px-0" : "justify-start")}>
        <UserCircle className="size-4" aria-hidden="true" />
        {!collapsed ? "个人中心" : null}
      </Button>
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>搜索历史记录</DialogTitle>
            <DialogDescription>仅搜索历史会话标题。</DialogDescription>
          </DialogHeader>
          <Input
            aria-label="搜索历史记录"
            placeholder="输入标题关键词"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            autoFocus
          />
          <div
            data-chat-history-search-results="true"
            className="max-h-72 space-y-1 overflow-y-auto"
          >
            {searchResults.length > 0 ? (
              searchResults.map((item) => (
                <Button
                  key={`${item.projectId}:${item.conversationId}`}
                  type="button"
                  variant="ghost"
                  data-chat-history-search-result="true"
                  className="h-auto w-full justify-start px-2 py-2 text-left"
                  onClick={() => {
                    onSelectRecent(item.projectId, item.conversationId);
                    setSearchOpen(false);
                  }}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{item.title}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {item.projectName}
                    </span>
                  </span>
                </Button>
              ))
            ) : (
              <p className="rounded-md border border-dashed border-[color:var(--paper-border)] px-3 py-2 text-sm text-muted-foreground">
                没有匹配的历史记录
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </aside>
  );
}

function RecentConversationRow({
  item,
  unavailable,
  active,
  hideActionsUntilHover = false,
  onSelectRecent,
  onRenameRecent,
  onRemoveRecent,
}: {
  item: ChatHomeState["recentConversations"][number];
  unavailable: boolean;
  active: boolean;
  hideActionsUntilHover?: boolean;
  onSelectRecent: (projectId: string, conversationId: string) => void;
  onRenameRecent: (projectId: string, conversationId: string, title: string) => void;
  onRemoveRecent: (projectId: string, conversationId: string) => void;
}) {
  return (
    <div
      data-chat-history-item="true"
      aria-current={active ? "true" : undefined}
      className={cn(
        "group/recent flex items-stretch rounded-lg border border-transparent transition-colors",
        active
          ? "border-[color:var(--ring)] bg-[color:var(--paper-muted)] font-semibold text-[color:var(--ink-strong)] shadow-sm"
          : "text-muted-foreground hover:bg-[color:var(--paper-muted)]",
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={unavailable}
        className="h-auto min-w-0 flex-1 justify-start whitespace-normal rounded-r-none px-2 py-2 text-left hover:bg-transparent"
        onClick={() => onSelectRecent(item.projectId, item.conversationId)}
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
      <RecentConversationActions
        item={item}
        onRenameRecent={onRenameRecent}
        onRemoveRecent={onRemoveRecent}
        triggerClassName={
          hideActionsUntilHover
            ? "opacity-0 group-hover/recent:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
            : undefined
        }
      />
    </div>
  );
}

function RecentConversationActions({
  item,
  onRenameRecent,
  onRemoveRecent,
  triggerClassName,
}: {
  item: ChatHomeState["recentConversations"][number];
  onRenameRecent: (projectId: string, conversationId: string, title: string) => void;
  onRemoveRecent: (projectId: string, conversationId: string) => void;
  triggerClassName?: string;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState(item.title);
  const trimmedRenameTitle = renameTitle.trim();

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className={cn(
                "my-1 mr-1 shrink-0 self-start text-muted-foreground hover:bg-background/70",
                triggerClassName,
              )}
              aria-label={`打开 ${item.title} 菜单`}
            />
          }
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
          <span className="sr-only">更多操作</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={4}>
          <DropdownMenuItem
            onClick={(event) => {
              event.stopPropagation();
              setRenameTitle(item.title);
              setRenameOpen(true);
            }}
          >
            <PencilLine className="size-4" aria-hidden="true" />
            重命名
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={(event) => {
              event.stopPropagation();
              setConfirmOpen(true);
            }}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            删除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!trimmedRenameTitle) {
                return;
              }

              onRenameRecent(item.projectId, item.conversationId, trimmedRenameTitle);
              setRenameOpen(false);
            }}
          >
            <DialogHeader>
              <DialogTitle>重命名聊天</DialogTitle>
              <DialogDescription>修改后只影响首页历史列表里的显示名称。</DialogDescription>
            </DialogHeader>
            <Input
              aria-label="聊天名称"
              value={renameTitle}
              onChange={(event) => setRenameTitle(event.target.value)}
              autoFocus
            />
            <DialogFooter>
              <DialogClose>取消</DialogClose>
              <Button type="submit" disabled={!trimmedRenameTitle}>
                确认重命名
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>删除聊天记录</AlertDialogTitle>
            <AlertDialogDescription>
              确认删除“{item.title}”这条历史聊天记录吗？删除后侧边栏将不再显示它。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.stopPropagation();
                onRemoveRecent(item.projectId, item.conversationId);
              }}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function MobileSidebarBody({
  projects,
  recentConversations,
  selectedProjectId,
  selectedConversationId,
  onNewConversation,
  onSelectRecent,
  onRenameRecent,
  onRemoveRecent,
}: {
  projects: ProjectSummary[];
  recentConversations: ChatHomeState["recentConversations"];
  selectedProjectId: string | null;
  selectedConversationId: string | null;
  onNewConversation: () => void;
  onSelectRecent: (projectId: string, conversationId: string) => void;
  onRenameRecent: (projectId: string, conversationId: string, title: string) => void;
  onRemoveRecent: (projectId: string, conversationId: string) => void;
}) {
  return (
    <div className="space-y-3 px-4 pb-4">
      <Button
        type="button"
        variant="outline"
        className="w-full justify-start"
        disabled={!selectedProjectId}
        onClick={onNewConversation}
      >
        <Plus className="size-4" aria-hidden="true" />
        新会话
      </Button>
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
            const active =
              item.projectId === selectedProjectId &&
              item.conversationId === selectedConversationId;

            return (
              <RecentConversationRow
                key={`${item.projectId}:${item.conversationId}`}
                item={item}
                unavailable={unavailable}
                active={active}
                onSelectRecent={onSelectRecent}
                onRenameRecent={onRenameRecent}
                onRemoveRecent={onRemoveRecent}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
