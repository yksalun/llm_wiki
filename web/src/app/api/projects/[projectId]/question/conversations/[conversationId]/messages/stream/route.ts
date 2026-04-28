import { fetchDesktopBridgeStream } from "@/lib/server/desktop-bridge-client";
import { errorJson } from "@/lib/server/route-helpers";

import {
  type ConversationRouteContext,
  encodeRouteSegment,
  parseJsonRequestBody,
  requireMessage,
  resolveRouteProject,
} from "../../../bridge-route-helpers";

export const runtime = "nodejs";

export async function POST(request: Request, context: ConversationRouteContext) {
  try {
    const { projectId, conversationId } = await context.params;
    const project = await resolveRouteProject(projectId);
    const message = requireMessage(await parseJsonRequestBody(request));
    const bridgeResponse = await fetchDesktopBridgeStream(
      `/projects/${encodeRouteSegment(projectId)}/conversations/${encodeRouteSegment(
        conversationId,
      )}/messages/stream`,
      {
        method: "POST",
        body: JSON.stringify({
          projectPath: project.rootDir,
          message,
        }),
      },
    );

    return new Response(bridgeResponse.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return errorJson(error);
  }
}
