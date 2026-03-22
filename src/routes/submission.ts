import { Elysia, t } from "elysia";
import { authPlugin } from "../auth";
import * as submissionService from "../services/submission";

export const submissionRoutes = new Elysia({ prefix: "/submissions" })
  .use(authPlugin)

  // List current user's submissions
  .get(
    "/",
    async ({ user }) => {
      return submissionService.getUserSubmissions(user.id);
    },
    { auth: true }
  )

  // Get submission detail (own only)
  .get(
    "/:id",
    async ({ params, user, set }) => {
      const sub = await submissionService.getSubmissionById(
        params.id,
        user.id
      );
      if (!sub) {
        set.status = 404;
        return { error: "Submission not found" };
      }
      return sub;
    },
    {
      auth: true,
      params: t.Object({ id: t.String() }),
    }
  );
