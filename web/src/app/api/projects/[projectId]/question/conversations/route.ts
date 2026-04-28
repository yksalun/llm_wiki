import { fetchDesktopBridgeJson } from "@/lib/server/desktop-bridge-client";
import { errorJson, okJson } from "@/lib/server/route-helpers";

import {
  encodeRouteSegment,
  type ProjectRouteContext,
  resolveRouteProject,
} from "./bridge-route-helpers";

export const runtime = "nodejs";

export async function GET(_request: Request, context: ProjectRouteContext) {
  try {
    const { projectId } = await context.params;
    await resolveRouteProject(projectId);
    const response = await fetchDesktopBridgeJson(
      `/projects/${encodeRouteSegment(projectId)}/conversations`,
    );

    return okJson(response);
  } catch (error) {
    return errorJson(error);
  }
}

export async function POST(_request: Request, context: ProjectRouteContext) {
  try {
    const { projectId } = await context.params;
    await resolveRouteProject(projectId);
    const response = await fetchDesktopBridgeJson(
      `/projects/${encodeRouteSegment(projectId)}/conversations`,
      { method: "POST" },
    );

    return okJson(response);
  } catch (error) {
    return errorJson(error);
  }
}
