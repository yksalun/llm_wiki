import { AppError } from "./app-error";

const PROJECT_ROOTS_ENV_KEY = "LLM_WIKI_PROJECT_ROOTS";
const DATABASE_URL_ENV_KEY = "DATABASE_URL";
const LLM_WIKI_OPENAI_API_KEY_ENV_KEY = "LLM_WIKI_OPENAI_API_KEY";
const OPENAI_API_KEY_ENV_KEY = "OPENAI_API_KEY";
const LLM_WIKI_OPENAI_MODEL_ENV_KEY = "LLM_WIKI_OPENAI_MODEL";
const LLM_WIKI_OPENAI_BASE_URL_ENV_KEY = "LLM_WIKI_OPENAI_BASE_URL";
const DEFAULT_OPENAI_RESPONSES_BASE_URL = "https://api.openai.com/v1/responses";
const PROJECT_QA_PROVIDER_NOT_CONFIGURED_MESSAGE =
  "项目问答还没有配置大模型服务。请先配置问答服务的密钥和模型。";

type EnvironmentLike = Readonly<Record<string, string | undefined>>;

export interface ProjectQuestionAnswerConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
}

export function getProjectRootsFromEnv(env: EnvironmentLike = process.env): string[] {
  const rawValue = env[PROJECT_ROOTS_ENV_KEY]?.trim();

  if (!rawValue) {
    throw new AppError(
      "PROJECT_ROOTS_ENV_MISSING",
      500,
      "服务器还没有配置项目根目录白名单。",
    );
  }

  const roots = rawValue
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (roots.length === 0) {
    throw new AppError(
      "PROJECT_ROOTS_ENV_INVALID",
      500,
      "服务器配置的项目根目录白名单无效。",
    );
  }

  return roots;
}

export function getDatabaseUrlFromEnv(env: EnvironmentLike = process.env): string {
  const databaseUrl = env[DATABASE_URL_ENV_KEY]?.trim();

  if (!databaseUrl) {
    throw new AppError("DATABASE_URL_ENV_MISSING", 500, "服务器还没有配置数据库连接。");
  }

  return databaseUrl;
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
      PROJECT_QA_PROVIDER_NOT_CONFIGURED_MESSAGE,
    );
  }

  return {
    apiKey,
    model,
    baseUrl,
  };
}
