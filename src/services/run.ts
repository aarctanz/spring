import { eq, and, asc } from "drizzle-orm";
import { db } from "../db";
import { problem, testCase, language } from "../db/schema";
import * as exec0 from "../lib/exec0";

export async function runAgainstSamples(
  slug: string,
  engineLanguageId: number,
  sourceCode: string
) {
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
  if (!lang) throw new RunError(400, "Invalid or inactive language");

  // Fetch problem
  const [prob] = await db
    .select({
      id: problem.id,
      timeLimitMs: problem.timeLimitMs,
      memoryLimitMb: problem.memoryLimitMb,
      visibleFrom: problem.visibleFrom,
    })
    .from(problem)
    .where(eq(problem.slug, slug))
    .limit(1);
  if (!prob) throw new RunError(404, "Problem not found");
  if (prob.visibleFrom && prob.visibleFrom > new Date())
    throw new RunError(404, "Problem not found");

  // Fetch sample test cases
  const samples = await db
    .select({ input: testCase.input, expectedOutput: testCase.expectedOutput })
    .from(testCase)
    .where(and(eq(testCase.problemId, prob.id), eq(testCase.isSample, true)))
    .orderBy(asc(testCase.order));

  if (samples.length === 0) throw new RunError(404, "No sample test cases");

  // Single sample entry — use single submission mode
  if (samples.length === 1) {
    const { id } = await exec0.createSubmission({
      language_id: engineLanguageId,
      source_code: sourceCode,
      stdin: samples[0].input,
      expected_output: samples[0].expectedOutput,
      cpu_time_limit: prob.timeLimitMs / 1000,
      wall_time_limit: (prob.timeLimitMs / 1000) * 2,
      memory_limit: prob.memoryLimitMb * 1024,
    });
    const result = await exec0.pollSubmission(id);
    return formatResult(result);
  }

  // Multiple samples — use batch mode
  const { id } = await exec0.createBatchSubmission({
    language_id: engineLanguageId,
    source_code: sourceCode,
    test_cases: samples.map((s) => ({
      stdin: s.input,
      expected_output: s.expectedOutput,
    })),
    cpu_time_limit: prob.timeLimitMs / 1000,
    wall_time_limit: (prob.timeLimitMs / 1000) * 2,
    memory_limit: prob.memoryLimitMb * 1024,
  });
  const result = await exec0.pollSubmission(id);
  return formatResult(result);
}

function formatResult(sub: exec0.SubmissionResponse) {
  return {
    status: sub.status,
    time: sub.time,
    memory: sub.memory,
    compileOutput: sub.compile_output || null,
    testCases: sub.test_cases.map((tc) => ({
      position: tc.position,
      status: tc.status,
      stdin: tc.stdin,
      expectedOutput: tc.expected_output,
      stdout: tc.stdout,
      stderr: tc.stderr,
      time: tc.time,
      memory: tc.memory,
    })),
  };
}

export class RunError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
  }
}
