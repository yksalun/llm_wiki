"use client";

import type {
  FileReadResult,
  FileTreeNode,
  FileWriteRequest,
  FileWriteResult,
  ProjectDetail,
  ProjectsListResponse,
} from "@/lib/types";

interface ApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
  };
}

export class ClientApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ClientApiError";
    this.status = status;
    this.code = code;
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

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
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
      apiError?.error?.message ?? "Request failed.",
      response.status,
      apiError?.error?.code,
    );
  }

  if (payload === null) {
    throw new ClientApiError("Received an empty response from the server.", response.status);
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
    throw new ClientApiError("Received an invalid JSON response.", response.status);
  }
}
