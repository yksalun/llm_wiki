# 阶段 5 项目级问答 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Web 工作台中新增当前项目范围内的检索增强问答入口，回答带来源引用并可打开来源文件。

**Architecture:** 服务端复用 Phase 4 `searchProjectFiles()` 构建最多 8 条来源上下文，再通过可配置 OpenAI Responses API 适配层生成非流式回答。前端新增 `Ask` section 和 `ProjectQuestionPanel`，只保留页面内临时历史，不做持久化、向量索引或后台任务。

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, Node fetch/AbortController, existing `AppError`/`route-helpers`, existing shadcn/base-ui components, lucide-react.

---

## 文件结构

- Modify: `web/src/lib/types.ts`  
  增加项目问答请求、消息、来源和响应类型，并把 `WorkbenchSection` 加入 `Ask`。
- Modify: `web/src/lib/server/env.ts`  
  增加 `getProjectQuestionAnswerConfigFromEnv()`，读取 LLM provider 环境变量。
- Test: `web/src/lib/server/__tests__/project-qa-env.test.ts`  
  覆盖 provider 配置读取、fallback 和未配置错误。
- Create: `web/src/lib/server/llm-provider.ts`  
  封装 OpenAI Responses API 非流式调用和响应解析。
- Create: `web/src/lib/server/__tests__/llm-provider.test.ts`  
  覆盖未配置、成功、provider error、invalid response、timeout/abort。
- Create: `web/src/lib/server/project-question-answer.ts`  
  构建检索 query、合并 sources、构造 prompt、调用 provider。
- Create: `web/src/lib/server/__tests__/project-question-answer.test.ts`  
  覆盖 query 生成、无 sources、provider 调用、history 限制和引用上下文。
- Create: `web/src/app/api/projects/[projectId]/question/route.ts`  
  新增问答 API route。
- Create: `web/src/app/api/projects/[projectId]/question/__tests__/route.test.ts`  
  覆盖成功、invalid body、unknown project、provider 未配置。
- Modify: `web/src/lib/client/api.ts`  
  增加 `askProjectQuestion()`。
- Create: `web/src/components/workbench/project-question-panel.tsx`  
  新增 Ask section 主面板。
- Create: `web/src/components/workbench/project-question-panel.test.tsx`  
  覆盖短输入、提交、成功渲染、source 打开、error retry。
- Modify: `web/src/lib/server/project-registry.ts`  
  把 `Ask` 加入项目 sections。
- Test: `web/src/lib/server/__tests__/project-registry.test.ts`  
  更新 sections 断言。
- Modify: `web/src/stores/workbench-store.ts`  
  类型随 `WorkbenchSection` 自动更新；如无需代码改动则不改。
- Modify: `web/src/components/workbench/project-workbench.tsx`  
  渲染 `Ask` section，并通过 `requestOpenRelativePath(relativePath, "Files")` 打开 source。
- Modify: `web/src/components/workbench/draft-guard.test.ts`  
  如新增 intent 不需要改；保持现有测试通过。
- Modify: `web/README.md`  
  记录新增 LLM provider 环境变量。
- Modify: `web/docs/web-roadmap-next-phases.md`  
  阶段完成后标记阶段 5 已完成。

---

### Task 1: 问答共享类型与 provider env

**Files:**
- Modify: `web/src/lib/types.ts`
- Modify: `web/src/lib/server/env.ts`
- Create: `web/src/lib/server/__tests__/project-qa-env.test.ts`

- [ ] **Step 1: 写 env 失败测试**

创建 `web/src/lib/server/__tests__/project-qa-env.test.ts`：

