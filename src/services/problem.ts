import { eq, lte, desc, asc, and } from "drizzle-orm";
import { db } from "../db";
import { problem, testCase, problemTag, tag } from "../db/schema";

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

export async function getVisibleProblems() {
  const rows = await db
    .select({ id: problem.id, ...problemColumns })
    .from(problem)
    .where(lte(problem.visibleFrom, new Date()))
    .orderBy(desc(problem.visibleFrom));

  return Promise.all(
    rows.map(async ({ id, ...rest }) => ({
      ...rest,
      tags: await getTagsForProblem(id),
    }))
  );
}

export async function getProblemBySlug(slug: string) {
  const [row] = await db
    .select({ id: problem.id, ...problemColumns })
    .from(problem)
    .where(eq(problem.slug, slug))
    .limit(1);
  if (!row) return null;

  if (row.visibleFrom && row.visibleFrom > new Date()) return null;

  const [sampleTestCases, tags] = await Promise.all([
    db
      .select(testCaseColumns)
      .from(testCase)
      .where(
        and(eq(testCase.problemId, row.id), eq(testCase.isSample, true))
      )
      .orderBy(asc(testCase.order)),
    getTagsForProblem(row.id),
  ]);

  const { id: _, ...rest } = row;
  return { ...rest, tags, testCases: sampleTestCases };
}

export async function getProblemsByContest(contestId: string) {
  const rows = await db
    .select({ id: problem.id, ...problemColumns })
    .from(problem)
    .where(eq(problem.contestId, contestId))
    .orderBy(problem.label);

  return Promise.all(
    rows.map(async ({ id, ...rest }) => ({
      ...rest,
      tags: await getTagsForProblem(id),
    }))
  );
}
