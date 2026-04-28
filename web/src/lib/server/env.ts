import { AppError } from "./app-error";

const PROJECT_ROOTS_ENV_KEY = "LLM_WIKI_PROJECT_ROOTS";
const DATABASE_URL_ENV_KEY = "DATABASE_URL";

type EnvironmentLike = Readonly<Record<string, string | undefined>>;

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
