import { eq, desc } from "drizzle-orm";
import { db } from "../db";
import { contest } from "../db/schema";

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
