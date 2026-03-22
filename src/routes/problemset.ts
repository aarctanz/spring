import { Elysia, t } from "elysia";
import { authPlugin } from "../auth";
import * as problemService from "../services/problem";

export const problemsetRoutes = new Elysia({ prefix: "/problemset" })
  .use(authPlugin)

  // List all visible problems
  .get(
    "/",
    async ({ user }) => {
      return problemService.getVisibleProblems(user?.id ?? null);
    },
    { auth: true }
  )

  // Get problem by slug with sample test cases (e.g. 1000A)
  .get(
    "/:slug",
    async ({ params, set, user }) => {
      const problem = await problemService.getProblemBySlug(
        params.slug,
        user?.id ?? null
      );
      if (!problem) {
        set.status = 404;
        return { error: "Problem not found" };
      }
      return problem;
    },
    {
      auth: true,
      params: t.Object({ slug: t.String() }),
    }
  );
