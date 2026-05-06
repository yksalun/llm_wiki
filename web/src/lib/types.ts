export type WorkbenchSection =
  | "Overview"
  | "Ask"
  | "Insights"
  | "Files"
  | "Purpose"
  | "Schema"
  | "Project Info";

export type FileNodeType = "file" | "directory";
export type FileViewMode = "editable" | "preview" | "metadata" | "unsupported";
export type ProjectAccessMode = "read-write" | "read-only";
export type ProjectStatus = "ready" | "incomplete";
export type HeavyTaskEngine = "node";
export type HeavyTaskBridgeStatus = "not-configured";
export type HeavyTaskName = "project-search" | "project-insights";

export interface HeavyTaskCapability {
  task: HeavyTaskName;
  engine: HeavyTaskEngine;
  bridgeStatus: HeavyTaskBridgeStatus;
}

export interface ProjectRuntimeCapabilities {
  activeEngine: HeavyTaskEngine;
  bridgeStatus: HeavyTaskBridgeStatus;
  heavyTasks: HeavyTaskCapability[];
}

export interface HeavyTaskExecutionMetadata {
  task: HeavyTaskName;
  engine: HeavyTaskEngine;
  durationMs: number;
}

export interface ProjectAccessPolicy {
  mode: ProjectAccessMode;
  canRead: true;
  canWrite: boolean;
}

export interface ProjectSummary {
  id: string;
  name: string;
  status: ProjectStatus;
  hasPurpose: boolean;
  hasSchema: boolean;
  hasWikiDirectory: boolean;
  hasRawSourcesDirectory: boolean;
  updatedAt: string | null;
}

export interface ProjectsListResponse {
  projects: ProjectSummary[];
  warnings: string[];
}

export interface ProjectDetail extends ProjectSummary {
  sections: WorkbenchSection[];
  rootPathHint: string | null;
  access: ProjectAccessPolicy;
  runtime: ProjectRuntimeCapabilities;
}

export interface ProjectSearchResult {
  relativePath: string;
  lineNumber: number;
  lineText: string;
  preview: string;
  matchStart: number;
  matchEnd: number;
}

export interface ProjectSearchResponse {
  query: string;
  results: ProjectSearchResult[];
  summary: {
    scannedFiles: number;
    skippedFiles: number;
    matchedFiles: number;
    totalMatches: number;
    truncated: boolean;
  };
  execution?: HeavyTaskExecutionMetadata;
}

export interface DesktopBridgeReference {
  title: string;
  path: string;
}

export interface DesktopBridgeConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface DesktopBridgeMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  conversationId: string;
  references?: DesktopBridgeReference[];
}

export interface DesktopBridgeMessageActionPayload {
  content: string;
  references: DesktopBridgeReference[];
}

export interface DesktopBridgeMessageActionResponse {
  ok?: boolean;
  message?: DesktopBridgeMessage;
  messages?: DesktopBridgeMessage[];
  savedPath?: string;
}

export type DesktopBridgeStreamEvent =
  | { type: "token"; text: string }
  | { type: "references"; references: DesktopBridgeReference[] }
  | { type: "done"; message: DesktopBridgeMessage }
  | { type: "error"; code: string; message: string };

export interface ProjectInsightNode {
  id: string;
  label: string;
  kind: "file";
  relativePath: string;
}

export interface ProjectInsightEdge {
  id: string;
  sourceId: string;
  targetId: string;
  kind: "links-to";
  label: string;
  sourceLineNumber: number;
}

export interface ProjectInsightFinding {
  id: string;
  severity: "info" | "warning" | "risk";
  title: string;
  message: string;
  relativePath?: string;
  lineNumber?: number;
}

export interface ProjectInsightResearchPrompt {
  id: string;
  title: string;
  question: string;
  reason: string;
  sourceIds: string[];
}

export interface ProjectInsightsResponse {
  summary: {
    analyzedFiles: number;
    markdownFiles: number;
    graphNodes: number;
    graphEdges: number;
    findings: number;
    researchPrompts: number;
  };
  graph: {
    nodes: ProjectInsightNode[];
    edges: ProjectInsightEdge[];
  };
  findings: ProjectInsightFinding[];
  researchPrompts: ProjectInsightResearchPrompt[];
  execution?: HeavyTaskExecutionMetadata;
}

export interface FileTreeNode {
  name: string;
  relativePath: string;
  nodeType: FileNodeType;
  children?: FileTreeNode[];
}

export interface FileReadResult {
  relativePath: string;
  mode: FileViewMode;
  content: string | null;
  editable: boolean;
  size: number;
  lastModified: string | null;
  metadata: Record<string, string | number | boolean | null>;
}

export interface FileWriteRequest {
  relativePath: string;
  content: string;
  lastModified: string | null;
}

export interface FileWriteResult {
  relativePath: string;
  lastModified: string;
}
