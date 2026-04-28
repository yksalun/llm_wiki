import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../app-error";
import {
  DEFAULT_DESKTOP_BRIDGE_URL,
  DesktopBridgeUnavailableError,
  fetchDesktopBridgeJson,
  fetchDesktopBridgeStream,
  getDesktopBridgeBaseUrl,
} from "../desktop-bridge-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getDesktopBridgeBaseUrl", () => {
  it("returns the default bridge URL when no override is set", () => {
    expect(getDesktopBridgeBaseUrl({})).toBe(DEFAULT_DESKTOP_BRIDGE_URL);
  });

  it("trims an env override and removes trailing slashes", () => {
    expect(
      getDesktopBridgeBaseUrl({
        LLM_WIKI_DESKTOP_BRIDGE_URL: "  http://127.0.0.1:20000///  ",
      }),
    ).toBe("http://127.0.0.1:20000");
  });
});

describe("fetchDesktopBridgeJson", () => {
  it("returns parsed JSON from a successful bridge response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchDesktopBridgeJson("/health")).resolves.toEqual({ ok: true });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:19828/health");
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Accept")).toBe(
      "application/json",
    );
  });

  it("wraps fetch connection failures as DesktopBridgeUnavailableError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("ECONNREFUSED")));

    await expect(fetchDesktopBridgeJson("/health")).rejects.toThrow(
      DesktopBridgeUnavailableError,
    );
  });

  it("throws AppError with bridge status and body details for non-2xx responses", async () => {
    const bridgeBody = "x".repeat(600);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(bridgeBody, { status: 502 })),
    );

    await expect(fetchDesktopBridgeJson("/ask")).rejects.toThrow(
      expect.objectContaining({
        code: "DESKTOP_BRIDGE_ERROR",
        status: 502,
        publicDetails: {
          bridgeStatus: 502,
          bridgeBody: "x".repeat(500),
        },
      }) as AppError,
    );
  });

  it("builds bridge URLs for paths without a leading slash", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchDesktopBridgeJson("api/conversations");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:19828/api/conversations",
      expect.any(Object),
    );
  });
});

describe("fetchDesktopBridgeStream", () => {
  it("returns the stream response and requests text/event-stream", async () => {
    const response = new Response("data: {}\n\n", { status: 200 });
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchDesktopBridgeStream("/ask/stream", {
        method: "POST",
        body: JSON.stringify({ question: "Q" }),
      }),
    ).resolves.toBe(response);

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:19828/ask/stream");
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("Accept")).toBe("text/event-stream");
    expect(headers.get("Content-Type")).toBe("application/json");
  });
});
