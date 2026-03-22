import { eq, lte, desc, asc, and, inArray } from "drizzle-orm";
import { db } from "../db";
import { problem, testCase, problemTag, tag, userProblemSolved } from "../db/schema";

const problemColumns = {
  slug: problem.slug,
  label: problem.label,
  title: problem.title,
  description: problem.description,
  difficulty: problem.difficulty,
  score: problem.score,
  timeLimitMs: problem.timeLimitMs,
  memoryLimitMb: problem.memoryLimitMb,
  visibleFrom: problem.visibleFrom,
};

const testCaseColumns = {
  input: testCase.input,
  expectedOutput: testCase.expectedOutput,
  order: testCase.order,
};

async function getTagsForProblem(problemId: string) {
  const rows = await db
    .select({ name: tag.name })
    .from(problemTag)
    .innerJoin(tag, eq(problemTag.tagId, tag.id))
    .where(eq(problemTag.problemId, problemId));
  return rows.map((r) => r.name);
}

async function getSolvedSet(userId: string | null, problemIds: string[]): Promise<Set<string>> {
  if (!userId || problemIds.length === 0) return new Set();
  const rows = await db
    .select({ problemId: userProblemSolved.problemId })
    .from(userProblemSolved)
    .where(
      and(
        eq(userProblemSolved.userId, userId),
        inArray(userProblemSolved.problemId, problemIds)
      )
    );
  return new Set(rows.map((r) => r.problemId));
}

export async function getVisibleProblems(userId: string | null = null) {
  const rows = await db
    .select({ id: problem.id, ...problemColumns })
    .from(problem)
    .where(lte(problem.visibleFrom, new Date()))
    .orderBy(desc(problem.visibleFrom));

  const [solvedSet] = await Promise.all([
    getSolvedSet(userId, rows.map((r) => r.id)),
  ]);

  return Promise.all(
    rows.map(async ({ id, ...rest }) => ({
      ...rest,
      solved: solvedSet.has(id),
      tags: await getTagsForProblem(id),
    }))
  );
}

export async function getProblemBySlug(slug: string, userId: string | null = null) {
  const [row] = await db
    .select({ id: problem.id, ...problemColumns })
    .from(problem)
    .where(eq(problem.slug, slug))
    .limit(1);
  if (!row) return null;

  if (row.visibleFrom && row.visibleFrom > new Date()) return null;

  const [sampleTestCases, tags, solvedSet] = await Promise.all([
    db
      .select(testCaseColumns)
      .from(testCase)
      .where(
        and(eq(testCase.problemId, row.id), eq(testCase.isSample, true))
      )
      .orderBy(asc(testCase.order)),
    getTagsForProblem(row.id),
    getSolvedSet(userId, [row.id]),
  ]);

  const { id: _, ...rest } = row;
  return { ...rest, solved: solvedSet.has(row.id), tags, testCases: sampleTestCases };
}

export async function getProblemsByContest(contestId: string, userId: string | null = null) {
  const rows = await db
    .select({ id: problem.id, ...problemColumns })
    .from(problem)
    .where(eq(problem.contestId, contestId))
    .orderBy(problem.label);

  const solvedSet = await getSolvedSet(userId, rows.map((r) => r.id));

  return Promise.all(
    rows.map(async ({ id, ...rest }) => ({
      ...rest,
      solved: solvedSet.has(id),
      tags: await getTagsForProblem(id),
    }))
  );
}
