import { eq, desc, asc, sql, and, count, lte, inArray } from "drizzle-orm";
import { db } from "../db";
import { contest, submission, problem, user, leaderboardEntry, problemTag, tag, userProblemSolved } from "../db/schema";

const WRONG_ATTEMPT_PENALTY = 50;
const DEFAULT_PAGE_SIZE = 50;

const contestColumns = {
  contestNumber: contest.contestNumber,
  title: contest.title,
  description: contest.description,
  startTime: contest.startTime,
  endTime: contest.endTime,
};

export async function getAllContests() {
  return db
    .select(contestColumns)
    .from(contest)
    .orderBy(desc(contest.contestNumber));
}

export async function getContestByNumber(contestNumber: number) {
  const [row] = await db
    .select({ id: contest.id, ...contestColumns })
    .from(contest)
    .where(eq(contest.contestNumber, contestNumber))
    .limit(1);
  return row ?? null;
}

export async function getContestWithProblems(contestNumber: number, userId: string | null = null) {
  const c = await getContestByNumber(contestNumber);
  if (!c) return null;

  const problemRows = await db
    .select({
      id: problem.id,
      slug: problem.slug,
      label: problem.label,
      title: problem.title,
      difficulty: problem.difficulty,
      score: problem.score,
    })
    .from(problem)
    .where(and(eq(problem.contestId, c.id), lte(problem.visibleFrom, new Date())))
    .orderBy(problem.label);

  const { id: _, ...contestRest } = c;

  if (new Date() < c.startTime) {
    return { ...contestRest, problems: [] };
  }

  if (problemRows.length === 0) {
    return { ...contestRest, problems: [] };
  }

  const problemIds = problemRows.map(p => p.id);

  const [tagsRows, solvedRows] = await Promise.all([
    db
      .select({ problemId: problemTag.problemId, name: tag.name })
      .from(problemTag)
      .innerJoin(tag, eq(problemTag.tagId, tag.id))
      .where(inArray(problemTag.problemId, problemIds)),
    userId
      ? db
          .select({ problemId: userProblemSolved.problemId })
          .from(userProblemSolved)
          .where(and(eq(userProblemSolved.userId, userId), inArray(userProblemSolved.problemId, problemIds)))
      : Promise.resolve([]),
  ]);

  const tagsMap = new Map<string, string[]>();
  for (const row of tagsRows) {
    const existing = tagsMap.get(row.problemId) ?? [];
    existing.push(row.name);
    tagsMap.set(row.problemId, existing);
  }

  const solvedSet = new Set((solvedRows as { problemId: string }[]).map(r => r.problemId));

  return {
    ...contestRest,
    problems: problemRows.map(({ id, ...p }) => ({
      ...p,
      solved: solvedSet.has(id),
      tags: tagsMap.get(id) ?? [],
    })),
  };
}

const leaderboardColumns = {
  rank: leaderboardEntry.rank,
  totalScore: leaderboardEntry.totalScore,
  penalty: leaderboardEntry.penalty,
  problemsSolved: leaderboardEntry.problemsSolved,
  lastAcceptedAt: leaderboardEntry.lastAcceptedAt,
  breakdown: leaderboardEntry.breakdown,
  name: user.name,
  rollNumber: user.rollNumber,
  image: user.image,
};

function formatEntry(row: typeof leaderboardColumns extends infer T ? { [K in keyof T]: any } : never) {
  return { ...row, breakdown: JSON.parse(row.breakdown) };
}

export async function getLeaderboard(
  contestId: string,
  userId: string,
  page: number = 1,
  pageSize: number = DEFAULT_PAGE_SIZE,
) {
  const [c] = await db
    .select({ endTime: contest.endTime })
    .from(contest)
    .where(eq(contest.id, contestId))
    .limit(1);

  if (!c) return null;
  if (new Date() < c.endTime) return { ended: false };

  // Generate leaderboard if not already done
  const [{ total: existing }] = await db
    .select({ total: count() })
    .from(leaderboardEntry)
    .where(eq(leaderboardEntry.contestId, contestId));

  if (existing === 0) {
    await generateLeaderboard(contestId);
  }

  const [{ total }] = await db
    .select({ total: count() })
    .from(leaderboardEntry)
    .where(eq(leaderboardEntry.contestId, contestId));

  // Fetch current user's entry
  const [currentUser] = await db
    .select(leaderboardColumns)
    .from(leaderboardEntry)
    .innerJoin(user, eq(leaderboardEntry.userId, user.id))
    .where(and(eq(leaderboardEntry.contestId, contestId), eq(leaderboardEntry.userId, userId)))
    .limit(1);

  // Fetch paginated standings
  const offset = (page - 1) * pageSize;
  const standings = await db
    .select(leaderboardColumns)
    .from(leaderboardEntry)
    .innerJoin(user, eq(leaderboardEntry.userId, user.id))
    .where(eq(leaderboardEntry.contestId, contestId))
    .orderBy(asc(leaderboardEntry.rank))
    .limit(pageSize)
    .offset(offset);

  return {
    ended: true,
    currentUser: currentUser ? formatEntry(currentUser) : null,
    standings: standings.map(formatEntry),
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  };
}

