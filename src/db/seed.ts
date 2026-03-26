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

const PROBLEMS_DIR = resolve(import.meta.dir, "../../problems");

interface ProblemData {
  name: string;
  description: string;
  cf_rating: number;
  cf_tags: string[];
  difficulty: number;
  public_tests: { input: string[]; output: string[] };
  private_tests: { input: string[]; output: string[] };
}

const LABELS = ["A", "B", "C", "D"];

async function seed() {
  await setupLogger();
  logger.info`seeding database...`;

  // Create contest (startTime in the past so problems are visible)
  const now = new Date();
  const startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 1 week ago
  const endTime = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000); // 6 days ago

  const [createdContest] = await db
    .insert(contest)
    .values({
      title: "Codespardha Contest #1",
      description: "First practice contest on Codespardha platform.",
      startTime,
      endTime,
    })
    .returning({ id: contest.id, contestNumber: contest.contestNumber });

  logger.info`created contest #${createdContest.contestNumber}`;

  // Insert problems from JSON files
  for (const label of LABELS) {
    const filePath = resolve(PROBLEMS_DIR, `${label}.json`);
    const data: ProblemData = JSON.parse(readFileSync(filePath, "utf-8"));

    const slug = `${createdContest.contestNumber}${label}`;
    const title = data.name.replace(/^\d+_[A-Z]\.\s*/, ""); // strip "1060_A. " prefix

    const [createdProblem] = await db
      .insert(problem)
      .values({
        contestId: createdContest.id,
        label,
        slug,
        title,
        description: data.description,
        difficulty: data.difficulty,
        score: 100,
        visibleFrom: startTime,
        timeLimitMs: 1000,
        memoryLimitMb: 256,
      })
      .returning({ id: problem.id });

    logger.info`  ${slug}: ${title}`;

    // Insert test cases
    const testCases: (typeof testCase.$inferInsert)[] = [];
    let order = 0;

    // Public tests (sample = true)
    for (let i = 0; i < data.public_tests.input.length; i++) {
      testCases.push({
        problemId: createdProblem.id,
        input: data.public_tests.input[i],
        expectedOutput: data.public_tests.output[i],
        isSample: true,
        order: order++,
      });
    }

    // Private tests
    for (let i = 0; i < data.private_tests.input.length; i++) {
      testCases.push({
        problemId: createdProblem.id,
        input: data.private_tests.input[i],
        expectedOutput: data.private_tests.output[i],
        isSample: false,
        order: order++,
      });
    }

    await db.insert(testCase).values(testCases);

    // Insert tags
    for (const tagName of data.cf_tags) {
      const [t] = await db
        .insert(tag)
        .values({ name: tagName })
        .onConflictDoNothing()
        .returning({ id: tag.id });
      // If conflict, fetch existing
      const tagId =
        t?.id ??
        (
          await db
            .select({ id: tag.id })
            .from(tag)
            .where(eq(tag.name, tagName))
            .limit(1)
        )[0].id;
      await db.insert(problemTag).values({
        problemId: createdProblem.id,
        tagId,
      });
    }

    logger.info`    ${testCases.length} test cases, ${data.cf_tags.length} tags`;
  }

  // Fetch and seed languages from execution engine
  const engineUrl = process.env.ENGINE_URL ?? "http://localhost:8080";
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
