import { describe, expect, it } from "vitest";

import {
  createHeavyTaskExecutionMetadata,
  getProjectRuntimeCapabilities,
} from "../heavy-task-runtime";

describe("heavy task runtime", () => {
  it("reports the current Node runtime capabilities without enabling a bridge", () => {
    expect(getProjectRuntimeCapabilities()).toEqual({
      activeEngine: "node",
      bridgeStatus: "not-configured",
      heavyTasks: [
        {
          task: "project-search",
          engine: "node",
          bridgeStatus: "not-configured",
        },
        {
          task: "project-insights",
          engine: "node",
          bridgeStatus: "not-configured",
        },
      ],
    });
  });

  it("returns a fresh heavy task list for each capabilities call", () => {
    const capabilities = getProjectRuntimeCapabilities();

    capabilities.heavyTasks.pop();

    expect(getProjectRuntimeCapabilities().heavyTasks).toHaveLength(2);
  });

  it("creates non-negative execution metadata for a tracked task", () => {
    expect(createHeavyTaskExecutionMetadata("project-search", 20, () => 45.5)).toEqual({
      task: "project-search",
      engine: "node",
      durationMs: 25.5,
    });
  });

  it("clamps clock drift to zero duration", () => {
    expect(createHeavyTaskExecutionMetadata("project-insights", 20, () => 10)).toEqual({
      task: "project-insights",
      engine: "node",
      durationMs: 0,
    });
  });
});
