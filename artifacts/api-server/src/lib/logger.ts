/**
 * Shared pino logger for the api-server.
 *
 * Level comes from `LOG_LEVEL` (default `info`). Sensitive request/response
 * headers (authorization, cookie, set-cookie) are always redacted so secrets
 * never reach the logs. In non-production it pretty-prints via `pino-pretty`;
 * in production it emits structured JSON for log aggregation.
 */
import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
