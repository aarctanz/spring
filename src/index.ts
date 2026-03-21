import { Elysia } from "elysia";
import { openapi } from "@elysiajs/openapi";
import { elysiaLogger } from "@logtape/elysia";
import { setupLogger, logger } from "./lib/logger";
import { connect, client } from "./db";
import { authPlugin, authOpenAPI } from "./auth";
import { cors } from "./middleware/cors";
import { contestRoutes } from "./routes/contest";
import { problemsetRoutes } from "./routes/problemset";
import { languageRoutes } from "./routes/language";
import { runRoutes } from "./routes/run";

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
          title: "Spring API",
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
  .get("/", () => "Hello Elysia")
  .listen(Number(process.env.PORT ?? 3000));

logger.info`server running at ${app.server?.hostname}:${app.server?.port}`;
