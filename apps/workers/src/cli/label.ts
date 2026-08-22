import { createDb, databaseUrlFromEnv } from "@verdict/schema";
import { computeLabels } from "../label/compute.ts";
import { logger } from "../lib/log.ts";

const handle = await createDb(databaseUrlFromEnv());
try {
  logger.info(await computeLabels(handle.db), "labeling finished");
} finally {
  await handle.close();
}
