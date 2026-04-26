import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../app-error";
import type { GenerateProjectAnswerInput } from "../llm-provider";
import {
  answerProjectQuestion,
  buildProjectQuestionSearchQueries,
} from "../project-question-answer";

const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  vi.restoreAllMocks();

  while (cleanupTasks.length > 0) {
    const cleanup = cleanupTasks.pop();

    if (cleanup) {
      await cleanup();
    }
  }
});

describe("buildProjectQuestionSearchQueries", () => {
  it("keeps the full question first and adds deduplicated keyword queries", () => {
    expect(buildProjectQuestionSearchQueries("Where is the schema schema defined?")).toEqual([
      "Where is the schema schema defined?",
      "where",
      "schema",
      "defined",
    ]);
  });
});

describe("answerProjectQuestion", () => {
  it("returns a no-context response without calling provider dependencies when search finds no sources", async () => {
    const projectRoot = await createProject("no-context");
    await writeProjectFile(projectRoot, "wiki/schema.md", "This file talks about tables only.\n");
    const getConfig = vi.fn();
    const generateAnswer = vi.fn();

    const response = await answerProjectQuestion(
      projectRoot,
      { question: "Where is the schema defined?" },
      { getConfig, generateAnswer },
    );

    expect(getConfig).not.toHaveBeenCalled();
    expect(generateAnswer).not.toHaveBeenCalled();
    expect(response.question).toBe("Where is the schema defined?");
    expect(response.answer).toContain("当前项目");
    expect(response.answer).toContain("没有找到足够上下文");
    expect(response.sources).toEqual([]);
    expect(response.retrieval.queries).toEqual([
      "Where is the schema defined?",
      "where",
      "schema",
      "defined",
    ]);
    expect(response.retrieval.totalMatches).toBe(0);
    expect(response.retrieval.truncated).toBe(false);
    expect(response.model).toBe("not-called");
  });

  it("builds a source-grounded Chinese prompt, calls the provider, and returns sources", async () => {
    const projectRoot = await createProject("with-sources");
    await writeProjectFile(projectRoot, "wiki/schema.md", "The schema is defined in this file.\n");
    const config = { apiKey: "test-key", model: "test-model", baseUrl: "https://example.test" };
    const getConfig = vi.fn(() => config);
    const generateAnswer = vi.fn(async (_input: GenerateProjectAnswerInput) => ({
      answer: "Schema 在 wiki/schema.md 中定义。[1]",
      model: "test-model",
    }));

    const response = await answerProjectQuestion(
      projectRoot,
      { question: "Where is the schema defined?" },
      { getConfig, generateAnswer },
    );

    expect(getConfig).toHaveBeenCalledTimes(1);
    expect(generateAnswer).toHaveBeenCalledTimes(1);
    const providerInput = generateAnswer.mock.calls[0]?.[0];
    expect(providerInput).toBeDefined();
    if (!providerInput) {
      throw new Error("expected provider input");
    }
    expect(providerInput.question).toBe("Where is the schema defined?");
    expect(providerInput.config).toBe(config);
    expect(providerInput.prompt).toContain("只能基于项目 sources");
    expect(providerInput.prompt).toContain("不知道");
    expect(providerInput.prompt).toContain("[1]");
    expect(providerInput.prompt).toContain("[1] wiki/schema.md:1");
    expect(providerInput.prompt).toContain("The schema is defined in this file.");
    expect(response.answer).toBe("Schema 在 wiki/schema.md 中定义。[1]");
    expect(response.model).toBe("test-model");
    expect(response.sources).toEqual([
      {
        id: 1,
        relativePath: "wiki/schema.md",
        lineNumber: 1,
        preview: "The schema is defined in this file.",
      },
    ]);
    expect(response.retrieval.totalMatches).toBeGreaterThan(0);
    expect(response.retrieval.truncated).toBe(false);
  });

  it("rejects invalid question shapes and lengths with INVALID_REQUEST_BODY", async () => {
    const projectRoot = await createProject("invalid-question");
    const invalidRequests = [
      { question: undefined },
      { question: "x" },
      { question: "x".repeat(501) },
    ];

    for (const request of invalidRequests) {
      await expect(answerProjectQuestion(projectRoot, request as never)).rejects.toMatchObject({
        code: "INVALID_REQUEST_BODY",
        status: 400,
      });
      await expect(answerProjectQuestion(projectRoot, request as never)).rejects.toBeInstanceOf(
        AppError,
      );
    }
  });

  it("includes only the latest four valid history messages and does not turn history into sources", async () => {
    const projectRoot = await createProject("history");
    await writeProjectFile(projectRoot, "wiki/schema.md", "schema fact from project source\n");
    const getConfig = vi.fn(() => ({
      apiKey: "test-key",
      model: "test-model",
      baseUrl: "https://example.test",
    }));
    const generateAnswer = vi.fn(async (_input: GenerateProjectAnswerInput) => ({
      answer: "answer [1]",
      model: "test-model",
    }));

    const longContent = "assistant latest ".repeat(100);
    await answerProjectQuestion(
      projectRoot,
      {
        question: "schema fact",
        history: [
          { role: "user", content: "old valid" },
          { role: "system" as never, content: "invalid role" },
          { role: "assistant", content: "assistant middle" },
          { role: "user", content: "user middle" },
          { role: "assistant", content: longContent },
          { role: "user", content: 123 as never },
          { role: "user", content: "user latest" },
        ],
      },
      { getConfig, generateAnswer },
    );

    const historyProviderInput = generateAnswer.mock.calls[0]?.[0];
    expect(historyProviderInput).toBeDefined();
    if (!historyProviderInput) {
      throw new Error("expected provider input");
    }
    const prompt = historyProviderInput.prompt;
    expect(prompt).not.toContain("old valid");
    expect(prompt).not.toContain("invalid role");
    expect(prompt).not.toContain("123");
    expect(prompt).toContain("assistant middle");
    expect(prompt).toContain("user middle");
    expect(prompt).toContain("assistant latest");
    expect(prompt).toContain("user latest");
    expect(prompt).toContain("不能作为事实来源");
    expect(prompt).not.toContain("[2] assistant");
  });

  it("deduplicates sources by path and line and keeps at most eight", async () => {
    const projectRoot = await createProject("dedupe-limit");
    await writeProjectFile(
      projectRoot,
      "wiki/schema.md",
      Array.from({ length: 10 }, (_, index) => `schema defined line ${index + 1}`).join("\n"),
    );
    await writeProjectFile(
      projectRoot,
      "wiki/other.md",
      Array.from({ length: 10 }, (_, index) => `schema defined extra ${index + 1}`).join("\n"),
    );
    const getConfig = vi.fn(() => ({
      apiKey: "test-key",
      model: "test-model",
      baseUrl: "https://example.test",
    }));
    const generateAnswer = vi.fn(async (_input: GenerateProjectAnswerInput) => ({
      answer: "answer [1]",
      model: "test-model",
    }));

    const response = await answerProjectQuestion(
      projectRoot,
      { question: "schema defined" },
      { getConfig, generateAnswer },
    );

    const sourceKeys = response.sources.map(
      (source) => `${source.relativePath}:${source.lineNumber}`,
    );
    expect(response.sources).toHaveLength(8);
    expect(new Set(sourceKeys).size).toBe(sourceKeys.length);
    expect(response.sources.map((source) => source.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(response.retrieval.truncated).toBe(true);
  });
});

async function createProject(name: string): Promise<string> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "llm-wiki-web-qa-"));
  const projectRoot = path.join(tempRoot, name);

  await fs.mkdir(projectRoot, { recursive: true });
  cleanupTasks.push(() => fs.rm(tempRoot, { recursive: true, force: true }));

  return projectRoot;
}

async function writeProjectFile(projectRoot: string, relativePath: string, content: string): Promise<void> {
  const filePath = path.join(projectRoot, relativePath);

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}
