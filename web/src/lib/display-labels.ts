import type {
  FileViewMode,
  HeavyTaskBridgeStatus,
  HeavyTaskEngine,
  HeavyTaskName,
  ProjectInsightFinding,
  ProjectAccessMode,
  ProjectStatus,
  WorkbenchSection,
} from "./types";

const workbenchSectionLabels = {
  Overview: "概览",
  Ask: "问答",
  Insights: "洞察",
  Files: "文件",
  Purpose: "目标",
  Schema: "结构",
  "Project Info": "项目信息",
} satisfies Record<WorkbenchSection, string>;

const projectStatusLabels = {
  ready: "就绪",
  incomplete: "不完整",
} satisfies Record<ProjectStatus, string>;

const accessModeLabels = {
  "read-write": "可读写",
  "read-only": "只读",
} satisfies Record<ProjectAccessMode, string>;

const fileModeLabels = {
  editable: "可编辑",
  preview: "预览",
  metadata: "元数据",
  unsupported: "不支持",
} satisfies Record<FileViewMode, string>;

const heavyTaskEngineLabels = {
  node: "内置运行时",
} satisfies Record<HeavyTaskEngine, string>;

const heavyTaskBridgeStatusLabels = {
  "not-configured": "未配置",
} satisfies Record<HeavyTaskBridgeStatus, string>;

const heavyTaskNameLabels = {
  "project-search": "项目搜索",
  "project-insights": "项目洞察",
} satisfies Record<HeavyTaskName, string>;

const insightSeverityLabels = {
  info: "信息",
  warning: "警告",
  risk: "风险",
} satisfies Record<ProjectInsightFinding["severity"], string>;

export function formatWorkbenchSectionLabel(section: WorkbenchSection): string {
  return workbenchSectionLabels[section];
}

export function formatProjectStatusLabel(status: ProjectStatus): string {
  return projectStatusLabels[status];
}

export function formatAccessModeLabel(mode: ProjectAccessMode): string {
  return accessModeLabels[mode];
}

export function formatFileModeLabel(mode: FileViewMode): string {
  return fileModeLabels[mode];
}

export function formatHeavyTaskEngineLabel(engine: HeavyTaskEngine): string {
  return heavyTaskEngineLabels[engine];
}

export function formatHeavyTaskBridgeStatusLabel(
  status: HeavyTaskBridgeStatus,
): string {
  return heavyTaskBridgeStatusLabels[status];
}

export function formatHeavyTaskNameLabel(task: HeavyTaskName): string {
  return heavyTaskNameLabels[task];
}

export function formatInsightSeverityLabel(
  severity: ProjectInsightFinding["severity"],
): string {
  return insightSeverityLabels[severity];
}
