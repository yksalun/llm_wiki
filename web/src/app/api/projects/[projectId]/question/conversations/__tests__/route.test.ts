import { beforeEach, describe, expect, it, vi } from "vitest";

const bridgeMocks = vi.hoisted(() => ({
  fetchDesktopBridgeJson: vi.fn(),
  fetchDesktopBridgeStream: vi.fn(),
}));

const projectMocks = vi.hoisted(() => ({
  getProjectRootsFromEnv: vi.fn(),
  resolveProjectById: vi.fn(),
}));

vi.mock("@/lib/server/desktop-bridge-client", () => ({
  fetchDesktopBridgeJson: bridgeMocks.fetchDesktopBridgeJson,
  fetchDesktopBridgeStream: bridgeMocks.fetchDesktopBridgeStream,
}));

vi.mock("@/lib/server/env", () => ({
  getProjectRootsFromEnv: projectMocks.getProjectRootsFromEnv,
}));

vi.mock("@/lib/server/project-registry", () => ({
  resolveProjectById: projectMocks.resolveProjectById,
}));

const roots = ["F:/projects"];
const project = {
  id: "project_1",
  name: "Project 1",
  rootDir: "F:/project",
};

beforeEach(() => {
  vi.resetModules();
  bridgeMocks.fetchDesktopBridgeJson.mockReset();
  bridgeMocks.fetchDesktopBridgeStream.mockReset();
  projectMocks.getProjectRootsFromEnv.mockReset();
  projectMocks.resolveProjectById.mockReset();
  projectMocks.getProjectRootsFromEnv.mockReturnValue(roots);
  projectMocks.resolveProjectById.mockResolvedValue(project);
});

