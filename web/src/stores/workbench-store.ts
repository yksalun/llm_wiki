"use client";

import { create } from "zustand";
import { createStore } from "zustand/vanilla";

import type { FileReadResult, WorkbenchSection } from "@/lib/types";

export type SaveStatus = "idle" | "success" | "failed" | "conflict" | "refresh_failed";

export interface FileConflictState {
  relativePath: string;
  message: string;
  currentLastModified: string | null;
}

export interface WorkbenchStoreState {
  section: WorkbenchSection;
  selectedPath: string | null;
  file: FileReadResult | null;
  draft: string;
  dirty: boolean;
  saving: boolean;
  refreshing: boolean;
  lastSaveStatus: SaveStatus;
  lastSavedAt: string | null;
  conflict: FileConflictState | null;
  setSection: (section: WorkbenchSection) => void;
  setSelectedPath: (selectedPath: string | null) => void;
  openFile: (file: FileReadResult | null) => void;
  setDraft: (draft: string) => void;
  setSaving: (saving: boolean) => void;
  setRefreshing: (refreshing: boolean) => void;
  markSaveSuccess: (lastSavedAt: string) => void;
  markSaveFailed: () => void;
  markSaveConflict: (conflict: FileConflictState) => void;
  markRefreshFailed: (lastSavedAt: string) => void;
  clearSaveFeedback: () => void;
  clearFile: (preserveSelection?: boolean) => void;
  reset: () => void;
}

const clearSaveFeedbackState = {
  refreshing: false,
  lastSaveStatus: "idle" as SaveStatus,
  lastSavedAt: null,
  conflict: null,
};

const initialWorkbenchState = {
  section: "Overview" as WorkbenchSection,
  selectedPath: null,
  file: null,
  draft: "",
  dirty: false,
  saving: false,
  ...clearSaveFeedbackState,
};

function createWorkbenchState(
  set: (
    partial:
      | Partial<WorkbenchStoreState>
      | ((state: WorkbenchStoreState) => Partial<WorkbenchStoreState>),
  ) => void,
): WorkbenchStoreState {
  return {
    ...initialWorkbenchState,
    setSection: (section) => {
      set({ section });
    },
    setSelectedPath: (selectedPath) => {
      set({ selectedPath });
    },
    openFile: (file) => {
      set({
        file,
        selectedPath: file?.relativePath ?? null,
        draft: file?.content ?? "",
        dirty: false,
        saving: false,
        ...clearSaveFeedbackState,
      });
    },
    setDraft: (draft) => {
      set((state) => ({
        draft,
        dirty: draft !== (state.file?.content ?? ""),
      }));
    },
    setSaving: (saving) => {
      set({ saving });
    },
    setRefreshing: (refreshing) => {
      set({ refreshing });
    },
    markSaveSuccess: (lastSavedAt) => {
      set({
        saving: false,
        lastSaveStatus: "success",
        lastSavedAt,
        conflict: null,
      });
    },
    markSaveFailed: () => {
      set({
        saving: false,
        lastSaveStatus: "failed",
        conflict: null,
      });
    },
    markSaveConflict: (conflict) => {
      set({
        saving: false,
        lastSaveStatus: "conflict",
        conflict,
      });
    },
    markRefreshFailed: (lastSavedAt) => {
      set({
        saving: false,
        refreshing: false,
        lastSaveStatus: "refresh_failed",
        lastSavedAt,
        conflict: null,
      });
    },
    clearSaveFeedback: () => {
      set(clearSaveFeedbackState);
    },
    clearFile: (preserveSelection = false) => {
      set((state) => ({
        selectedPath: preserveSelection ? state.selectedPath : null,
        file: null,
        draft: "",
        dirty: false,
        saving: false,
        ...clearSaveFeedbackState,
      }));
    },
    reset: () => {
      set(initialWorkbenchState);
    },
  };
}

export function createWorkbenchStore() {
  return createStore<WorkbenchStoreState>()((set) => createWorkbenchState(set));
}

export const useWorkbenchStore = create<WorkbenchStoreState>()((set) =>
  createWorkbenchState(set),
);
