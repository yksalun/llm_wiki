import { getProjectRootsFromEnv } from "@/lib/server/env";
import {
  createHeavyTaskExecutionMetadata,
  getHeavyTaskNowMs,
} from "@/lib/server/heavy-task-runtime";
import { buildProjectInsights } from "@/lib/server/project-insights";
import { resolveProjectById } from "@/lib/server/project-registry";
import { errorJson, okJson } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

export async function GET(_request: Request, context: ProjectRouteContext) {
  try {
    const roots = getProjectRootsFromEnv();
    const { projectId } = await context.params;
    const project = await resolveProjectById(roots, projectId);
    const startedAtMs = getHeavyTaskNowMs();
    const response = await buildProjectInsights(project.rootDir);

    return okJson({
      ...response,
      execution: createHeavyTaskExecutionMetadata("project-insights", startedAtMs),
    });
  } catch (error) {
    return errorJson(error);
  }
}
