import { parseArgs } from "node:util";
import { createDb, databaseUrlFromEnv } from "@verdict/schema";
import { snapshotTopMarkets } from "../clob/snapshot.ts";
import { logger } from "../lib/log.ts";

const { values } = parseArgs({ options: { top: { type: "string", default: "200" } } });

const handle = await createDb(databaseUrlFromEnv());
try {
  logger.info(await snapshotTopMarkets(handle.db, { topN: Number(values.top) }), "clob snapshot finished");
} finally {
  await handle.close();
}
