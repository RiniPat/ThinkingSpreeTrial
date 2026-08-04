/**
 * Database entry point for `@workspace/db`.
 *
 * Creates the process-wide Postgres connection pool and the Drizzle client
 * bound to the full table schema, then re-exports the schema, workflow-stage
 * helpers, and role helpers so consumers get everything from one import.
 * Throws at load time if `DATABASE_URL` is missing, failing fast instead of
 * on the first query.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

/** Shared `pg` connection pool for the whole process. */
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
/** Drizzle ORM client bound to the full workspace schema — the handle every
 *  query in the app goes through. */
export const db = drizzle(pool, { schema });

export * from "./schema";
export * from "./workflowStages";
export * from "./roles";
