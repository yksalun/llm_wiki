import { getProjectRootsFromEnv } from "@/lib/server/env";
import { listLawSourceRecords } from "@/lib/server/law-db/repo";
import { syncLawSources } from "@/lib/server/law-source-sync";
import {
  getProjectAccessPolicyFromEnv,
  requireProjectWriteAccess,
} from "@/lib/server/project-access";
import { resolveProjectById } from "@/lib/server/project-registry";
import { errorJson, okJson } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

export async function POST(_request: Request, context: ProjectRouteContext) {
  try {
    const { projectId } = await context.params;
    const project = await resolveProjectById(getProjectRootsFromEnv(), projectId);
    const policy = getProjectAccessPolicyFromEnv();

    requireProjectWriteAccess(policy);

    const records = await listLawSourceRecords();
    const response = await syncLawSources(project.rootDir, records);

    return okJson(response);
  } catch (error) {
    return errorJson(error);
  }
}
