import Fastify from "fastify";
import { desc, eq } from "drizzle-orm";
import { ambiguityLabels, linterHits, markets, rulesVersions, type DbHandle } from "@verdict/schema";

export async function buildServer(handle: DbHandle) {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  const db = handle.db;

  app.get("/health", async () => ({ ok: true, service: "verdict-api", phase: 0 }));

  app.get<{ Params: { id: string } }>("/v1/markets/:id", async (req, reply) => {
    const id = req.params.id.includes(":") ? req.params.id : `polymarket:${req.params.id}`;
    const marketRows = await db.select().from(markets).where(eq(markets.id, id)).limit(1);
    const market = marketRows[0];
    if (!market) return reply.code(404).send({ error: "market not found", id });

    const [label] = await db
      .select()
      .from(ambiguityLabels)
      .where(eq(ambiguityLabels.marketId, id))
      .orderBy(desc(ambiguityLabels.id))
      .limit(1);
    const [rules] = await db
      .select()
      .from(rulesVersions)
      .where(eq(rulesVersions.marketId, id))
      .orderBy(desc(rulesVersions.versionNum))
      .limit(1);
    const hits = rules
      ? await db.select().from(linterHits).where(eq(linterHits.rulesVersionId, rules.id))
      : [];

    return {
      market: {
        id: market.id,
        question: market.question,
        slug: market.slug,
        category: market.category,
        conditionId: market.conditionId,
        questionId: market.questionId,
        negRisk: market.negRisk,
        closed: market.closed,
        endDate: market.endDate,
        listedAt: market.listedAt,
        volumeUsd: market.volumeUsd,
        resolutionSource: market.resolutionSource,
      },
      // Phase 0 exposes the raw label; the calibrated 0-100 score is Phase 1.
      label: label ?? null,
      rules: rules
        ? { versionNum: rules.versionNum, textHash: rules.textHash, occurredAt: rules.occurredAt, text: rules.rulesText }
        : null,
      linterHits: hits.map((h) => ({
        ruleId: h.ruleId,
        severity: h.severity,
        span: [h.spanStart, h.spanEnd],
        message: h.message,
        linterVersion: h.linterVersion,
      })),
      disclaimer: "Recommended assessment, not a ruling.",
    };
  });

  return app;
}
