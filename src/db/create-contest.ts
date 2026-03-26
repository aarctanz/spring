import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { eq } from "drizzle-orm";
import { db, client } from "./index";
import { contest, problem, testCase, tag, problemTag } from "./schema";
import { setupLogger, logger } from "../lib/logger";

interface ContestData {
  title: string;
  description?: string;
  startTime: string; // ISO 8601
  durationMinutes: number;
}

interface ProblemData {
  title: string;
  description: string;
  difficulty: number;
  score: number;
  timeLimitMs?: number;
  memoryLimitMb?: number;
  tags?: string[];
  publicTests: { input: string; output: string }[];
  privateTests: { input: string; output: string }[];
}

async function createContest(contestDir: string) {
  await setupLogger();

  const dir = resolve(contestDir);
  logger.info`loading contest from ${dir}`;

  // Load contest.json
  const contestData: ContestData = JSON.parse(
    readFileSync(resolve(dir, "contest.json"), "utf-8")
  );

  const startTime = new Date(contestData.startTime);
  const endTime = new Date(startTime.getTime() + contestData.durationMinutes * 60 * 1000);

  // Find problem files (a.json, b.json, etc.)
  const problemFiles = readdirSync(dir)
    .filter((f) => /^[a-zA-Z]\.json$/.test(f))
    .sort();

  if (problemFiles.length === 0) {
    throw new Error("No problem files found (expected a.json, b.json, etc.)");
  }

  logger.info`found ${problemFiles.length} problems: ${problemFiles.join(", ")}`;

  // Insert contest + problems in a transaction
  const result = await db.transaction(async (tx) => {
    const [createdContest] = await tx
      .insert(contest)
      .values({
        title: contestData.title,
        description: contestData.description,
        startTime,
        endTime,
      })
      .returning({ id: contest.id, contestNumber: contest.contestNumber });

    logger.info`created contest #${createdContest.contestNumber}: "${contestData.title}"`;
    logger.info`  start: ${startTime.toISOString()}`;
    logger.info`  end:   ${endTime.toISOString()} (${contestData.durationMinutes} min)`;

    for (const file of problemFiles) {
      const label = file.replace(".json", "").toUpperCase();
      const data: ProblemData = JSON.parse(readFileSync(resolve(dir, file), "utf-8"));

      const slug = `${createdContest.contestNumber}${label}`;

      const [createdProblem] = await tx
        .insert(problem)
        .values({
          contestId: createdContest.id,
          label,
          slug,
          title: data.title,
          description: data.description,
          difficulty: data.difficulty,
          score: data.score,
          visibleFrom: startTime,
          timeLimitMs: data.timeLimitMs ?? 1000,
          memoryLimitMb: data.memoryLimitMb ?? 256,
        })
        .returning({ id: problem.id });

      // Insert test cases
      const testCases: (typeof testCase.$inferInsert)[] = [];
      let order = 0;

      for (const tc of data.publicTests) {
        testCases.push({
          problemId: createdProblem.id,
          input: tc.input,
          expectedOutput: tc.output,
          isSample: true,
          order: order++,
        });
      }

      for (const tc of data.privateTests) {
        testCases.push({
          problemId: createdProblem.id,
          input: tc.input,
          expectedOutput: tc.output,
          isSample: false,
          order: order++,
        });
      }

      await tx.insert(testCase).values(testCases);

      // Insert tags
      for (const tagName of data.tags ?? []) {
        const [t] = await tx
          .insert(tag)
          .values({ name: tagName })
          .onConflictDoNothing()
          .returning({ id: tag.id });
        const tagId =
          t?.id ??
          (await tx.select({ id: tag.id }).from(tag).where(eq(tag.name, tagName)).limit(1))[0].id;
        await tx.insert(problemTag).values({ problemId: createdProblem.id, tagId });
      }

      logger.info`  ${slug} (${label}): "${data.title}" — ${data.score}pts, ${testCases.length} tests, ${data.tags?.length ?? 0} tags`;
    }

    return createdContest;
  });

  logger.info`done! contest #${result.contestNumber} created with ${problemFiles.length} problems`;
}

const contestDir = process.argv[2];
if (!contestDir) {
  console.error("Usage: bun run src/db/create-contest.ts <contest-directory>");
  process.exit(1);
}

createContest(contestDir)
  .catch((err) => {
    logger.error`failed: ${err instanceof Error ? err.message : err}`;
    process.exit(1);
  })
  .finally(() => client.end());
