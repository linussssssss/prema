import { parseArgs } from "node:util";
import { createDb, databaseUrlFromEnv, loadEnv } from "@verdict/schema";
import type { ChainName } from "../chain/client.ts";
import { indexEthereum, indexPolygon, resetChainCursor, setChainCursor } from "../chain/indexer.ts";
import { logger } from "../lib/log.ts";

loadEnv();

const { values } = parseArgs({
  options: {
    chain: { type: "string", default: "all" }, // polygon | ethereum | all
    "max-blocks": { type: "string" },
    // Clear the stored lastBlock cursor(s) before indexing, so the run restarts
    // from the 2024 boundary instead of resuming. Needed after the adapter set
    // changes (ADR-0012): a resumed run would skip history below the cursor.
    "reset-cursor": { type: "boolean", default: false },
    // Resume from an explicit block instead. Use to skip a range already known
    // to be fully indexed under an unchanged adapter set — needs the reason
    // stated, because getting it wrong leaves a silent hole in the dataset.
    "from-block": { type: "string" },
    reason: { type: "string" },
  },
});

const SELECTABLE: Record<string, ChainName[]> = {
  polygon: ["polygon"],
  ethereum: ["ethereum"],
  all: ["polygon", "ethereum"],
};

const chains = SELECTABLE[values.chain];
if (!chains) {
  logger.error({ chain: values.chain }, "unknown --chain (expected polygon | ethereum | all)");
  process.exit(1);
}

const maxBlocks = values["max-blocks"] ? BigInt(values["max-blocks"]) : undefined;
const handle = await createDb(databaseUrlFromEnv());
try {
  if (values["reset-cursor"]) {
    for (const chain of chains) {
      logger.info(await resetChainCursor(handle.db, chain), "chain cursor reset");
    }
  }
  if (values["from-block"] !== undefined) {
    if (!values.reason) {
      logger.error("--from-block requires --reason: skipping a range silently is how a dataset gets a hole");
      process.exit(1);
    }
    for (const chain of chains) {
      logger.info(
        await setChainCursor(handle.db, chain, BigInt(values["from-block"]), values.reason),
        "chain cursor set",
      );
    }
  }
  for (const chain of chains) {
    const stats = chain === "polygon" ? await indexPolygon(handle.db, { maxBlocks }) : await indexEthereum(handle.db, { maxBlocks });
    logger.info(stats, `${chain} indexing finished`);
  }
} finally {
  await handle.close();
}
