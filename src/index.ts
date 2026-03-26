import { Elysia } from "elysia";
import { openapi } from "@elysiajs/openapi";
import { elysiaLogger } from "@logtape/elysia";
import { setupLogger, logger } from "./lib/logger";
import { connect, client, db } from "./db";
import { sql } from "drizzle-orm";
import { authPlugin, authOpenAPI } from "./auth";
import { cors } from "./middleware/cors";
import { contestRoutes } from "./routes/contest";
import { problemsetRoutes } from "./routes/problemset";
import { languageRoutes } from "./routes/language";
import { runRoutes } from "./routes/run";
import { submitRoutes } from "./routes/submit";
import { submissionRoutes } from "./routes/submission";
import { profileRoutes } from "./routes/profile";

await setupLogger();

try {
  await connect();
} catch (err) {
  logger.error`failed to connect to database: ${err instanceof Error ? err.message : err}`;
  await client.end();
  process.exit(1);
}

const app = new Elysia()
  .use(
    openapi({
      documentation: {
        info: {
          title: "Codespardha API",
          version: "1.0.0",
          description: "Placement helper system API for NIT Kurukshetra",
        },
        tags: [{ name: "Auth", description: "Authentication routes" }],
        components: await authOpenAPI.getComponents(),
        paths: await authOpenAPI.getPaths(),
      },
    })
  )
  .use(
    elysiaLogger({
      format: (ctx, responseTime) => ({
        ip: ctx.request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "-",
        method: ctx.request.method,
        url: ctx.path,
        status: ctx.set.status as number,
        responseTime: responseTime.toFixed(1),
      }),
    })
  )
  .use(cors)
  .use(authPlugin)
  .use(contestRoutes)
  .use(problemsetRoutes)
  .use(languageRoutes)
  .use(runRoutes)
  .use(submitRoutes)
  .use(submissionRoutes)
  .use(profileRoutes)
  .get("/", () => "Hello Elysia")
  .get("/time", () => ({ serverTime: new Date().toISOString() }))
  .get("/health", async ({ set }) => {
    const checks = { database: "disconnected", exec0: "disconnected" };

    try {
      await db.execute(sql`SELECT 1`);
      checks.database = "connected";
    } catch {}

    try {
      const res = await fetch(
        `${process.env.ENGINE_URL ?? "http://localhost:8080"}/health`,
        { signal: AbortSignal.timeout(3000) }
      );
      if (res.ok) checks.exec0 = "connected";
    } catch {}

    const healthy = checks.database === "connected" && checks.exec0 === "connected";
    if (!healthy) set.status = 503;
    return { status: healthy ? "healthy" : "unhealthy", ...checks };
  })
  .listen(Number(process.env.PORT ?? 3000));

logger.info`server running at ${app.server?.hostname}:${app.server?.port}`;