```ts
import { describe, expect, it } from "vitest";

import { AppError } from "../app-error";
import { getProjectQuestionAnswerConfigFromEnv } from "../env";

describe("getProjectQuestionAnswerConfigFromEnv", () => {
  it("reads LLM Wiki OpenAI config from env", () => {
    expect(
      getProjectQuestionAnswerConfigFromEnv({
        LLM_WIKI_OPENAI_API_KEY: "wiki-key",
        LLM_WIKI_OPENAI_MODEL: "configured-model",
        LLM_WIKI_OPENAI_BASE_URL: "https://example.test/v1/responses",
      }),
    ).toEqual({
      apiKey: "wiki-key",
      model: "configured-model",
      baseUrl: "https://example.test/v1/responses",
    });
  });

  it("falls back to OPENAI_API_KEY and the default Responses API URL", () => {
    expect(
      getProjectQuestionAnswerConfigFromEnv({
        OPENAI_API_KEY: "openai-key",
        LLM_WIKI_OPENAI_MODEL: "configured-model",
      }),
    ).toEqual({
      apiKey: "openai-key",
      model: "configured-model",
      baseUrl: "https://api.openai.com/v1/responses",
    });
  });

  it("throws a 503 app error when api key or model is missing", () => {
    expect(() =>
      getProjectQuestionAnswerConfigFromEnv({
        LLM_WIKI_OPENAI_API_KEY: "wiki-key",
      }),
    ).toThrow(AppError);

    try {
      getProjectQuestionAnswerConfigFromEnv({});
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("PROJECT_QA_PROVIDER_NOT_CONFIGURED");
      expect((error as AppError).status).toBe(503);
    }
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm run test -- src/lib/server/__tests__/project-qa-env.test.ts
```

Expected: 失败，因为 `getProjectQuestionAnswerConfigFromEnv` 尚未导出。

- [ ] **Step 3: 增加共享类型**

在 `web/src/lib/types.ts` 中：

1. 把 `WorkbenchSection` 增加 `"Ask"`：

```ts
export type WorkbenchSection =
  | "Overview"
  | "Ask"
  | "Files"
  | "Purpose"
  | "Schema"
  | "Project Info";
```

2. 在搜索类型之后增加：

```ts
export interface ProjectQuestionMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ProjectQuestionRequest {
  question: string;
  history?: ProjectQuestionMessage[];
}

export interface ProjectQuestionSource {
  id: number;
  relativePath: string;
  lineNumber: number;
  preview: string;
}

export interface ProjectQuestionResponse {
  question: string;
  answer: string;
  sources: ProjectQuestionSource[];
  retrieval: {
    queries: string[];
    totalMatches: number;
    truncated: boolean;
  };
  model: string;
}
```

- [ ] **Step 4: 实现 env helper**

在 `web/src/lib/server/env.ts` 增加：

```ts
const LLM_WIKI_OPENAI_API_KEY_ENV_KEY = "LLM_WIKI_OPENAI_API_KEY";
const OPENAI_API_KEY_ENV_KEY = "OPENAI_API_KEY";
const LLM_WIKI_OPENAI_MODEL_ENV_KEY = "LLM_WIKI_OPENAI_MODEL";
const LLM_WIKI_OPENAI_BASE_URL_ENV_KEY = "LLM_WIKI_OPENAI_BASE_URL";
const DEFAULT_OPENAI_RESPONSES_BASE_URL = "https://api.openai.com/v1/responses";

export interface ProjectQuestionAnswerConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
}

export function getProjectQuestionAnswerConfigFromEnv(
  env: EnvironmentLike = process.env,
): ProjectQuestionAnswerConfig {
  const apiKey =
    env[LLM_WIKI_OPENAI_API_KEY_ENV_KEY]?.trim() || env[OPENAI_API_KEY_ENV_KEY]?.trim();
  const model = env[LLM_WIKI_OPENAI_MODEL_ENV_KEY]?.trim();
  const baseUrl =
    env[LLM_WIKI_OPENAI_BASE_URL_ENV_KEY]?.trim() || DEFAULT_OPENAI_RESPONSES_BASE_URL;

  if (!apiKey || !model) {
    throw new AppError(
      "PROJECT_QA_PROVIDER_NOT_CONFIGURED",
      503,
      "项目问答还没有配置 LLM provider。请配置 LLM_WIKI_OPENAI_API_KEY 和 LLM_WIKI_OPENAI_MODEL。",
    );
  }

  return { apiKey, model, baseUrl };
}
```

