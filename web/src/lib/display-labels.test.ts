import { describe, expect, it } from "vitest";

import {
  formatAccessModeLabel,
  formatFileModeLabel,
  formatHeavyTaskBridgeStatusLabel,
  formatHeavyTaskEngineLabel,
  formatHeavyTaskNameLabel,
  formatProjectStatusLabel,
  formatWorkbenchSectionLabel,
} from "./display-labels";

describe("display labels", () => {
  it("formats workbench section labels in Chinese", () => {
    expect(formatWorkbenchSectionLabel("Overview")).toBe("概览");
    expect(formatWorkbenchSectionLabel("Ask")).toBe("问答");
    expect(formatWorkbenchSectionLabel("Insights")).toBe("洞察");
    expect(formatWorkbenchSectionLabel("Files")).toBe("文件");
    expect(formatWorkbenchSectionLabel("Purpose")).toBe("目标");
    expect(formatWorkbenchSectionLabel("Schema")).toBe("结构");
    expect(formatWorkbenchSectionLabel("Project Info")).toBe("项目信息");
  });

  it("formats project status labels in Chinese", () => {
    expect(formatProjectStatusLabel("ready")).toBe("就绪");
    expect(formatProjectStatusLabel("incomplete")).toBe("不完整");
  });

  it("formats access mode labels in Chinese", () => {
    expect(formatAccessModeLabel("read-write")).toBe("可读写");
    expect(formatAccessModeLabel("read-only")).toBe("只读");
  });

  it("formats file mode labels in Chinese", () => {
    expect(formatFileModeLabel("editable")).toBe("可编辑");
    expect(formatFileModeLabel("preview")).toBe("预览");
    expect(formatFileModeLabel("metadata")).toBe("元数据");
    expect(formatFileModeLabel("unsupported")).toBe("不支持");
  });

  it("formats heavy task runtime labels in Chinese", () => {
    expect(formatHeavyTaskEngineLabel("node")).toBe("内置运行时");
    expect(formatHeavyTaskBridgeStatusLabel("not-configured")).toBe("未配置");
  });

  it("formats heavy task name labels in Chinese", () => {
    expect(formatHeavyTaskNameLabel("project-search")).toBe("项目搜索");
    expect(formatHeavyTaskNameLabel("project-insights")).toBe("项目洞察");
  });
});
