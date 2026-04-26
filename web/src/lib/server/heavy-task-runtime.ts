import type {
  HeavyTaskExecutionMetadata,
  HeavyTaskName,
  ProjectRuntimeCapabilities,
} from "@/lib/types";

const NODE_RUNTIME_CAPABILITIES: ProjectRuntimeCapabilities = {
  activeEngine: "node",
  bridgeStatus: "not-configured",
  heavyTasks: [
    { task: "project-search", engine: "node", bridgeStatus: "not-configured" },
    { task: "project-insights", engine: "node", bridgeStatus: "not-configured" },
  ],
};

export function getProjectRuntimeCapabilities(): ProjectRuntimeCapabilities {
  return {
    ...NODE_RUNTIME_CAPABILITIES,
    heavyTasks: NODE_RUNTIME_CAPABILITIES.heavyTasks.map((task) => ({ ...task })),
  };
}

export function getHeavyTaskNowMs(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

export function createHeavyTaskExecutionMetadata(
  task: HeavyTaskName,
  startedAtMs: number,
  now: () => number = getHeavyTaskNowMs,
): HeavyTaskExecutionMetadata {
  return {
    task,
    engine: "node",
    durationMs: Math.max(0, now() - startedAtMs),
  };
}
