import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "@verdict/schema";
import { buildBlindStudy } from "./blind-study.ts";
import { logger } from "@verdict/workers";

loadEnv();
// Resolved from this file, not cwd: `pnpm --filter` runs the child inside
// data/, which would otherwise nest the output at data/data/blind.
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "blind");
const stats = await buildBlindStudy(outDir);
logger.info({ ...stats, outDir }, "blind study written (key.json must not reach the judge)");
