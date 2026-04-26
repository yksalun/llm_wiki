import { getProjectRootsFromEnv } from "@/lib/server/env";
import {
  createHeavyTaskExecutionMetadata,
  getHeavyTaskNowMs,
} from "@/lib/server/heavy-task-runtime";
import { resolveProjectById } from "@/lib/server/project-registry";
import { searchProjectFiles } from "@/lib/server/project-search";
import { errorJson, okJson } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

export async function GET(request: Request, context: ProjectRouteContext) {
  try {
    const roots = getProjectRootsFromEnv();
    const { projectId } = await context.params;
    const project = await resolveProjectById(roots, projectId);
    const query = new URL(request.url).searchParams.get("q") ?? "";
    const startedAtMs = getHeavyTaskNowMs();
    const response = await searchProjectFiles(project.rootDir, query);

    return okJson({
      ...response,
      execution: createHeavyTaskExecutionMetadata("project-search", startedAtMs),
    });
  } catch (error) {
    return errorJson(error);
  }
}
