"use client";

import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";

import { useTheme } from "./theme-provider";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const nextThemeLabel = theme === "dark" ? "浅色" : "深色";
  const ariaLabel = theme === "dark" ? "切换为浅色主题" : "切换为深色主题";
  const Icon = theme === "dark" ? Sun : Moon;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={toggleTheme}
      aria-label={ariaLabel}
      className="rounded-full border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]/80"
    >
      <Icon className="size-4" aria-hidden="true" />
      {nextThemeLabel}
    </Button>
  );
}
