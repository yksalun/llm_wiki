import { AppError } from "./app-error";

export const DEFAULT_DESKTOP_BRIDGE_URL = "http://127.0.0.1:19828";

type DesktopBridgeEnv = Record<string, string | undefined>;

export class DesktopBridgeUnavailableError extends AppError {
  constructor(cause?: unknown) {
    super("DESKTOP_BRIDGE_UNAVAILABLE", 503, "桌面端 Bridge 暂不可用，请确认桌面应用已启动。", {
      cause,
    });
    this.name = "DesktopBridgeUnavailableError";
  }
}

export function getDesktopBridgeBaseUrl(env: DesktopBridgeEnv = process.env): string {
  const override = env.LLM_WIKI_DESKTOP_BRIDGE_URL?.trim();
  return override ? override.replace(/\/+$/, "") : DEFAULT_DESKTOP_BRIDGE_URL;
}

export async function fetchDesktopBridgeJson<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetchDesktopBridge(path, init, "application/json", Boolean(init.body));

  if (!response.ok) {
    throw await createBridgeError(response);
  }

  return (await response.json()) as T;
}

export async function fetchDesktopBridgeStream(
  path: string,
  init: RequestInit,
): Promise<Response> {
  const response = await fetchDesktopBridge(path, init, "text/event-stream", true);

  if (!response.ok) {
    throw await createBridgeError(response);
  }

  return response;
}

async function fetchDesktopBridge(
  path: string,
  init: RequestInit,
  accept: string,
  includeJsonContentType: boolean,
): Promise<Response> {
  try {
    return await fetch(buildDesktopBridgeUrl(path), {
      ...init,
      headers: buildHeaders(init.headers, accept, includeJsonContentType),
    });
  } catch (error) {
    throw new DesktopBridgeUnavailableError(error);
  }
}

function buildDesktopBridgeUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${getDesktopBridgeBaseUrl()}${normalizedPath}`;
}

function buildHeaders(
  headers: HeadersInit | undefined,
  accept: string,
  includeJsonContentType: boolean,
): Headers {
  const result = new Headers(headers);
  result.set("Accept", accept);

  if (includeJsonContentType && !result.has("Content-Type")) {
    result.set("Content-Type", "application/json");
  }

  return result;
}

async function createBridgeError(response: Response): Promise<AppError> {
  const bridgeBody = (await response.text()).slice(0, 500);
  return new AppError("DESKTOP_BRIDGE_ERROR", response.status, "桌面端 Bridge 请求失败。", {
    publicDetails: {
      bridgeStatus: response.status,
      bridgeBody,
    },
  });
}
