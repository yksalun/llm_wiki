import {
  proxyMessageActionStream,
  type MessageActionRouteContext,
} from "../../../../../../bridge-route-helpers";

export const runtime = "nodejs";

export async function POST(request: Request, context: MessageActionRouteContext) {
  return proxyMessageActionStream(request, context, "regenerate");
}
