import { describe, expect, it } from "vitest";

import { AppError } from "../app-error";
import { getProjectQuestionAnswerConfigFromEnv } from "../env";

const notConfiguredError = {
  code: "PROJECT_QA_PROVIDER_NOT_CONFIGURED",
  status: 503,
  publicMessage:
    "项目问答还没有配置 LLM provider。请配置 LLM_WIKI_OPENAI_API_KEY 和 LLM_WIKI_OPENAI_MODEL。",
};

describe("project question answer env helper", () => {
  it("reads project question answer provider config from LLM_WIKI environment variables", () => {
    expect(
      getProjectQuestionAnswerConfigFromEnv({
        LLM_WIKI_OPENAI_API_KEY: " llm-wiki-key ",
        OPENAI_API_KEY: "openai-key",
        LLM_WIKI_OPENAI_MODEL: " gpt-5-mini ",
        LLM_WIKI_OPENAI_BASE_URL: " https://gateway.example.test/v1/responses ",
      }),
    ).toEqual({
      apiKey: "llm-wiki-key",
      model: "gpt-5-mini",
      baseUrl: "https://gateway.example.test/v1/responses",
    });
  });

  it("falls back to OPENAI_API_KEY and uses the default responses base URL", () => {
    expect(
      getProjectQuestionAnswerConfigFromEnv({
        OPENAI_API_KEY: " openai-key ",
        LLM_WIKI_OPENAI_MODEL: " gpt-5 ",
      }),
    ).toEqual({
      apiKey: "openai-key",
      model: "gpt-5",
      baseUrl: "https://api.openai.com/v1/responses",
    });
  });

  it("throws a 503 AppError when the API key is missing", () => {
    expect(() =>
      getProjectQuestionAnswerConfigFromEnv({
        LLM_WIKI_OPENAI_MODEL: "gpt-5",
      }),
    ).toThrow(AppError);
    expect(() =>
      getProjectQuestionAnswerConfigFromEnv({
        LLM_WIKI_OPENAI_MODEL: "gpt-5",
      }),
    ).toThrow(expect.objectContaining(notConfiguredError));
  });

  it("throws a 503 AppError when the model is missing", () => {
    expect(() =>
      getProjectQuestionAnswerConfigFromEnv({
        LLM_WIKI_OPENAI_API_KEY: "llm-wiki-key",
      }),
    ).toThrow(AppError);
    expect(() =>
      getProjectQuestionAnswerConfigFromEnv({
        LLM_WIKI_OPENAI_API_KEY: "llm-wiki-key",
      }),
    ).toThrow(expect.objectContaining(notConfiguredError));
  });
});
