import fs from "node:fs/promises";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createFixtureProject } from "@/test-utils/project-fixture";

const repoMocks = vi.hoisted(() => ({
  upsertProjectSnapshot: vi.fn(async () => {}),
  insertSyncRun: vi.fn(async () => {}),
  findProjectSnapshotById: vi.fn(async () => null),
  findProjectSnapshotByRootPath: vi.fn(async () => null),
}));

vi.mock("@/lib/db/project-snapshot-repo", () => ({
  upsertProjectSnapshot: repoMocks.upsertProjectSnapshot,
  insertSyncRun: repoMocks.insertSyncRun,
  findProjectSnapshotById: repoMocks.findProjectSnapshotById,
  findProjectSnapshotByRootPath: repoMocks.findProjectSnapshotByRootPath,
}));

const cleanupTasks: Array<() => Promise<void>> = [];

beforeEach(() => {
  repoMocks.upsertProjectSnapshot.mockClear();
  repoMocks.insertSyncRun.mockClear();
  repoMocks.findProjectSnapshotById.mockClear();
  repoMocks.findProjectSnapshotByRootPath.mockClear();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();

  while (cleanupTasks.length > 0) {
    const cleanup = cleanupTasks.pop();

    if (cleanup) {
      await cleanup();
    }
  }
});

async function createProjectContext(projectName: string) {
  const fixture = await createFixtureProject(projectName);
  cleanupTasks.push(fixture.cleanup);

  vi.stubEnv("LLM_WIKI_PROJECT_ROOTS", path.dirname(fixture.rootDir));

  const { GET: listProjects } = await import("../../../route");
  const response = await listProjects();
  const payload = (await response.json()) as {
    projects: Array<{ id: string }>;
  };
  const projectId = payload.projects[0]?.id;

  expect(projectId).toBeTruthy();

  return { fixture, projectId: projectId! };
}

describe("/api/projects/[projectId]/question route", () => {
  describe.sequential("env isolation", () => {
    const preservedApiKey = "preserved-route-test-key";
    let originalApiKey: string | undefined;

    beforeAll(() => {
      originalApiKey = process.env.LLM_WIKI_OPENAI_API_KEY;
      process.env.LLM_WIKI_OPENAI_API_KEY = preservedApiKey;
    });

    afterAll(() => {
      if (originalApiKey === undefined) {
        delete process.env.LLM_WIKI_OPENAI_API_KEY;
        return;
      }

      process.env.LLM_WIKI_OPENAI_API_KEY = originalApiKey;
    });

    it("stubs provider env for one test", () => {
      vi.stubEnv("LLM_WIKI_OPENAI_API_KEY", "stubbed-route-test-key");

      expect(process.env.LLM_WIKI_OPENAI_API_KEY).toBe("stubbed-route-test-key");
    });

    it("restores provider env after each test", () => {
      expect(process.env.LLM_WIKI_OPENAI_API_KEY).toBe(preservedApiKey);
    });
  });

  it("POST answers a project question with sources", async () => {
    const { fixture, projectId } = await createProjectContext("question-success");
    await fs.writeFile(
      path.join(fixture.rootDir, "wiki", "schema-answer.md"),
      "The billing schema is defined in invoices.sql.\n",
      "utf8",
    );
    vi.stubEnv("LLM_WIKI_OPENAI_API_KEY", "test-key");
    vi.stubEnv("LLM_WIKI_OPENAI_MODEL", "test-model");
    vi.stubEnv("LLM_WIKI_OPENAI_BASE_URL", "https://provider.example.test/v1/responses");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;

      return new Response(JSON.stringify({ output_text: "Answer [1]." }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST, runtime } = await import("../route");
    const response = await POST(
      new Request(`http://localhost/api/projects/${projectId}/question`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          question: "Where is the billing schema defined?",
          history: [
            { role: "user", content: "Where is billing?" },
            { role: "assistant", content: "Check project sources." },
            { role: "system", content: "invalid role" },
            { role: "user", content: 123 },
          ],
        }),
      }),
      {
        params: Promise.resolve({ projectId }),
      },
    );
    const payload = (await response.json()) as {
      answer: string;
      sources: Array<{ relativePath: string }>;
      model: string;
    };

    expect(runtime).toBe("nodejs");
    expect(response.status).toBe(200);
    expect(payload.answer).toBe("Answer [1].");
    expect(payload.model).toBe("test-model");
    expect(payload.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relativePath: "wiki/schema-answer.md",
        }),
      ]),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, providerRequestInit] = fetchMock.mock.calls[0] ?? [];
    const providerRequest = JSON.parse(String(providerRequestInit?.body)) as {
      input: Array<{ content: string }>;
    };
    expect(providerRequest.input[0]?.content).not.toContain("invalid role");
    expect(providerRequest.input[0]?.content).not.toContain("123");
  });

  it("POST returns 400 when question is not a string", async () => {
    const { projectId } = await createProjectContext("question-invalid-body");

    const { POST } = await import("../route");
    const response = await POST(
      new Request(`http://localhost/api/projects/${projectId}/question`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ question: 123 }),
      }),
      {
        params: Promise.resolve({ projectId }),
      },
    );
    const payload = (await response.json()) as {
      error: { code: string };
    };

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("INVALID_REQUEST_BODY");
  });

  it("POST returns 400 when the request body is malformed JSON", async () => {
    const { projectId } = await createProjectContext("question-malformed-json");

    const { POST } = await import("../route");
    const response = await POST(
      new Request(`http://localhost/api/projects/${projectId}/question`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: "{",
      }),
      {
        params: Promise.resolve({ projectId }),
      },
    );
    const payload = (await response.json()) as {
      error: { code: string };
    };

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("INVALID_REQUEST_BODY");
  });

  it("POST returns 404 for an unknown project", async () => {
    await createProjectContext("question-unknown-project");

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/projects/missing-project/question", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ question: "Where is the schema defined?" }),
      }),
      {
        params: Promise.resolve({ projectId: "missing-project" }),
      },
    );
    const payload = (await response.json()) as {
      error: { code: string };
    };

    expect(response.status).toBe(404);
    expect(payload.error.code).toBe("PROJECT_NOT_FOUND");
  });

  it("POST returns 503 when sources exist but provider env is not configured", async () => {
    const { fixture, projectId } = await createProjectContext("question-provider-missing");
    await fs.writeFile(
      path.join(fixture.rootDir, "wiki", "schema-provider.md"),
      "The provider schema is defined here.\n",
      "utf8",
    );

    const { POST } = await import("../route");
    const response = await POST(
      new Request(`http://localhost/api/projects/${projectId}/question`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ question: "Where is the provider schema defined?" }),
      }),
      {
        params: Promise.resolve({ projectId }),
      },
    );
    const payload = (await response.json()) as {
      error: { code: string };
    };

    expect(response.status).toBe(503);
    expect(payload.error.code).toBe("PROJECT_QA_PROVIDER_NOT_CONFIGURED");
  });

  it("POST returns no-context without calling fetch when no sources match", async () => {
    const { projectId } = await createProjectContext("question-no-sources");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("../route");
    const response = await POST(
      new Request(`http://localhost/api/projects/${projectId}/question`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ question: "Where is zzz-no-match-token documented?" }),
      }),
      {
        params: Promise.resolve({ projectId }),
      },
    );
    const payload = (await response.json()) as {
      answer: string;
      sources: unknown[];
      model: string;
    };

    expect(response.status).toBe(200);
    expect(payload.sources).toEqual([]);
    expect(payload.model).toBe("not-called");
    expect(payload.answer.length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
