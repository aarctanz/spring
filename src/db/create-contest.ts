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

type TestCaseList =
  | { input: string; output: string }[]
  | { input: string[]; output: string[] };

interface ProblemData {
  title: string;
  description: string;
  difficulty: number;
  score: number;
  timeLimitMs?: number;
  memoryLimitMb?: number;
  tags?: string[];
  publicTests: TestCaseList;
  privateTests: TestCaseList;
}

function normalizeTests(tests: TestCaseList): { input: string; output: string }[] {
  if (Array.isArray(tests)) return tests;
  return tests.input.map((input, i) => ({ input, output: tests.output[i] }));
}

function parseArgs() {
  const args = process.argv.slice(2);
  let dir: string | null = null;
  let contestOnly = false;
  let contestNumber: number | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--contest") {
      contestOnly = true;
    } else if (args[i] === "--contestnumber") {
      contestNumber = parseInt(args[++i]);
    } else if (!args[i].startsWith("-")) {
      dir = args[i];
    }
  }

  if (!dir) {
    console.error(
      "Usage:\n" +
      "  bun run src/db/create-contest.ts <dir>              # full contest + problems\n" +
      "  bun run src/db/create-contest.ts <dir> --contest     # contest schedule only\n" +
      "  bun run src/db/create-contest.ts <dir> --contestnumber <number>  # add problems to existing contest"
    );
    process.exit(1);
  }

  return { dir: resolve(dir), contestOnly, contestNumber };
}

function loadProblemFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => /^[a-zA-Z]\.json$/.test(f))
    .sort();
}

async function insertProblems(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  dir: string,
  contestId: string,
  contestNumber: number,
  startTime: Date,
  problemFiles: string[],
) {
  for (const file of problemFiles) {
    const label = file.replace(".json", "").toUpperCase();
    const data: ProblemData = JSON.parse(readFileSync(resolve(dir, file), "utf-8"));

    const slug = `${contestNumber}${label}`;

    const [createdProblem] = await tx
      .insert(problem)
      .values({
        contestId,
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

    for (const tc of normalizeTests(data.publicTests)) {
      testCases.push({
        problemId: createdProblem.id,
        input: tc.input,
        expectedOutput: tc.output,
        isSample: true,
        order: order++,
      });
    }

    for (const tc of normalizeTests(data.privateTests)) {
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
}

async function run() {
  await setupLogger();
  const { dir, contestOnly, contestNumber: existingContestNumber } = parseArgs();

  logger.info`loading from ${dir}`;

  // Mode: add problems to existing contest
  if (existingContestNumber) {
    const [existing] = await db
      .select({ id: contest.id, contestNumber: contest.contestNumber, startTime: contest.startTime })
      .from(contest)
      .where(eq(contest.contestNumber, existingContestNumber))
      .limit(1);

    if (!existing) throw new Error(`Contest #${existingContestNumber} not found`);

    const problemFiles = loadProblemFiles(dir);
    if (problemFiles.length === 0) throw new Error("No problem files found (expected a.json, b.json, etc.)");

    logger.info`adding ${problemFiles.length} problems to contest #${existing.contestNumber}`;

    await db.transaction(async (tx) => {
      await insertProblems(tx, dir, existing.id, existing.contestNumber, existing.startTime, problemFiles);
    });

    logger.info`done! added ${problemFiles.length} problems to contest #${existing.contestNumber}`;
    return;
  }

  // Load contest.json
  const contestData: ContestData = JSON.parse(
    readFileSync(resolve(dir, "contest.json"), "utf-8")
  );

  const startTime = new Date(contestData.startTime);
  const endTime = new Date(startTime.getTime() + contestData.durationMinutes * 60 * 1000);

  // Mode: contest schedule only
  if (contestOnly) {
    const [created] = await db
      .insert(contest)
      .values({ title: contestData.title, description: contestData.description, startTime, endTime })
      .returning({ id: contest.id, contestNumber: contest.contestNumber });

    logger.info`created contest #${created.contestNumber}: "${contestData.title}"`;
    logger.info`  id:    ${created.id}`;
    logger.info`  start: ${startTime.toISOString()}`;
    logger.info`  end:   ${endTime.toISOString()} (${contestData.durationMinutes} min)`;
    logger.info`done! use --contestnumber ${created.contestNumber} to add problems later`;
    return;
  }

  // Mode: full contest + problems (default)
  const problemFiles = loadProblemFiles(dir);
  if (problemFiles.length === 0) {
    throw new Error("No problem files found (expected a.json, b.json, etc.)");
  }

  logger.info`found ${problemFiles.length} problems: ${problemFiles.join(", ")}`;

  const result = await db.transaction(async (tx) => {
    const [createdContest] = await tx
      .insert(contest)
      .values({ title: contestData.title, description: contestData.description, startTime, endTime })
      .returning({ id: contest.id, contestNumber: contest.contestNumber });

    logger.info`created contest #${createdContest.contestNumber}: "${contestData.title}"`;
    logger.info`  start: ${startTime.toISOString()}`;
    logger.info`  end:   ${endTime.toISOString()} (${contestData.durationMinutes} min)`;

    await insertProblems(tx, dir, createdContest.id, createdContest.contestNumber, startTime, problemFiles);

    return createdContest;
  });

  logger.info`done! contest #${result.contestNumber} created with ${problemFiles.length} problems`;
}

run()
  .catch((err) => {
    logger.error`failed: ${err instanceof Error ? err.message : err}`;
    process.exit(1);
  })
  .finally(() => client.end());