- [ ] **Step 5: 验证**

Run:

```bash
npm run test -- src/lib/server/__tests__/project-qa-env.test.ts
npm run typecheck
```

Expected: 测试和 typecheck 通过。

- [ ] **Step 6: 提交**

Run:

```bash
git add web/src/lib/types.ts web/src/lib/server/env.ts web/src/lib/server/__tests__/project-qa-env.test.ts
git commit -m "feat: add project qa types and config"
```

---

### Task 2: LLM provider adapter

**Files:**
- Create: `web/src/lib/server/llm-provider.ts`
- Create: `web/src/lib/server/__tests__/llm-provider.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `web/src/lib/server/__tests__/llm-provider.test.ts`：

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../app-error";
import { generateProjectAnswer, parseOpenAIResponseText } from "../llm-provider";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseOpenAIResponseText", () => {
  it("reads output_text when present", () => {
    expect(parseOpenAIResponseText({ output_text: "Answer text" })).toBe("Answer text");
  });

  it("falls back to output content text", () => {
    expect(
      parseOpenAIResponseText({
        output: [
          {
            content: [
              { type: "output_text", text: "First part" },
              { type: "output_text", text: " second part" },
            ],
          },
        ],
      }),
    ).toBe("First part second part");
  });

  it("returns null for unparseable responses", () => {
    expect(parseOpenAIResponseText({ output: [] })).toBeNull();
  });
});

describe("generateProjectAnswer", () => {
  it("posts a non-streaming Responses API request and returns answer text", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ output_text: "Cited answer [1]." })));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateProjectAnswer({
      question: "Where is schema?",
      prompt: "Use sources.",
      config: {
        apiKey: "test-key",
        model: "test-model",
        baseUrl: "https://example.test/v1/responses",
      },
    });

    expect(result).toEqual({ answer: "Cited answer [1].", model: "test-model" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/v1/responses",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
          "Content-Type": "application/json",
        }),
        body: expect.stringContaining("test-model"),
      }),
    );
  });

  it("throws provider error when fetch returns non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad gateway", { status: 502 })));

    await expect(
      generateProjectAnswer({
        question: "Where?",
        prompt: "Prompt",
        config: {
          apiKey: "test-key",
          model: "test-model",
          baseUrl: "https://example.test/v1/responses",
        },
      }),
    ).rejects.toMatchObject({
      code: "PROJECT_QA_PROVIDER_ERROR",
      status: 502,
    } satisfies Partial<AppError>);
  });

  it("throws invalid response when no text can be parsed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ output: [] }))));

    await expect(
      generateProjectAnswer({
        question: "Where?",
        prompt: "Prompt",
        config: {
          apiKey: "test-key",
          model: "test-model",
          baseUrl: "https://example.test/v1/responses",
        },
      }),
    ).rejects.toMatchObject({
      code: "PROJECT_QA_PROVIDER_INVALID_RESPONSE",
      status: 502,
    } satisfies Partial<AppError>);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm run test -- src/lib/server/__tests__/llm-provider.test.ts
```

Expected: 失败，因为 provider 文件尚不存在。

- [ ] **Step 3: 实现 provider**

创建 `web/src/lib/server/llm-provider.ts`：

