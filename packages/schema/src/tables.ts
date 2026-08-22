import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const venues = pgTable("venues", {
  id: text("id").primaryKey(), // 'polymarket', 'kalshi', ...
  name: text("name").notNull(),
  kind: text("kind").notNull(), // 'onchain' | 'cftc'
  createdAt: tz("created_at").notNull().defaultNow(),
});

export const markets = pgTable(
  "markets",
  {
    id: text("id").primaryKey(), // `${venueId}:${externalId}`
    venueId: text("venue_id")
      .notNull()
      .references(() => venues.id),
    externalId: text("external_id").notNull(), // Gamma market id
    slug: text("slug"),
    question: text("question").notNull(),
    category: text("category"),
    tags: jsonb("tags"),
    conditionId: text("condition_id"),
    questionId: text("question_id"), // UMA questionID (CTF adapter)
    negRisk: boolean("neg_risk").notNull().default(false),
    negRiskRequestId: text("neg_risk_request_id"),
    resolvedBy: text("resolved_by"), // adapter address per Gamma
    resolutionSource: text("resolution_source"),
    outcomes: jsonb("outcomes"),
    outcomePrices: jsonb("outcome_prices"),
    clobTokenIds: jsonb("clob_token_ids"),
    endDate: tz("end_date"),
    listedAt: tz("listed_at"), // Gamma createdAt — occurred_at of listing
    startDate: tz("start_date"),
    closedTime: tz("closed_time"),
    active: boolean("active"),
    closed: boolean("closed"),
    volumeUsd: numeric("volume_usd"),
    liquidityUsd: numeric("liquidity_usd"),
    volume24h: numeric("volume_24h"),
    umaBond: numeric("uma_bond"),
    umaReward: numeric("uma_reward"),
    umaResolutionStatus: text("uma_resolution_status"),
    // 'oov2' | 'moov2' | 'in_house' | 'unknown' — set from on-chain evidence
    oracleMechanism: text("oracle_mechanism").notNull().default("unknown"),
    gammaRaw: jsonb("gamma_raw"),
    updatedAtVenue: tz("updated_at_venue"),
    capturedAt: tz("captured_at").notNull(),
  },
  (t) => [
    uniqueIndex("markets_venue_external_uq").on(t.venueId, t.externalId),
    index("markets_condition_idx").on(t.conditionId),
    index("markets_question_idx").on(t.questionId),
    index("markets_listed_idx").on(t.listedAt),
  ],
);

// Append-only: a market's rules text at a point in time. Never UPDATE rows.
export const rulesVersions = pgTable(
  "rules_versions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    marketId: text("market_id")
      .notNull()
      .references(() => markets.id),
    versionNum: integer("version_num").notNull(),
    textHash: text("text_hash").notNull(), // sha256 hex of rulesText
    rulesText: text("rules_text").notNull(),
    source: text("source").notNull(), // 'gamma_description' | 'ancillary_data'
    occurredAt: tz("occurred_at"), // best-known time the text became effective
    capturedAt: tz("captured_at").notNull(),
  },
  (t) => [
    uniqueIndex("rules_versions_market_version_uq").on(t.marketId, t.versionNum),
    index("rules_versions_market_idx").on(t.marketId),
  ],
);

export const rulesClauses = pgTable(
  "rules_clauses",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    rulesVersionId: bigint("rules_version_id", { mode: "number" })
      .notNull()
      .references(() => rulesVersions.id),
    clauseType: text("clause_type").notNull(),
    spanStart: integer("span_start").notNull(),
    spanEnd: integer("span_end").notNull(),
    text: text("text").notNull(),
    extractor: text("extractor").notNull(), // 'linter-v1' | model name later
    modelVersion: text("model_version"),
    capturedAt: tz("captured_at").notNull(),
  },
  (t) => [index("rules_clauses_version_idx").on(t.rulesVersionId)],
);

export const linterHits = pgTable(
  "linter_hits",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    rulesVersionId: bigint("rules_version_id", { mode: "number" })
      .notNull()
      .references(() => rulesVersions.id),
    clauseId: bigint("clause_id", { mode: "number" }).references(() => rulesClauses.id),
    ruleId: text("rule_id").notNull(),
    severity: text("severity").notNull(), // 'info' | 'warn' | 'high'
    spanStart: integer("span_start").notNull(),
    spanEnd: integer("span_end").notNull(),
    message: text("message").notNull(),
    linterVersion: text("linter_version").notNull(),
    capturedAt: tz("captured_at").notNull(),
  },
  (t) => [
    index("linter_hits_version_idx").on(t.rulesVersionId),
    index("linter_hits_rule_idx").on(t.ruleId),
    uniqueIndex("linter_hits_uq").on(t.rulesVersionId, t.ruleId, t.spanStart, t.spanEnd, t.linterVersion),
  ],
);

