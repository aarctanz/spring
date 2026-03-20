import type { Elysia } from "elysia";

export const cors = (app: Elysia) =>
  app
    .onBeforeHandle({ as: "global" }, ({ set }) => {
      const allowedOrigin = process.env.ALLOWED_ORIGIN;
      if (allowedOrigin) {
        set.headers["Access-Control-Allow-Origin"] = allowedOrigin;
        set.headers["Access-Control-Allow-Credentials"] = "true";
      }
    })
    .options("/*", ({ set }) => {
      const allowedOrigin = process.env.ALLOWED_ORIGIN;
      if (allowedOrigin) {
        set.headers["Access-Control-Allow-Origin"] = allowedOrigin;
        set.headers["Access-Control-Allow-Credentials"] = "true";
        set.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS";
        set.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
      }
      return new Response(null, { status: 204 });
    });
