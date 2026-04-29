import { AppError } from "../app-error";

export interface LawDbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export function createLawDbConfigFromEnv(env: Record<string, string | undefined>): LawDbConfig {
  const host = env.LAW_DB_HOST?.trim();
  const database = env.LAW_DB_DATABASE?.trim();
  const user = env.LAW_DB_USER?.trim();
  const password = env.LAW_DB_PASSWORD;
  const portText = env.LAW_DB_PORT?.trim() || "3306";
  const port = Number.parseInt(portText, 10);

  if (!host || !database || !user || !password || !Number.isFinite(port)) {
    throw new AppError("LAW_DB_CONFIG_MISSING", 500, "法规数据库配置不完整。");
  }

  return { host, port, database, user, password };
}