```ts
import type { ProjectQuestionAnswerConfig } from "./env";
import { AppError } from "./app-error";

interface GenerateProjectAnswerInput {
  question: string;
  prompt: string;
  config: ProjectQuestionAnswerConfig;
}

export async function generateProjectAnswer({
  question,
  prompt,
  config,
}: GenerateProjectAnswerInput): Promise<{ answer: string; model: string }> {
  const response = await fetch(config.baseUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      input: [
        {
          role: "system",
          content: prompt,
        },
        {
          role: "user",
          content: question,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new AppError(
      "PROJECT_QA_PROVIDER_ERROR",
      502,
      "项目问答 provider 请求失败。",
      {
        publicDetails: {
          status: response.status,
        },
      },
    );
  }

  const payload = (await response.json()) as unknown;
  const answer = parseOpenAIResponseText(payload);

  if (!answer) {
    throw new AppError(
      "PROJECT_QA_PROVIDER_INVALID_RESPONSE",
      502,
      "项目问答 provider 返回了无法解析的响应。",
    );
  }

  return { answer, model: config.model };
}

export function parseOpenAIResponseText(payload: unknown): string | null {
  if (payload && typeof payload === "object" && "output_text" in payload) {
    const outputText = (payload as { output_text?: unknown }).output_text;

    if (typeof outputText === "string" && outputText.trim().length > 0) {
      return outputText;
    }
  }

  if (!payload || typeof payload !== "object" || !("output" in payload)) {
    return null;
  }

  const output = (payload as { output?: unknown }).output;

  if (!Array.isArray(output)) {
    return null;
  }

  const parts: string[] = [];

  for (const item of output) {
    if (!item || typeof item !== "object" || !("content" in item)) {
      continue;
    }

    const content = (item as { content?: unknown }).content;

    if (!Array.isArray(content)) {
      continue;
    }

    for (const block of content) {
      if (!block || typeof block !== "object" || !("text" in block)) {
        continue;
      }

      const text = (block as { text?: unknown }).text;

      if (typeof text === "string") {
        parts.push(text);
      }
    }
  }

  const text = parts.join("").trim();

  return text.length > 0 ? text : null;
}
```

- [ ] **Step 4: 验证**

Run:

```bash
npm run test -- src/lib/server/__tests__/llm-provider.test.ts
npm run typecheck
```

Expected: 测试和 typecheck 通过。

- [ ] **Step 5: 提交**

Run:

```bash
git add web/src/lib/server/llm-provider.ts web/src/lib/server/__tests__/llm-provider.test.ts
git commit -m "feat: add project qa llm provider"
```

---

### Task 3: 项目问答 service

**Files:**
- Create: `web/src/lib/server/project-question-answer.ts`
- Create: `web/src/lib/server/__tests__/project-question-answer.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `web/src/lib/server/__tests__/project-question-answer.test.ts`，使用临时项目文件和 dependency injection：

```ts
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  answerProjectQuestion,
  buildProjectQuestionSearchQueries,
} from "../project-question-answer";

const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanupTasks.length > 0) {
    const cleanup = cleanupTasks.pop();
    if (cleanup) {
      await cleanup();
    }
  }
});

describe("buildProjectQuestionSearchQueries", () => {
  it("uses the full question plus deduped keyword queries", () => {
    expect(buildProjectQuestionSearchQueries("Where is the schema schema defined?")).toEqual([
      "Where is the schema schema defined?",
      "where",
      "schema",
      "defined",
    ]);
  });
});

describe("answerProjectQuestion", () => {
  it("returns a no-context answer without calling the provider when retrieval finds no sources", async () => {
    const projectRoot = await createProject("no-sources");
    const generateAnswer = vi.fn();

    const response = await answerProjectQuestion(projectRoot, { question: "missing topic" }, {
      generateAnswer,
      getConfig: () => ({
        apiKey: "test-key",
        model: "test-model",
        baseUrl: "https://example.test/v1/responses",
      }),
    });

    expect(generateAnswer).not.toHaveBeenCalled();
    expect(response.answer).toContain("没有找到足够上下文");
    expect(response.sources).toEqual([]);
    expect(response.retrieval.queries).toContain("missing topic");
  });

  it("builds cited context from search results and calls the provider", async () => {
    const projectRoot = await createProject("with-sources");
    await writeProjectFile(projectRoot, "wiki/schema.md", "Schema defines Entity and Relation.\n");
    const generateAnswer = vi.fn(async ({ prompt }: { prompt: string }) => {
      expect(prompt).toContain("[1] wiki/schema.md:1");
      expect(prompt).toContain("Schema defines Entity and Relation.");
      expect(prompt).toContain("只能基于下面的项目来源回答");

      return { answer: "Schema is defined in the wiki page [1].", model: "test-model" };
    });

    const response = await answerProjectQuestion(projectRoot, { question: "Where is schema defined?" }, {
      generateAnswer,
      getConfig: () => ({
        apiKey: "test-key",
        model: "test-model",
        baseUrl: "https://example.test/v1/responses",
      }),
    });

    expect(response.answer).toBe("Schema is defined in the wiki page [1].");
    expect(response.sources).toEqual([
      {
        id: 1,
        relativePath: "wiki/schema.md",
        lineNumber: 1,
        preview: "Schema defines Entity and Relation.",
      },
    ]);
    expect(response.model).toBe("test-model");
  });
});

