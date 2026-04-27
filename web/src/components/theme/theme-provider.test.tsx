// @vitest-environment jsdom

import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "./theme-provider";
import { ThemeToggle } from "./theme-toggle";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }

  container?.remove();
  container = null;
  root = null;
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("data-theme");
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("ThemeProvider", () => {
  it("renders a chinese toggle and switches to dark mode", () => {
    renderTheme();

    const button = requiredButton("深色");

    expect(button.getAttribute("aria-label")).toBe("切换为深色主题");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    act(() => {
      button.click();
    });

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem("llm-wiki-theme")).toBe("dark");
    expect(requiredButton("浅色").getAttribute("aria-label")).toBe("切换为浅色主题");
  });

  it("uses saved dark theme on first client render", () => {
    window.localStorage.setItem("llm-wiki-theme", "dark");

    renderTheme();

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(requiredButton("浅色")).not.toBeNull();
  });

  it("hydrates without mismatch when saved dark theme differs from server markup", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const serverMarkup = renderToString(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    window.localStorage.setItem("llm-wiki-theme", "dark");
    const hydrationContainer = document.createElement("div");
    hydrationContainer.innerHTML = serverMarkup;
    document.body.appendChild(hydrationContainer);
    container = hydrationContainer;

    await act(async () => {
      root = hydrateRoot(
        hydrationContainer,
        <ThemeProvider>
          <ThemeToggle />
        </ThemeProvider>,
      );
      await Promise.resolve();
    });

    expect(
      consoleError.mock.calls.some((call) =>
        call.some((entry) => String(entry).includes("Hydration failed")),
      ),
    ).toBe(false);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(requiredButton("浅色")).not.toBeNull();
  });
});

function renderTheme() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  act(() => {
    root?.render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
  });
}

function requiredButton(name: string) {
  const button = Array.from(container?.querySelectorAll("button") ?? []).find(
    (candidate) => candidate.textContent?.trim() === name,
  );

  if (!button) {
    throw new Error(`Expected button named ${name}.`);
  }

  return button;
}
