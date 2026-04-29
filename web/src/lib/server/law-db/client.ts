import { drizzle } from "drizzle-orm/mysql2";
import mysql, { type Pool } from "mysql2/promise";

import { createLawDbConfigFromEnv, type LawDbConfig } from "./config";
import * as schema from "./schema";

declare global {
  var __llmWikiLawDbPool: Pool | undefined;
}

export function createLawMysqlPool(config: LawDbConfig): Pool {
  return mysql.createPool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    waitForConnections: true,
    connectionLimit: 5,
  });
}

export function getLawDb() {
  const config = createLawDbConfigFromEnv(process.env);
  const pool = globalThis.__llmWikiLawDbPool ?? createLawMysqlPool(config);

  if (process.env.NODE_ENV !== "production") {
    globalThis.__llmWikiLawDbPool = pool;
  }

  return drizzle(pool, { schema, mode: "default" });
}
