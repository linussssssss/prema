import { parseArgs } from "node:util";
import { createDb, databaseUrlFromEnv, loadEnv } from "@verdict/schema";
import { indexEthereum, indexPolygon } from "../chain/indexer.ts";
import { logger } from "../lib/log.ts";

loadEnv();

const { values } = parseArgs({
  options: {
    chain: { type: "string", default: "all" }, // polygon | ethereum | all
    "max-blocks": { type: "string" },
  },
});

const maxBlocks = values["max-blocks"] ? BigInt(values["max-blocks"]) : undefined;
const handle = await createDb(databaseUrlFromEnv());
try {
  if (values.chain === "polygon" || values.chain === "all") {
    logger.info(await indexPolygon(handle.db, { maxBlocks }), "polygon indexing finished");
  }
  if (values.chain === "ethereum" || values.chain === "all") {
    logger.info(await indexEthereum(handle.db, { maxBlocks }), "ethereum indexing finished");
  }
} finally {
  await handle.close();
}
