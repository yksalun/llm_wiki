import { fetchDesktopBridgeJson } from "@/lib/server/desktop-bridge-client";
import { errorJson, okJson } from "@/lib/server/route-helpers";
import type { DesktopBridgeMessageActionResponse } from "@/lib/types";

import {
  buildMessageActionBridgePath,
  type MessageActionRouteContext,
  parseJsonRequestBody,
  requireMessageActionPayload,
  resolveRouteProject,
} from "../../../../../bridge-route-helpers";

export const runtime = "nodejs";

export async function POST(request: Request, context: MessageActionRouteContext) {
  try {
    const { projectId, conversationId, messageId } = await context.params;
    const project = await resolveRouteProject(projectId);
    const payload = requireMessageActionPayload(await parseJsonRequestBody(request));
    const response = await fetchDesktopBridgeJson<DesktopBridgeMessageActionResponse>(
      buildMessageActionBridgePath({ projectId, conversationId, messageId, action: "save-to-wiki" }),
      {
        method: "POST",
        body: JSON.stringify({
          projectPath: project.rootDir,
          ...payload,
        }),
        signal: request.signal,
      },
    );

    return okJson(response);
  } catch (error) {
    return errorJson(error);
  }
}
