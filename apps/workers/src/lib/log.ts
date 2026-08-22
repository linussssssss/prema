import { pino } from "pino";

/** JSON logs to stdout, ISO timestamps, no pid/hostname noise. */
export const logger = pino({
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  level: process.env.LOG_LEVEL ?? "info",
});
