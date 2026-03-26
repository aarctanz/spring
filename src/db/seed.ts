import { readFileSync } from "fs";
import { resolve } from "path";
import { eq } from "drizzle-orm";
import { db, client } from "./index";
import {
  contest,
  problem,
  testCase,
  tag,
  problemTag,
  language,
} from "./schema";
import { setupLogger, logger } from "../lib/logger";

async function seed() {
  await setupLogger();
  logger.info`seeding database...`;

  // Fetch and seed languages from execution engine
  const engineUrl = process.env.ENGINE_URL ?? "http://localhost:8080";
  logger.info`fetching languages from ${engineUrl}/languages`;
  const res = await fetch(`${engineUrl}/languages`);
  if (!res.ok) {
    logger.error`failed to fetch languages: ${res.status}`;
    throw new Error(`Failed to fetch languages: ${res.status}`);
  }
  const languages = (await res.json()) as {
    id: number;
    name: string;
    version: string;
    is_archived: boolean;
  }[];

  for (const lang of languages) {
    if (lang.is_archived) continue;
    await db
      .insert(language)
      .values({
        name: lang.name,
        version: lang.version,
        engineLanguageId: lang.id,
      })
      .onConflictDoNothing();
  }
  logger.info`seeded ${languages.filter((l) => !l.is_archived).length} languages`;

  logger.info`seed complete!`;
}

seed()
  .catch((err) => {
    logger.error`seed failed: ${err instanceof Error ? err.message : err}`;
    process.exit(1);
  })
  .finally(() => client.end());