async function createProject(name: string): Promise<string> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "llm-wiki-web-qa-"));
  const projectRoot = path.join(tempRoot, name);

  await fs.mkdir(projectRoot, { recursive: true });
  cleanupTasks.push(() => fs.rm(tempRoot, { recursive: true, force: true }));

  return projectRoot;
}

async function writeProjectFile(projectRoot: string, relativePath: string, content: string) {
  const filePath = path.join(projectRoot, relativePath);

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm run test -- src/lib/server/__tests__/project-question-answer.test.ts
```

Expected: 失败，因为 service 尚不存在。

- [ ] **Step 3: 实现 service**

创建 `web/src/lib/server/project-question-answer.ts`。核心导出：

```ts
import type {
  ProjectQuestionRequest,
  ProjectQuestionResponse,
  ProjectQuestionSource,
} from "@/lib/types";

import { AppError } from "./app-error";
import { getProjectQuestionAnswerConfigFromEnv } from "./env";
import { generateProjectAnswer } from "./llm-provider";
import { searchProjectFiles } from "./project-search";

const MIN_QUESTION_LENGTH = 2;
const MAX_QUESTION_LENGTH = 500;
const MAX_HISTORY_MESSAGES = 4;
const MAX_SOURCE_COUNT = 8;
const STOP_WORDS = new Set(["the", "and", "for", "from", "with", "where", "what", "when", "how", "why", "is", "are"]);

interface AnswerProjectQuestionDependencies {
  getConfig?: typeof getProjectQuestionAnswerConfigFromEnv;
  generateAnswer?: typeof generateProjectAnswer;
}

export async function answerProjectQuestion(
  projectRoot: string,
  request: ProjectQuestionRequest,
  dependencies: AnswerProjectQuestionDependencies = {},
): Promise<ProjectQuestionResponse> {
  const question = validateQuestion(request.question);
  const queries = buildProjectQuestionSearchQueries(question);
  const sources = await collectQuestionSources(projectRoot, queries);
  const retrieval = {
    queries,
    totalMatches: sources.totalMatches,
    truncated: sources.truncated,
  };

  if (sources.items.length === 0) {
    return {
      question,
      answer: "当前项目中没有找到足够上下文回答这个问题。",
      sources: [],
      retrieval,
      model: "not-called",
    };
  }

  const getConfig = dependencies.getConfig ?? getProjectQuestionAnswerConfigFromEnv;
  const generateAnswer = dependencies.generateAnswer ?? generateProjectAnswer;
  const config = getConfig();
  const prompt = buildProjectQuestionPrompt(question, sources.items, request.history ?? []);
  const generated = await generateAnswer({ question, prompt, config });

  return {
    question,
    answer: generated.answer,
    sources: sources.items,
    retrieval,
    model: generated.model,
  };
}
```

实现细节：

- `validateQuestion()` 对非字符串、过短、过长抛 `INVALID_REQUEST_BODY` 400。
- `buildProjectQuestionSearchQueries()` 返回完整问题 + keyword tokens，去重，最多 6 条。
- `collectQuestionSources()` 对每个 query 调用 `searchProjectFiles()`，用 `relativePath:lineNumber` 去重，最多 8 条。
- `buildProjectQuestionPrompt()` 输出中文系统提示，列出 `[id] relativePath:lineNumber` 和 preview，包含最近最多 4 条 history。

- [ ] **Step 4: 验证**

Run:

```bash
npm run test -- src/lib/server/__tests__/project-question-answer.test.ts src/lib/server/__tests__/project-search.test.ts src/lib/server/__tests__/llm-provider.test.ts
npm run typecheck
```

Expected: 测试和 typecheck 通过。

- [ ] **Step 5: 提交**

Run:

```bash
git add web/src/lib/server/project-question-answer.ts web/src/lib/server/__tests__/project-question-answer.test.ts
git commit -m "feat: add project qa service"
```

---

### Task 4: 问答 API route

**Files:**
- Create: `web/src/app/api/projects/[projectId]/question/route.ts`
- Create: `web/src/app/api/projects/[projectId]/question/__tests__/route.test.ts`

- [ ] **Step 1: 写失败测试**

参考现有 route 测试 mock repo。创建 `web/src/app/api/projects/[projectId]/question/__tests__/route.test.ts`，覆盖：

```ts
import fs from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  delete process.env.LLM_WIKI_PROJECT_ROOTS;
  delete process.env.LLM_WIKI_OPENAI_API_KEY;
  delete process.env.LLM_WIKI_OPENAI_MODEL;
  vi.restoreAllMocks();
  vi.resetModules();

  while (cleanupTasks.length > 0) {
    const cleanup = cleanupTasks.pop();
    if (cleanup) {
      await cleanup();
    }
  }
});
```

测试用例：

- 成功 POST：设置 provider env，mock `fetch` 返回 `{ output_text: "Answer [1]." }`。
- invalid body：`question` 不是字符串返回 400 `INVALID_REQUEST_BODY`。
- unknown project：返回 404 `PROJECT_NOT_FOUND`。
- provider 未配置：有 sources 但无 provider env，返回 503 `PROJECT_QA_PROVIDER_NOT_CONFIGURED`。

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm run test -- "src/app/api/projects/[projectId]/question/__tests__/route.test.ts"
```

