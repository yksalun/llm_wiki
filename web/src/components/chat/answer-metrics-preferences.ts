"use client";

import { useCallback, useSyncExternalStore } from "react";

export const ANSWER_METRICS_PREFERENCES_KEY = "llm-wiki-web.preferences.v1";
export const ANSWER_METRICS_PREFERENCES_EVENT = "llm-wiki-web.preferences-change";

export interface AnswerMetricsPreferences {
  showAnswerMetrics: boolean;
}

const DEFAULT_PREFERENCES: AnswerMetricsPreferences = {
  showAnswerMetrics: true,
};

let cachedRawPreferences: string | null | undefined;
let cachedPreferences = DEFAULT_PREFERENCES;

export function loadAnswerMetricsPreferences(
  storage: Storage | undefined = getLocalStorage(),
): AnswerMetricsPreferences {
  if (!storage) {
    return DEFAULT_PREFERENCES;
  }

  try {
    const raw = storage.getItem(ANSWER_METRICS_PREFERENCES_KEY);

    if (raw === cachedRawPreferences) {
      return cachedPreferences;
    }

    cachedRawPreferences = raw;

    if (!raw) {
      cachedPreferences = DEFAULT_PREFERENCES;
      return DEFAULT_PREFERENCES;
    }

    cachedPreferences = normalizePreferences(JSON.parse(raw));
    return cachedPreferences;
  } catch {
    cachedPreferences = DEFAULT_PREFERENCES;
    return DEFAULT_PREFERENCES;
  }
}

export function saveAnswerMetricsPreferences(
  preferences: AnswerMetricsPreferences,
  storage: Storage | undefined = getLocalStorage(),
) {
  if (!storage) {
    return;
  }

  const normalized = normalizePreferences(preferences);
  const serialized = JSON.stringify(normalized);

  try {
    storage.setItem(ANSWER_METRICS_PREFERENCES_KEY, serialized);
  } catch {
    return;
  }

  cachedRawPreferences = serialized;
  cachedPreferences = normalized;

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(ANSWER_METRICS_PREFERENCES_EVENT));
  }
}

export function useAnswerMetricsPreferences() {
  const preferences = useSyncExternalStore(
    subscribePreferences,
    () => loadAnswerMetricsPreferences(),
    () => DEFAULT_PREFERENCES,
  );

  const setShowAnswerMetrics = useCallback((showAnswerMetrics: boolean) => {
    saveAnswerMetricsPreferences({
      ...loadAnswerMetricsPreferences(),
      showAnswerMetrics,
    });
  }, []);

  return { preferences, setShowAnswerMetrics };
}

function subscribePreferences(listener: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  window.addEventListener("storage", listener);
  window.addEventListener(ANSWER_METRICS_PREFERENCES_EVENT, listener);

  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(ANSWER_METRICS_PREFERENCES_EVENT, listener);
  };
}

function normalizePreferences(value: unknown): AnswerMetricsPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_PREFERENCES;
  }

  const candidate = value as Partial<AnswerMetricsPreferences>;

  return {
    showAnswerMetrics: candidate.showAnswerMetrics !== false,
  };
}

function getLocalStorage() {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.localStorage;
}
