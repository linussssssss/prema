import { pino } from "pino";

/** JSON logs to stdout, ISO timestamps, no pid/hostname noise. */
export const logger = pino({
  base: null,
  timestamp: pino.stdTimeFunctions.isoTime,
  level: process.env.LOG_LEVEL ?? "info",
});
