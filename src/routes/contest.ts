import { Elysia, t } from "elysia";
import { authPlugin } from "../auth";
import * as contestService from "../services/contest";

export const contestRoutes = new Elysia({ prefix: "/contests" })
  .use(authPlugin)

  // List all contests
  .get("/", async () => {
    return contestService.getAllContests();
  })

  // Get contest by number with its problems
  .get(
    "/:contestNumber",
    async ({ params, set, user }) => {
      const result = await contestService.getContestWithProblems(
        params.contestNumber,
        user?.id ?? null
      );
      if (!result) {
        set.status = 404;
        return { error: "Contest not found" };
      }
      return result;
    },
    {
      auth: true,
      params: t.Object({ contestNumber: t.Number() }),
    }
  )

  // Get contest leaderboard (only available after contest ends)
  .get(
    "/:contestNumber/leaderboard",
    async ({ params, query, user, set }) => {
      const contest = await contestService.getContestByNumber(
        params.contestNumber
      );
      if (!contest) {
        set.status = 404;
        return { error: "Contest not found" };
      }
      const result = await contestService.getLeaderboard(
        contest.id,
        user.id,
        query.page,
        query.pageSize,
      );
      if (result && !result.ended) {
        set.status = 403;
        return { error: "Leaderboard available after contest ends" };
      }
      return result;
    },
    {
      auth: true,
      params: t.Object({ contestNumber: t.Number() }),
      query: t.Object({
        page: t.Number({ default: 1 }),
        pageSize: t.Number({ default: 50 }),
      }),
    }
  );
