import { Elysia, t } from "elysia";
import * as contestService from "../services/contest";
import * as problemService from "../services/problem";

export const contestRoutes = new Elysia({ prefix: "/contests" })

  // List all contests
  .get("/", async () => {
    return contestService.getAllContests();
  })

  // Get contest by number with its problems
  .get(
    "/:contestNumber",
    async ({ params, set }) => {
      const contest = await contestService.getContestByNumber(
        params.contestNumber
      );
      if (!contest) {
        set.status = 404;
        return { error: "Contest not found" };
      }
      const problems = await problemService.getProblemsByContest(contest.id);
      const { id: _, ...rest } = contest;
      return { ...rest, problems };
    },
    {
      params: t.Object({ contestNumber: t.Number() }),
    }
  );