export async function generateLeaderboard(contestId: string) {
  // Per-user per-problem breakdown
  const breakdown = await db.execute(sql`
    SELECT
      s.user_id,
      p.label,
      p.slug,
      p.score AS max_score,
      bool_or(s.status = 'accepted') AS solved,
      COUNT(*) FILTER (WHERE s.status != 'accepted' AND s.created_at < COALESCE(
        (SELECT MIN(s2.created_at) FROM submission s2
         WHERE s2.user_id = s.user_id
           AND s2.problem_id = s.problem_id
           AND s2.contest_id = ${contestId}
           AND s2.status = 'accepted'),
        'infinity'
      ))::int AS wrong_attempts,
      MIN(CASE WHEN s.status = 'accepted' THEN s.created_at END) AS first_ac_time,
      COUNT(*)::int AS attempts
    FROM submission s
    INNER JOIN problem p ON p.id = s.problem_id
    WHERE s.contest_id = ${contestId}
    GROUP BY s.user_id, p.label, p.slug, p.score
    ORDER BY p.label
  `);

  // Build per-user breakdown and scores
  const userScores = new Map<string, { totalScore: number; penalty: number; problemsSolved: number; lastAcTime: Date | null; problems: any[] }>();

  for (const row of breakdown as any[]) {
    const userId = row.user_id as string;
    if (!userScores.has(userId)) {
      userScores.set(userId, { totalScore: 0, penalty: 0, problemsSolved: 0, lastAcTime: null, problems: [] });
    }
    const entry = userScores.get(userId)!;
    const solved = row.solved as boolean;
    const wrongAttempts = row.wrong_attempts as number;
    const maxScore = row.max_score as number;
    const penaltyAmount = solved ? wrongAttempts * WRONG_ATTEMPT_PENALTY : 0;
    const score = solved ? Math.max(maxScore - penaltyAmount, 0) : 0;

    entry.problems.push({
      label: row.label,
      slug: row.slug,
      solved,
      score,
      wrongAttempts,
      firstAcTime: row.first_ac_time,
      attempts: row.attempts,
    });

    if (solved) {
      entry.totalScore += score;
      entry.penalty += penaltyAmount;
      entry.problemsSolved += 1;
      const acTime = new Date(row.first_ac_time as string);
      if (!entry.lastAcTime || acTime > entry.lastAcTime) {
        entry.lastAcTime = acTime;
      }
    }
  }

  // Sort by score desc, then last AC time asc
  const sorted = [...userScores.entries()].sort((a, b) => {
    if (b[1].totalScore !== a[1].totalScore) return b[1].totalScore - a[1].totalScore;
    const aTime = a[1].lastAcTime?.getTime() ?? Infinity;
    const bTime = b[1].lastAcTime?.getTime() ?? Infinity;
    return aTime - bTime;
  });

  // Assign ranks and insert
  let rank = 0;
  let prevScore = -1;
  const entries: (typeof leaderboardEntry.$inferInsert)[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const [userId, data] = sorted[i];
    if (data.totalScore !== prevScore) {
      rank = i + 1;
      prevScore = data.totalScore;
    }
    entries.push({
      contestId,
      userId,
      rank,
      totalScore: data.totalScore,
      penalty: data.penalty,
      problemsSolved: data.problemsSolved,
      lastAcceptedAt: data.lastAcTime,
      breakdown: JSON.stringify(data.problems),
    });
  }

  if (entries.length > 0) {
    await db.insert(leaderboardEntry).values(entries);
  }
}
