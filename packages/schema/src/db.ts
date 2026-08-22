import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as tables from "./tables.ts";

export type Db = ReturnType<typeof drizzlePostgres<typeof tables>>;

export interface DbHandle {
  db: Db;
  driver: "postgres" | "pglite";
  close: () => Promise<void>;
  /** Applies checked-in migrations from packages/schema/migrations. */
  migrate: () => Promise<void>;
}

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/**
 * DATABASE_URL formats:
 *   postgres://user:pass@host:port/db   — real stack (docker compose)
 *   pglite://<dataDir>                  — in-process Postgres (tests / no Docker; ADR-0003)
 *   pglite://memory                     — ephemeral in-memory instance
 */
export async function createDb(databaseUrl: string): Promise<DbHandle> {
  if (databaseUrl.startsWith("pglite://")) {
    const target = databaseUrl.slice("pglite://".length);
    const client = target === "memory" || target === "" ? new PGlite() : new PGlite(target);
    const db = drizzlePglite(client, { schema: tables }) as unknown as Db;
    return {
      db,
      driver: "pglite",
      close: () => client.close(),
      migrate: async () => {
        await migratePglite(db as unknown as Parameters<typeof migratePglite>[0], {
          migrationsFolder: MIGRATIONS_DIR,
        });
      },
    };
  }
  const client = postgres(databaseUrl, { max: 5, onnotice: () => {} });
  const db = drizzlePostgres(client, { schema: tables });
  return {
    db,
    driver: "postgres",
    close: () => client.end({ timeout: 5 }),
    migrate: async () => {
      await migratePostgres(db, { migrationsFolder: MIGRATIONS_DIR });
    },
  };
}

export function databaseUrlFromEnv(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set (postgres://… or pglite://…). See .env.example.");
  }
  return url;
}
