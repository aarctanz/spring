import {
  configure,
  getConsoleSink,
  getAnsiColorFormatter,
  getJsonLinesFormatter,
  getLogger,
} from "@logtape/logtape";

const isDev = process.env.NODE_ENV !== "production";

export async function setupLogger() {
  await configure({
    sinks: {
      console: getConsoleSink({
        formatter: isDev
          ? getAnsiColorFormatter({ timestamp: "date-time" })
          : getJsonLinesFormatter(),
      }),
    },
    loggers: [
      {
        category: ["logtape", "meta"],
        lowestLevel: "warning",
        sinks: ["console"],
      },
      {
        category: ["spring"],
        lowestLevel: isDev ? "debug" : "info",
        sinks: ["console"],
      },
      {
        category: ["elysia"],
        lowestLevel: "info",
        sinks: ["console"],
      },
    ],
  });
}

export const logger = getLogger(["spring"]);
