"use client";

import { create } from "zustand";
import { createStore } from "zustand/vanilla";

import type { FileReadResult, WorkbenchSection } from "@/lib/types";

export interface WorkbenchStoreState {
  section: WorkbenchSection;
  selectedPath: string | null;
  file: FileReadResult | null;
  draft: string;
  dirty: boolean;
  saving: boolean;
  setSection: (section: WorkbenchSection) => void;
  setSelectedPath: (selectedPath: string | null) => void;
  openFile: (file: FileReadResult | null) => void;
  setDraft: (draft: string) => void;
  setSaving: (saving: boolean) => void;
  clearFile: (preserveSelection?: boolean) => void;
  reset: () => void;
}

const initialWorkbenchState = {
  section: "Overview" as WorkbenchSection,
  selectedPath: null,
  file: null,
  draft: "",
  dirty: false,
  saving: false,
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
    clearFile: (preserveSelection = false) => {
      set((state) => ({
        selectedPath: preserveSelection ? state.selectedPath : null,
        file: null,
        draft: "",
        dirty: false,
        saving: false,
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
