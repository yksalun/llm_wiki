"use client";

import { Settings, UserCircle } from "lucide-react";

import { useAnswerMetricsPreferences } from "@/components/chat/answer-metrics-preferences";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface PersonalCenterSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PersonalCenterSheet({
  open,
  onOpenChange,
}: PersonalCenterSheetProps) {
  const { preferences, setShowAnswerMetrics } = useAnswerMetricsPreferences();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-80 max-w-[85vw]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <UserCircle className="size-4" aria-hidden="true" />
            个人中心
          </SheetTitle>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-4">
          <div className="flex items-center gap-2 text-sm font-medium text-[color:var(--ink-strong)]">
            <Settings className="size-4 text-muted-foreground" aria-hidden="true" />
            设置
          </div>
          <div className="rounded-md border border-[color:var(--paper-border)] bg-[color:var(--paper-panel)] p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-[color:var(--ink-strong)]">
                显示 AI 回答数据
              </span>
              <Button
                data-answer-metrics-switch="true"
                type="button"
                role="switch"
                aria-label="显示 AI 回答数据"
                aria-checked={preferences.showAnswerMetrics}
                variant="ghost"
                className={cn(
                  "h-6 w-11 shrink-0 rounded-full p-0 transition-colors hover:bg-muted",
                  preferences.showAnswerMetrics ? "bg-primary hover:bg-primary" : "bg-muted",
                )}
                onClick={() => setShowAnswerMetrics(!preferences.showAnswerMetrics)}
              >
                <span
                  className={cn(
                    "block size-5 rounded-full bg-background shadow transition-transform",
                    preferences.showAnswerMetrics ? "translate-x-2.5" : "-translate-x-2.5",
                  )}
                />
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