describe("/api/projects/[projectId]/question/conversations routes", () => {
  it("GET conversations proxies to the desktop bridge", async () => {
    bridgeMocks.fetchDesktopBridgeJson.mockResolvedValue({ conversations: [{ id: "conv_1" }] });

    const { GET, runtime } = await import("../route");
    const response = await GET(new Request("http://localhost/api"), {
      params: Promise.resolve({ projectId: "project_1" }),
    });

    expect(runtime).toBe("nodejs");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ conversations: [{ id: "conv_1" }] });
    expect(projectMocks.resolveProjectById).toHaveBeenCalledWith(roots, "project_1");
    expect(bridgeMocks.fetchDesktopBridgeJson).toHaveBeenCalledWith(
      "/projects/project_1/conversations",
    );
  });

  it("POST conversations proxies creation to the desktop bridge", async () => {
    bridgeMocks.fetchDesktopBridgeJson.mockResolvedValue({ id: "conv_1" });

    const { POST } = await import("../route");
    const response = await POST(new Request("http://localhost/api", { method: "POST" }), {
      params: Promise.resolve({ projectId: "project_1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: "conv_1" });
    expect(bridgeMocks.fetchDesktopBridgeJson).toHaveBeenCalledWith(
      "/projects/project_1/conversations",
      { method: "POST" },
    );
  });

  it("GET messages proxies to the desktop bridge", async () => {
    bridgeMocks.fetchDesktopBridgeJson.mockResolvedValue({ messages: [{ id: "msg_1" }] });

    const { GET } = await import("../[conversationId]/messages/route");
    const response = await GET(new Request("http://localhost/api"), {
      params: Promise.resolve({ projectId: "project_1", conversationId: "conv_1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ messages: [{ id: "msg_1" }] });
    expect(bridgeMocks.fetchDesktopBridgeJson).toHaveBeenCalledWith(
      "/projects/project_1/conversations/conv_1/messages",
    );
  });

  it("POST stream forwards the trimmed message and returns an SSE response", async () => {
    const controller = new AbortController();
    const request = new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ message: "  Hello bridge  " }),
      signal: controller.signal,
    });
    bridgeMocks.fetchDesktopBridgeStream.mockResolvedValue(
      new Response("data: ok\n\n", {
        headers: { "content-type": "text/event-stream" },
      }),
    );

    const { POST } = await import("../[conversationId]/messages/stream/route");
    const response = await POST(
      request,
      {
        params: Promise.resolve({ projectId: "project_1", conversationId: "conv_1" }),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(response.headers.get("connection")).toBe("keep-alive");
    await expect(response.text()).resolves.toBe("data: ok\n\n");
    expect(bridgeMocks.fetchDesktopBridgeStream).toHaveBeenCalledWith(
      "/projects/project_1/conversations/conv_1/messages/stream",
      {
        method: "POST",
        body: JSON.stringify({
          projectPath: "F:/project",
          message: "Hello bridge",
        }),
        signal: request.signal,
      },
    );
  });

  it("POST copy action proxies message identity and payload to the desktop bridge", async () => {
    const controller = new AbortController();
    const request = new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({
        content: "answer body",
        references: [{ title: "schema.md", path: "wiki/schema.md" }],
      }),
      signal: controller.signal,
    });
    bridgeMocks.fetchDesktopBridgeJson.mockResolvedValue({ ok: true });

    const { POST } = await import("../[conversationId]/messages/[messageId]/actions/copy/route");
    const response = await POST(
      request,
      {
        params: Promise.resolve({
          projectId: "project_1",
          conversationId: "conv_1",
          messageId: "msg_1",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(bridgeMocks.fetchDesktopBridgeJson).toHaveBeenCalledWith(
      "/projects/project_1/conversations/conv_1/messages/msg_1/actions/copy",
      {
        method: "POST",
        body: JSON.stringify({
          projectPath: "F:/project",
          content: "answer body",
          references: [{ title: "schema.md", path: "wiki/schema.md" }],
        }),
        signal: request.signal,
      },
    );
  });

  it("POST save-to-wiki action proxies to the desktop bridge", async () => {
    const request = new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ content: "answer body", references: [] }),
    });
    bridgeMocks.fetchDesktopBridgeJson.mockResolvedValue({ ok: true, savedPath: "wiki/queries/a.md" });

    const { POST } = await import(
      "../[conversationId]/messages/[messageId]/actions/save-to-wiki/route"
    );
    const response = await POST(
      request,
      {
        params: Promise.resolve({
          projectId: "project_1",
          conversationId: "conv_1",
          messageId: "msg_1",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, savedPath: "wiki/queries/a.md" });
    expect(bridgeMocks.fetchDesktopBridgeJson).toHaveBeenCalledWith(
      "/projects/project_1/conversations/conv_1/messages/msg_1/actions/save-to-wiki",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("POST regenerate action proxies to the desktop bridge", async () => {
    const request = new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ content: "old answer", references: [] }),
    });
    bridgeMocks.fetchDesktopBridgeJson.mockResolvedValue({
      messages: [{ id: "msg-new", role: "assistant", content: "new answer" }],
    });

    const { POST } = await import(
      "../[conversationId]/messages/[messageId]/actions/regenerate/route"
    );
    const response = await POST(
      request,
      {
        params: Promise.resolve({
          projectId: "project_1",
          conversationId: "conv_1",
          messageId: "msg_old",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      messages: [{ id: "msg-new", role: "assistant", content: "new answer" }],
    });
    expect(bridgeMocks.fetchDesktopBridgeJson).toHaveBeenCalledWith(
      "/projects/project_1/conversations/conv_1/messages/msg_old/actions/regenerate",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it.each([
    ["malformed JSON", "{"],
    ["empty message", JSON.stringify({ message: "   " })],
    ["non-object body", JSON.stringify(null)],
  ])("POST stream returns 400 for %s", async (_name, body) => {
    const { POST } = await import("../[conversationId]/messages/stream/route");
    const response = await POST(
      new Request("http://localhost/api", {
        method: "POST",
        body,
      }),
      {
        params: Promise.resolve({ projectId: "project_1", conversationId: "conv_1" }),
      },
    );
    const payload = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("INVALID_REQUEST_BODY");
    expect(bridgeMocks.fetchDesktopBridgeStream).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown project without calling the bridge", async () => {
    const { AppError } = await import("@/lib/server/app-error");

    projectMocks.resolveProjectById.mockRejectedValue(
      new AppError("PROJECT_NOT_FOUND", 404, "Project not found."),
    );

    const { GET } = await import("../route");
    const response = await GET(new Request("http://localhost/api"), {
      params: Promise.resolve({ projectId: "missing" }),
    });
    const payload = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(404);
    expect(payload.error.code).toBe("PROJECT_NOT_FOUND");
    expect(bridgeMocks.fetchDesktopBridgeJson).not.toHaveBeenCalled();
    expect(bridgeMocks.fetchDesktopBridgeStream).not.toHaveBeenCalled();
  });

  it("returns the bridge AppError status", async () => {
    const { AppError } = await import("@/lib/server/app-error");

    bridgeMocks.fetchDesktopBridgeJson.mockRejectedValue(
      new AppError("DESKTOP_BRIDGE_UNAVAILABLE", 503, "Bridge unavailable."),
    );

    const { GET } = await import("../route");
    const response = await GET(new Request("http://localhost/api"), {
      params: Promise.resolve({ projectId: "project_1" }),
    });
    const payload = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(503);
    expect(payload.error.code).toBe("DESKTOP_BRIDGE_UNAVAILABLE");
  });
});
