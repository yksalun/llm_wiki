export type WorkbenchSection =
  | "Overview"
  | "Files"
  | "Purpose"
  | "Schema"
  | "Project Info";

export type FileNodeType = "file" | "directory";
export type FileViewMode = "editable" | "preview" | "metadata" | "unsupported";
export type ProjectStatus = "ready" | "incomplete";

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
