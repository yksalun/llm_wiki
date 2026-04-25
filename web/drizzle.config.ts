import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
  migrations: {
    schema: process.env.NEXT_PUBLIC_DB_MIGRATIONS_SCHEMA || "drizzle",
    table:
      process.env.NEXT_PUBLIC_DB_MIGRATIONS_TABLE || "__drizzle_migrations",
  },
});
