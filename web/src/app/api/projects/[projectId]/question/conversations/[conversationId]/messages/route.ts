import { fetchDesktopBridgeJson } from "@/lib/server/desktop-bridge-client";
import { errorJson, okJson } from "@/lib/server/route-helpers";

import {
  type ConversationRouteContext,
  encodeRouteSegment,
  resolveRouteProject,
} from "../../bridge-route-helpers";

export const runtime = "nodejs";

export async function GET(_request: Request, context: ConversationRouteContext) {
  try {
    const { projectId, conversationId } = await context.params;
    await resolveRouteProject(projectId);
    const response = await fetchDesktopBridgeJson(
      `/projects/${encodeRouteSegment(projectId)}/conversations/${encodeRouteSegment(
        conversationId,
      )}/messages`,
    );

    return okJson(response);
  } catch (error) {
    return errorJson(error);
  }
}
