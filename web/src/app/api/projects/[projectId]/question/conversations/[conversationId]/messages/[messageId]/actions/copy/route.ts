import {
  type MessageActionRouteContext,
  proxyMessageAction,
} from "../../../../../bridge-route-helpers";

export const runtime = "nodejs";

export async function POST(request: Request, context: MessageActionRouteContext) {
  return proxyMessageAction(request, context, "copy");
}
