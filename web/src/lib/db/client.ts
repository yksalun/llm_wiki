import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

declare global {
  var __llmWikiWebPool: Pool | undefined;
}

function createPool() {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
  });
}

export const pool = globalThis.__llmWikiWebPool ?? createPool();

if (process.env.NODE_ENV !== "production") {
  globalThis.__llmWikiWebPool = pool;
}

export const db = drizzle(pool, { schema });