Expected: 失败，因为 route 尚不存在。

- [ ] **Step 3: 实现 route**

创建 `web/src/app/api/projects/[projectId]/question/route.ts`：

```ts
import type { ProjectQuestionRequest } from "@/lib/types";
import { AppError } from "@/lib/server/app-error";
import { getProjectRootsFromEnv } from "@/lib/server/env";
import { answerProjectQuestion } from "@/lib/server/project-question-answer";
import { resolveProjectById } from "@/lib/server/project-registry";
import { errorJson, okJson } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

export async function POST(request: Request, context: ProjectRouteContext) {
  try {
    const roots = getProjectRootsFromEnv();
    const { projectId } = await context.params;
    const project = await resolveProjectById(roots, projectId);
    const payload = validateQuestionRequest(await parseJsonRequestBody(request));
    const response = await answerProjectQuestion(project.rootDir, payload);

    return okJson(response);
  } catch (error) {
    return errorJson(error);
  }
}
```

同文件实现 `parseJsonRequestBody()` 和 `validateQuestionRequest()`，沿用 file route 的 `INVALID_REQUEST_BODY` 400 风格。

- [ ] **Step 4: 验证**

Run:

```bash
npm run test -- "src/app/api/projects/[projectId]/question/__tests__/route.test.ts" src/lib/server/__tests__/project-question-answer.test.ts
npm run typecheck
```

Expected: 测试和 typecheck 通过。

- [ ] **Step 5: 提交**

Run:

```bash
git add web/src/app/api/projects/[projectId]/question/route.ts web/src/app/api/projects/[projectId]/question/__tests__/route.test.ts
git commit -m "feat: add project question route"
```

---

### Task 5: 客户端 API 与 Ask 面板