export const marketMetrics = pgTable(
  "market_metrics",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    marketId: text("market_id")
      .notNull()
      .references(() => markets.id),
    source: text("source").notNull().default("clob"),
    mid: numeric("mid"),
    spread: numeric("spread"),
    bestBid: numeric("best_bid"),
    bestAsk: numeric("best_ask"),
    volume24h: numeric("volume_24h"),
    liquidity: numeric("liquidity"),
    occurredAt: tz("occurred_at").notNull(), // exchange timestamp
    capturedAt: tz("captured_at").notNull(),
  },
  (t) => [index("market_metrics_market_time_idx").on(t.marketId, t.occurredAt)],
);

// Raw decoded on-chain events. Idempotent on (chain, tx, logIndex).
export const resolutionEvents = pgTable(
  "resolution_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    chain: text("chain").notNull(), // 'polygon' | 'ethereum'
    contractAddress: text("contract_address").notNull(),
    oracle: text("oracle").notNull(), // 'ctf_adapter_v1'|'ctf_adapter_v2'|'ctf_adapter_v3'|'neg_risk_adapter'|'oov2'|'moov2'|'ctf'|'votingv2'
    eventName: text("event_name").notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    blockNumber: bigint("block_number", { mode: "number" }).notNull(),
    blockTime: tz("block_time"), // occurred_at
    questionId: text("question_id"),
    conditionId: text("condition_id"),
    requester: text("requester"),
    args: jsonb("args").notNull(),
    capturedAt: tz("captured_at").notNull(),
  },
  (t) => [
    uniqueIndex("resolution_events_uq").on(t.chain, t.txHash, t.logIndex),
    index("resolution_events_question_idx").on(t.questionId),
    index("resolution_events_condition_idx").on(t.conditionId),
    index("resolution_events_name_idx").on(t.eventName),
    index("resolution_events_block_idx").on(t.chain, t.blockNumber),
  ],
);

// One row per disputed oracle request (derived from resolution_events).
export const disputes = pgTable(
  "disputes",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    marketId: text("market_id").references(() => markets.id),
    questionId: text("question_id"),
    requestKey: text("request_key").notNull(), // sha256(identifier|time|ancillaryHash|requester)
    oracleAddress: text("oracle_address"),
    oracle: text("oracle"), // 'oov2' | 'moov2'
    proposer: text("proposer"),
    disputer: text("disputer"),
    proposedPrice: numeric("proposed_price"),
    disputedAt: tz("disputed_at"),
    settledPrice: numeric("settled_price"),
    settledAt: tz("settled_at"),
    escalated: boolean("escalated").notNull().default(false),
    capturedAt: tz("captured_at").notNull(),
  },
  (t) => [
    uniqueIndex("disputes_request_uq").on(t.requestKey),
    index("disputes_market_idx").on(t.marketId),
    index("disputes_question_idx").on(t.questionId),
  ],
);

// Revealed DVM votes (Ethereum mainnet VotingV2).
export const votes = pgTable(
  "votes",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    disputeId: bigint("dispute_id", { mode: "number" }).references(() => disputes.id),
    identifier: text("identifier"),
    requestTime: tz("request_time"),
    ancillaryHash: text("ancillary_hash"),
    voter: text("voter"),
    price: numeric("price"),
    numTokens: numeric("num_tokens"),
    roundId: integer("round_id"),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    occurredAt: tz("occurred_at"),
    capturedAt: tz("captured_at").notNull(),
  },
  (t) => [
    uniqueIndex("votes_uq").on(t.txHash, t.logIndex),
    index("votes_ancillary_idx").on(t.ancillaryHash),
  ],
);

// Append-only label rows; latest (market_id, label_version, computed_at) wins for reads.
export const ambiguityLabels = pgTable(
  "ambiguity_labels",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    marketId: text("market_id")
      .notNull()
      .references(() => markets.id),
    disputed: boolean("disputed").notNull(),
    escalated: boolean("escalated").notNull(),
    resolvedNa: boolean("resolved_na").notNull(),
    rulesEditedAfterListing: boolean("rules_edited_after_listing").notNull(),
    contested: boolean("contested").notNull(),
    priceReversal: boolean("price_reversal"),
    manualFlag: boolean("manual_flag").notNull().default(false),
    manualNote: text("manual_note"),
    labelVersion: text("label_version").notNull(),
    computedAt: tz("computed_at").notNull(),
  },
  (t) => [index("ambiguity_labels_market_idx").on(t.marketId)],
);

// Hash chain. Only append via appendAudit() in audit.ts.
export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  ts: tz("ts").notNull().defaultNow(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  entity: text("entity"),
  entityId: text("entity_id"),
  payloadHash: text("payload_hash").notNull(),
  prevHash: text("prev_hash").notNull(),
  rowHash: text("row_hash").notNull(),
});

// Operational bookkeeping (cursors, last indexed blocks). Not decision-relevant;
// in-place updates are allowed here.
export const ingestState = pgTable("ingest_state", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: tz("updated_at").notNull(),
});
