import { Elysia, t } from "elysia";
import { authPlugin } from "../auth";
import * as contestService from "../services/contest";
import * as problemService from "../services/problem";

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
      const contest = await contestService.getContestByNumber(
        params.contestNumber
      );
      if (!contest) {
        set.status = 404;
        return { error: "Contest not found" };
      }
      const problems = await problemService.getProblemsByContest(
        contest.id,
        user?.id ?? null
      );
      const { id: _, ...rest } = contest;
      return { ...rest, problems };
    },
    {
      auth: true,
      params: t.Object({ contestNumber: t.Number() }),
    }
  );