**Files:**
- Modify: `web/src/lib/client/api.ts`
- Create: `web/src/components/workbench/project-question-panel.tsx`
- Create: `web/src/components/workbench/project-question-panel.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `web/src/components/workbench/project-question-panel.test.tsx`，参考 `project-search.test.tsx`。测试覆盖：

- 输入少于 2 字符时 Ask 按钮 disabled。
- 输入问题并提交后调用 `askFn(projectId, { question, history }, signal)`。
- 成功后渲染 answer、source path、`Line 1`。
- 点击 `Open source` 调用 `onOpenFile(relativePath)`。
- error 后显示错误和 `Retry`，点击 retry 重新请求。

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm run test -- src/components/workbench/project-question-panel.test.tsx
```

Expected: 失败，因为组件尚不存在。

- [ ] **Step 3: 实现客户端 API**

在 `web/src/lib/client/api.ts` import type 加入 `ProjectQuestionRequest` 和 `ProjectQuestionResponse`，新增：

```ts
export async function askProjectQuestion(
  projectId: string,
  payload: ProjectQuestionRequest,
  signal?: AbortSignal,
) {
  return requestJson<ProjectQuestionResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/question`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal,
    },
  );
}
```

- [ ] **Step 4: 实现 ProjectQuestionPanel**

创建 `web/src/components/workbench/project-question-panel.tsx`：

- `"use client"`。
- 使用 `useState`、`useRef` 管理输入、loading、error、messages、lastResponse。
- 使用 `Textarea` 或 `Input`；多行问题推荐 `Textarea`。
- 提交时创建 `AbortController`，调用 `askFn`。
- 成功后 append user 和 assistant 消息，保存 `lastResponse`。
- sources 渲染 `Open source` 按钮，点击 `onOpenFile(source.relativePath)`。

UI 文案必须包含：

- `Ask project`
- `Ask`
- `Retry`
- `Open source`

- [ ] **Step 5: 验证**

Run:

```bash
npm run test -- src/components/workbench/project-question-panel.test.tsx
npm run typecheck
```

Expected: 测试和 typecheck 通过。

- [ ] **Step 6: 提交**

Run:

```bash
git add web/src/lib/client/api.ts web/src/components/workbench/project-question-panel.tsx web/src/components/workbench/project-question-panel.test.tsx
git commit -m "feat: add project question panel"
```

---

### Task 6: 工作台 Ask section 集成

**Files:**
- Modify: `web/src/lib/server/project-registry.ts`
- Test: `web/src/lib/server/__tests__/project-registry.test.ts`
- Modify: `web/src/components/workbench/project-workbench.tsx`
- Test: `web/src/components/workbench/project-question-panel.test.tsx`

- [ ] **Step 1: 更新 sections 测试**

在 `web/src/lib/server/__tests__/project-registry.test.ts` 中，把项目 detail sections 期望从：

```ts
["Overview", "Files", "Purpose", "Schema", "Project Info"]
```

改为：

```ts
["Overview", "Ask", "Files", "Purpose", "Schema", "Project Info"]
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm run test -- src/lib/server/__tests__/project-registry.test.ts
```

Expected: 失败，因为 registry 尚未返回 `Ask`。

- [ ] **Step 3: 更新 project registry sections**

在 `web/src/lib/server/project-registry.ts` 的 `PROJECT_SECTIONS` 中插入 `"Ask"`，位于 `"Overview"` 之后。

- [ ] **Step 4: 集成 ProjectQuestionPanel**

在 `web/src/components/workbench/project-workbench.tsx`：

1. import：

```ts
import { ProjectQuestionPanel } from "@/components/workbench/project-question-panel";
```

2. 在 section 渲染区域新增：

```tsx
          {section === "Ask" ? (
            <ProjectQuestionPanel
              projectId={projectId}
              onOpenFile={(relativePath) => {
                void requestOpenRelativePath(relativePath, "Files");
              }}
            />
          ) : null}
