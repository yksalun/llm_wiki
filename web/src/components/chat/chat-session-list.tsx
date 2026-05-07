"use client";

import { MessageSquare, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { DesktopBridgeConversation } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface ChatSessionListProps {
  title: string;
  conversations: DesktopBridgeConversation[];
  activeConversationId: string | null;
  disabled: boolean;
  newConversationLabel: string;
  emptyLabel: string;
  onNewConversation: () => void;
  onSelectConversation: (conversationId: string) => void;
}

export function ChatSessionList({
  title,
  conversations,
  activeConversationId,
  disabled,
  newConversationLabel,
  emptyLabel,
  onNewConversation,
  onSelectConversation,
}: ChatSessionListProps) {
  return (
    <aside
      data-chat-session-list="true"
      className="space-y-3 rounded-md border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)] p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MessageSquare className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-sm font-medium text-[color:var(--ink-strong)]">{title}</h2>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onNewConversation}
          disabled={disabled}
        >
          <Plus className="size-4" aria-hidden="true" />
          {newConversationLabel}
        </Button>
      </div>

      <div className="space-y-2">
        {conversations.length > 0 ? (
          conversations.map((conversation) => (
            <Button
              key={conversation.id}
              type="button"
              size="sm"
              aria-current={conversation.id === activeConversationId ? "true" : undefined}
              variant="ghost"
              className={cn(
                "h-auto w-full justify-start whitespace-normal border px-2 py-2 text-left",
                conversation.id === activeConversationId
                  ? "border-[color:var(--ring)] bg-[color:var(--paper-panel)] font-semibold text-[color:var(--ink-strong)] shadow-sm"
                  : "border-transparent text-muted-foreground",
              )}
              onClick={() => onSelectConversation(conversation.id)}
              disabled={disabled}
            >
              {conversation.title || "新会话"}
            </Button>
          ))
        ) : (
          <p className="rounded-md border border-[color:var(--paper-border)] bg-[color:var(--paper-panel)] px-3 py-2 text-sm text-muted-foreground">
            {emptyLabel}
          </p>
        )}
      </div>
    </aside>
  );
}
