import { Elysia, t } from "elysia";
import { runAgainstSamples, RunError } from "../services/run";

export const runRoutes = new Elysia().post(
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
      throw err;
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
