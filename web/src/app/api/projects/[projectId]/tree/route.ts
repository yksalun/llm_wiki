import { getProjectRootsFromEnv } from "@/lib/server/env";
import { resolveProjectById } from "@/lib/server/project-registry";
import { listProjectTree } from "@/lib/server/project-tree";
import { errorJson, okJson } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

interface ProjectRouteContext {
  params: Promise<{
    projectId: string;
  }>;
}

export async function GET(_request: Request, context: ProjectRouteContext) {
  try {
    const roots = getProjectRootsFromEnv();
    const { projectId } = await context.params;
    const project = await resolveProjectById(roots, projectId);
    const tree = await listProjectTree(project.rootDir);

    return okJson(tree);
  } catch (error) {
    return errorJson(error);
  }
}
