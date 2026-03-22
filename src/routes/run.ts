import { Elysia, t } from "elysia";
import { authPlugin } from "../auth";
import { runAgainstSamples, RunError } from "../services/run";

export const runRoutes = new Elysia().use(authPlugin).post(
  "/run",
  async ({ body, set }) => {
    try {
      return await runAgainstSamples(
        body.slug,
        body.engineLanguageId,
        body.sourceCode
      );
    } catch (err) {
      if (err instanceof RunError) {
        set.status = err.statusCode;
        return { error: err.message };
      }
      set.status = 500;
      return { error: "Code execution failed. Please try again." };
    }
  },
  {
    auth: true,
    body: t.Object({
      slug: t.String(),
      engineLanguageId: t.Number(),
      sourceCode: t.String(),
    }),
  }
);
