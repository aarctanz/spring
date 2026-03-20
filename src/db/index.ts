import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { getLogger } from "@logtape/logtape";
import * as schema from "./schema";

const logger = getLogger(["spring", "db"]);

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

export const client = postgres(connectionString);
export const db = drizzle(client, { schema });

export async function connect() {
  await db.execute(sql`SELECT 1`);
  logger.info`database connected`;
}
