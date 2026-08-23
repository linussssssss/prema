/**
 * Builds the blinded ambiguity study (TODO P0 "signal validation").
 *
 * The question it exists to answer: when a market ends in a dispute, was the
 * ambiguity visible in its LISTING-TIME text? Everything downstream depends on
 * it — if yes the linter is merely weak, if no then listing-time scoring has a
 * ceiling no model raises.
 *
 * The judge must not know which markets were disputed, or they will find
 * ambiguity in every one of them. So this writes two files: a shuffled,
 * unlabelled `ambiguity-study.json` for the judge, and `key.json` — which the
 * judge never sees — for scoring afterwards. Same no-hindsight discipline the
 * dataset itself is built on, applied to our own evaluation.
 *
 * Controls are matched to the disputed set on listing month, category and
 * volume band, because disputed markets skew political and high-volume and
 * several linter rules key on political language. An unmatched comparison
 * would measure "is this market political", not "is this market ambiguous".
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { createDb, databaseUrlFromEnv } from "@verdict/schema";
import { rowsOf } from "./exporters.ts";

interface Candidate {
  market_id: string;
  question: string;
  category: string | null;
  listed_at: string | null;
  volume_usd: string | null;
  rules_text: string;
  month: string | null;
  vol_band: number;
}

/** Deterministic shuffle so the file is reproducible from the same corpus. */
function seededShuffle<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let state = seed;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export async function buildBlindStudy(outDir: string): Promise<{ items: number; disputed: number }> {
  const handle = await createDb(databaseUrlFromEnv());
  try {
    // Disputed = a DisputePrice event whose questionId joins to a market we
    // hold rules text for. Version 1 only: the listing-time view (ADR-0009).
    const disputed = rowsOf<Candidate>(
      await handle.db.execute(sql`
        select m.id as market_id, m.question, m.category,
               m.listed_at::text as listed_at, m.volume_usd::text as volume_usd,
               rv.rules_text,
               to_char(m.listed_at, 'YYYY-MM') as month,
               width_bucket(coalesce(m.volume_usd::double precision, 0), 0, 1000000, 5) as vol_band
        from markets m
        join rules_versions rv on rv.market_id = m.id and rv.version_num = 1
        where m.question_id in (
          select distinct question_id from resolution_events
          where event_name = 'DisputePrice' and question_id is not null
        )`),
    );

    // Controls: same month, category and volume band, never disputed. Pick a
    // deterministic one per disputed market so the file is reproducible.
    // Three tiers, loosened only as far as needed: an unmatched control is
    // worse than a loosely matched one, but a *missing* control is worse still
    // — it would leave the groups different sizes for no analytical gain.
    const used = new Set<string>();
    const controls: Candidate[] = [];
    const tiers = [
      (d: Candidate) => sql`to_char(m.listed_at, 'YYYY-MM') = ${d.month}
        and coalesce(m.category, '') = coalesce(${d.category}, '')
        and width_bucket(coalesce(m.volume_usd::double precision, 0), 0, 1000000, 5) = ${d.vol_band}`,
      (d: Candidate) => sql`to_char(m.listed_at, 'YYYY-MM') = ${d.month}
        and coalesce(m.category, '') = coalesce(${d.category}, '')`,
      (d: Candidate) => sql`to_char(m.listed_at, 'YYYY-MM') = ${d.month}`,
    ];
    for (const d of disputed) {
      for (const tier of tiers) {
        const found = rowsOf<Candidate>(
          await handle.db.execute(sql`
            select m.id as market_id, m.question, m.category,
                   m.listed_at::text as listed_at, m.volume_usd::text as volume_usd,
                   rv.rules_text,
                   to_char(m.listed_at, 'YYYY-MM') as month,
                   width_bucket(coalesce(m.volume_usd::double precision, 0), 0, 1000000, 5) as vol_band
            from markets m
            join rules_versions rv on rv.market_id = m.id and rv.version_num = 1
            where ${tier(d)}
              and m.question_id not in (
                select distinct question_id from resolution_events
                where event_name = 'DisputePrice' and question_id is not null
              )
            order by m.id
            limit 60`),
        );
        const pick = found.find((c) => !used.has(c.market_id));
        if (pick) {
          used.add(pick.market_id);
          controls.push(pick);
          break;
        }
      }
    }

    const labelled = [
      ...disputed.map((c) => ({ ...c, disputed: true })),
      ...controls.map((c) => ({ ...c, disputed: false })),
    ];
    const shuffled = seededShuffle(labelled, 20260823);

    const items = shuffled.map((c, i) => ({
      item_id: `item-${String(i + 1).padStart(3, "0")}`,
      question: c.question,
      category: c.category,
      listed_at: c.listed_at,
      volume_usd: c.volume_usd,
      rules_text: c.rules_text.slice(0, 4000),
    }));
    const key = shuffled.map((c, i) => ({
      item_id: `item-${String(i + 1).padStart(3, "0")}`,
      market_id: c.market_id,
      disputed: c.disputed,
    }));

    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, "ambiguity-study.json"), JSON.stringify(items, null, 2), "utf8");
    writeFileSync(path.join(outDir, "key.json"), JSON.stringify(key, null, 2), "utf8");
    return { items: items.length, disputed: disputed.length };
  } finally {
    await handle.close();
  }
}