```

要求：

- 不直接调用 `performOpenRelativePath`。
- 不改变 Files/Purpose/Schema 的 FileTree/FilePanel 流程。
- Ask section 不需要打开文件树。

- [ ] **Step 5: 验证**

Run:

```bash
npm run test -- src/lib/server/__tests__/project-registry.test.ts src/components/workbench/project-question-panel.test.tsx src/components/workbench/draft-guard.test.ts
npm run typecheck
```

Expected: 测试和 typecheck 通过。

- [ ] **Step 6: 提交**

Run:

```bash
git add web/src/lib/server/project-registry.ts web/src/lib/server/__tests__/project-registry.test.ts web/src/components/workbench/project-workbench.tsx
git commit -m "feat: integrate project qa in workbench"
```

---

### Task 7: 文档、全量验证与 roadmap 更新

**Files:**
- Modify: `web/README.md`
- Modify: `web/docs/web-roadmap-next-phases.md`

- [ ] **Step 1: 全量验证**

Run:

```bash
npm run test
npm run typecheck
npm run lint
```

Expected:

- `npm run test` 全部通过。
- `npm run typecheck` 通过。
- `npm run lint` exit code 0。允许保留既有 5 个 warning，但不能新增 error。

- [ ] **Step 2: 更新 README 环境变量**

在 `web/README.md` 环境变量部分增加下面这段文字。注意代码块使用普通 markdown fence，不要嵌套在另一个 fence 里：

~~~md
项目级问答还需要配置：

```bash
LLM_WIKI_OPENAI_API_KEY=sk-...
LLM_WIKI_OPENAI_MODEL=your-model
# 可选；默认 https://api.openai.com/v1/responses
LLM_WIKI_OPENAI_BASE_URL=https://api.openai.com/v1/responses
```

也可以用 `OPENAI_API_KEY` 作为 API key fallback。未配置时，Ask section 会显示 provider 未配置错误。
~~~

- [ ] **Step 3: 更新 roadmap**

在 `web/docs/web-roadmap-next-phases.md` 的 `### 10.1 阶段 5：聊天 / RAG / 项目级问答` 标题下方加入：

~~~md
> 状态：已完成。阶段 5 已按 [spec](../../docs/superpowers/specs/2026-04-26-phase-5-project-qa-design.md) 和 [implementation plan](../../docs/superpowers/plans/2026-04-26-phase-5-project-qa.md) 落地，覆盖项目级 Ask 入口、检索增强问答 API、OpenAI Responses provider 适配、带引用来源的回答、source 打开联动和关键测试。
~~~

- [ ] **Step 4: 检查 roadmap**

Run:

```bash
rg -n "阶段 5：聊天 / RAG / 项目级问答|phase-5-project-qa|状态：已完成" web/docs/web-roadmap-next-phases.md
```

Expected: 输出包含阶段 5 状态、spec 链接和 plan 链接。

- [ ] **Step 5: 提交**

Run:

```bash
git add web/README.md web/docs/web-roadmap-next-phases.md
git commit -m "docs: mark phase 5 roadmap complete"
```

---

## 执行顺序

1. Task 1 必须先完成，因为后续共享类型和 env helper 依赖它。
2. Task 2 可以在 Task 1 后完成，提供 provider adapter。
3. Task 3 依赖 Task 1/2，提供问答 service。
4. Task 4 依赖 Task 3，提供 API route。
5. Task 5 可在 Task 4 后完成，提供前端 API 和 Ask 面板。
6. Task 6 依赖 Task 5，接入工作台。
7. Task 7 最后执行。

## 完成定义

- 阶段 5 spec 的验收标准全部满足。
- 问答只覆盖当前项目。
- 回答上下文来自 Phase 4 检索结果。
- source 打开经过 `requestOpenRelativePath(relativePath, "Files")`。
- 未配置 provider 时有明确错误。
- 不引入持久聊天历史、向量索引、后台任务或跨项目问答。
- `npm run test`、`npm run typecheck`、`npm run lint` 已运行并记录结果。
- roadmap 已标记阶段 5 完成。
