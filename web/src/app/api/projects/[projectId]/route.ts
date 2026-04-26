import { getProjectRootsFromEnv } from "@/lib/server/env";
import { getProjectRuntimeCapabilities } from "@/lib/server/heavy-task-runtime";
import { getProjectAccessPolicyFromEnv } from "@/lib/server/project-access";
import { resolveProjectById } from "@/lib/server/project-registry";
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
    const access = getProjectAccessPolicyFromEnv();

    return okJson({
      id: project.id,
      name: project.name,
      access,
      runtime: getProjectRuntimeCapabilities(),
      status: project.status,
      hasPurpose: project.hasPurpose,
      hasSchema: project.hasSchema,
      hasWikiDirectory: project.hasWikiDirectory,
      hasRawSourcesDirectory: project.hasRawSourcesDirectory,
      updatedAt: project.updatedAt,
      sections: project.sections,
      rootPathHint: null,
    });
  } catch (error) {
    return errorJson(error);
  }
}
