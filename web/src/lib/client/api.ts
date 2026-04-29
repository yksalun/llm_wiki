"use client";

import type {
  FileReadResult,
  FileTreeNode,
  FileWriteRequest,
  FileWriteResult,
  LawDatabaseSyncResponse,
  ProjectDetail,
  ProjectInsightsResponse,
  ProjectSearchResponse,
  ProjectsListResponse,
} from "@/lib/types";

interface ApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, string | number | boolean | null>;
  };
}

export class ClientApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: Record<string, string | number | boolean | null>;

  constructor(
    message: string,
    status: number,
    code?: string,
    details?: Record<string, string | number | boolean | null>,
  ) {
    super(message);
    this.name = "ClientApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function fetchProjects(signal?: AbortSignal) {
  return requestJson<ProjectsListResponse>("/api/projects", {
    method: "GET",
    cache: "no-store",
    signal,
  });
}

export async function fetchProjectDetail(projectId: string, signal?: AbortSignal) {
  return requestJson<ProjectDetail>(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: "GET",
    cache: "no-store",
    signal,
  });
}

export async function fetchProjectTree(projectId: string, signal?: AbortSignal) {
  return requestJson<FileTreeNode[]>(`/api/projects/${encodeURIComponent(projectId)}/tree`, {
    method: "GET",
    cache: "no-store",
    signal,
  });
}

export async function fetchProjectFile(
  projectId: string,
  relativePath: string,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ path: relativePath });

  return requestJson<FileReadResult>(
    `/api/projects/${encodeURIComponent(projectId)}/file?${params.toString()}`,
    {
      method: "GET",
      cache: "no-store",
      signal,
    },
  );
}

export async function searchProject(projectId: string, query: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ q: query });

  return requestJson<ProjectSearchResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/search?${params.toString()}`,
    { method: "GET", cache: "no-store", signal },
  );
}

export async function fetchProjectInsights(projectId: string, signal?: AbortSignal) {
  return requestJson<ProjectInsightsResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/insights`,
    { method: "GET", cache: "no-store", signal },
  );
}

export async function saveProjectFile(
  projectId: string,
  payload: FileWriteRequest,
  signal?: AbortSignal,
) {
  return requestJson<FileWriteResult>(`/api/projects/${encodeURIComponent(projectId)}/file`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal,
  });
}

export async function syncLawDatabaseSources(
  projectId: string,
  signal?: AbortSignal,
): Promise<LawDatabaseSyncResponse> {
  return requestJson<LawDatabaseSyncResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/sources/law-db/sync`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      signal,
    },
  );
}

export async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      Accept: "application/json",
      ...init?.headers,
    },
  });

  const payload = await parseJsonPayload<T | ApiErrorPayload>(response);

  if (!response.ok) {
    const apiError = payload as ApiErrorPayload | null;
    throw new ClientApiError(
      apiError?.error?.message ?? "请求失败。",
      response.status,
      apiError?.error?.code,
      apiError?.error?.details,
    );
  }

  if (payload === null) {
    throw new ClientApiError("服务器返回了空响应。", response.status);
  }

  return payload as T;
}

async function parseJsonPayload<T>(response: Response): Promise<T | null> {
  const body = await response.text();

  if (body.length === 0) {
    return null;
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new ClientApiError("服务器返回的数据格式无效。", response.status);
  }
}
