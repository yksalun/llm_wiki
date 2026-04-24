import type { FileWriteRequest } from "@/lib/types";
import { AppError } from "@/lib/server/app-error";
import { getProjectRootsFromEnv } from "@/lib/server/env";
import { readProjectFile } from "@/lib/server/file-reader";
import { writeProjectFile } from "@/lib/server/file-writer";
import { resolveProjectById } from "@/lib/server/project-registry";
import { errorJson, okJson } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

interface ProjectRouteContext {
  params: Promise<{
    projectId: string;
  }>;
}

export async function GET(request: Request, context: ProjectRouteContext) {
  try {
    const roots = getProjectRootsFromEnv();
    const { projectId } = await context.params;
    const project = await resolveProjectById(roots, projectId);
    const relativePath = new URL(request.url).searchParams.get("path") ?? "";
    const file = await readProjectFile(project.rootDir, relativePath);

    return okJson(file);
  } catch (error) {
    return errorJson(error);
  }
}

export async function PUT(request: Request, context: ProjectRouteContext) {
  try {
    const roots = getProjectRootsFromEnv();
    const { projectId } = await context.params;
    const project = await resolveProjectById(roots, projectId);
    const payload = validateFileWriteRequest(await request.json());
    const result = await writeProjectFile(project.rootDir, payload);

    return okJson(result);
  } catch (error) {
    return errorJson(error);
  }
}

function validateFileWriteRequest(payload: unknown): FileWriteRequest {
  if (!payload || typeof payload !== "object") {
    throw new AppError("INVALID_REQUEST_BODY", 400, "Request body must be a JSON object.");
  }

  const candidate = payload as Partial<FileWriteRequest>;

  if (typeof candidate.relativePath !== "string") {
    throw new AppError("INVALID_REQUEST_BODY", 400, "relativePath must be a string.");
  }

  if (typeof candidate.content !== "string") {
    throw new AppError("INVALID_REQUEST_BODY", 400, "content must be a string.");
  }

  if (candidate.lastModified !== null && typeof candidate.lastModified !== "string") {
    throw new AppError("INVALID_REQUEST_BODY", 400, "lastModified must be a string or null.");
  }

  return {
    relativePath: candidate.relativePath,
    content: candidate.content,
    lastModified: candidate.lastModified,
  };
}
