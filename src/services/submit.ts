import { eq, and, asc } from "drizzle-orm";
import { getLogger } from "@logtape/logtape";
import { db } from "../db";
import {
  problem,
  contest,
  testCase,
  language,
  submission,
  submissionTestResult,
  userProblemSolved,
} from "../db/schema";
import * as exec0 from "../lib/exec0";

const logger = getLogger(["spring", "submit"]);

export class SubmitError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
  }
}

export async function createSubmission(
  userId: string,
  slug: string,
  engineLanguageId: number,
  sourceCode: string
): Promise<string> {
  // Validate language
  const [lang] = await db
    .select({ id: language.id })
    .from(language)
    .where(
      and(
        eq(language.engineLanguageId, engineLanguageId),
        eq(language.isActive, true)
      )
    )
    .limit(1);
  if (!lang) throw new SubmitError(400, "Invalid or inactive language");

  // Fetch problem + contest window
  const [prob] = await db
    .select({
      id: problem.id,
      contestId: problem.contestId,
      score: problem.score,
      timeLimitMs: problem.timeLimitMs,
      memoryLimitMb: problem.memoryLimitMb,
      visibleFrom: problem.visibleFrom,
      contestStart: contest.startTime,
      contestEnd: contest.endTime,
    })
    .from(problem)
    .innerJoin(contest, eq(problem.contestId, contest.id))
    .where(eq(problem.slug, slug))
    .limit(1);
  if (!prob) throw new SubmitError(404, "Problem not found");
  if (prob.visibleFrom && prob.visibleFrom > new Date())
    throw new SubmitError(404, "Problem not found");

  // Tag as contest submission if within contest window
  const now = new Date();
  const isContestSubmission =
    now >= prob.contestStart && now <= prob.contestEnd;

  // Fetch ALL test cases
  const allTestCases = await db
    .select({ input: testCase.input, expectedOutput: testCase.expectedOutput })
    .from(testCase)
    .where(eq(testCase.problemId, prob.id))
    .orderBy(asc(testCase.order));

  if (allTestCases.length === 0)
    throw new SubmitError(500, "No test cases found");

  // Create submission row
  const [sub] = await db
    .insert(submission)
    .values({
      userId,
      problemId: prob.id,
      contestId: isContestSubmission ? prob.contestId : null,
      engineLanguageId,
      sourceCode,
      status: "pending",
    })
    .returning({ id: submission.id });

  // Send to exec0
  const { id: exec0Id } = await exec0.createBatchSubmission({
    language_id: engineLanguageId,
    source_code: sourceCode,
    test_cases: allTestCases.map((tc) => ({
      stdin: tc.input,
      expected_output: tc.expectedOutput,
    })),
    cpu_time_limit: prob.timeLimitMs / 1000,
    wall_time_limit: (prob.timeLimitMs / 1000) * 2,
    memory_limit: prob.memoryLimitMb * 1024,
  });

  // Store exec0 ID
  await db
    .update(submission)
    .set({ exec0Id })
    .where(eq(submission.id, sub.id));

  // Background poll — fire and forget
  pollAndSave(sub.id, exec0Id, prob.score, userId, prob.id).catch(async (err) => {
    logger.error`failed to poll submission ${sub.id}: ${err instanceof Error ? err.message : err}`;
    await db
      .update(submission)
      .set({ status: "internal_error" })
      .where(eq(submission.id, sub.id));
  });

  return sub.id;
}

async function pollAndSave(
  submissionId: string,
  exec0Id: number,
  problemScore: number,
  userId: string,
  problemId: string,
) {
  const result = await exec0.pollSubmission(exec0Id);

  // Save test case results
  if (result.test_cases.length > 0) {
    await db.insert(submissionTestResult).values(
      result.test_cases.map((tc) => ({
        submissionId,
        position: tc.position,
        status: tc.status as typeof submissionTestResult.$inferInsert.status,
        timeSec: tc.time,
        memoryKb: tc.memory,
        stdout: tc.stdout,
        stderr: tc.stderr,
        exitCode: tc.exit_code,
      }))
    );
  }

  // All-or-nothing scoring
  const score = result.status === "accepted" ? problemScore : 0;

  // Update submission
  await db
    .update(submission)
    .set({
      status: result.status as typeof submission.$inferInsert.status,
      score,
      timeSec: result.time,
      memoryKb: result.memory,
      compileOutput: result.compile_output || null,
    })
    .where(eq(submission.id, submissionId));

  // Mark problem as solved on first AC
  if (result.status === "accepted") {
    await db
      .insert(userProblemSolved)
      .values({ userId, problemId })
      .onConflictDoNothing();
  }

  logger.info`submission ${submissionId} completed: ${result.status} (score: ${score})`;
}
