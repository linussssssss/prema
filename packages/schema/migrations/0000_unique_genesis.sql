CREATE TABLE "ambiguity_labels" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"market_id" text NOT NULL,
	"disputed" boolean NOT NULL,
	"escalated" boolean NOT NULL,
	"resolved_na" boolean NOT NULL,
	"rules_edited_after_listing" boolean NOT NULL,
	"contested" boolean NOT NULL,
	"price_reversal" boolean,
	"manual_flag" boolean DEFAULT false NOT NULL,
	"manual_note" text,
	"label_version" text NOT NULL,
	"computed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity" text,
	"entity_id" text,
	"payload_hash" text NOT NULL,
	"prev_hash" text NOT NULL,
	"row_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"market_id" text,
	"question_id" text,
	"request_key" text NOT NULL,
	"oracle_address" text,
	"oracle" text,
	"proposer" text,
	"disputer" text,
	"proposed_price" numeric,
	"disputed_at" timestamp with time zone,
	"settled_price" numeric,
	"settled_at" timestamp with time zone,
	"escalated" boolean DEFAULT false NOT NULL,
	"captured_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "linter_hits" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"rules_version_id" bigint NOT NULL,
	"clause_id" bigint,
	"rule_id" text NOT NULL,
	"severity" text NOT NULL,
	"span_start" integer NOT NULL,
	"span_end" integer NOT NULL,
	"message" text NOT NULL,
	"linter_version" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_metrics" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"market_id" text NOT NULL,
	"source" text DEFAULT 'clob' NOT NULL,
	"mid" numeric,
	"spread" numeric,
	"best_bid" numeric,
	"best_ask" numeric,
	"volume_24h" numeric,
	"liquidity" numeric,
	"occurred_at" timestamp with time zone NOT NULL,
	"captured_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" text PRIMARY KEY NOT NULL,
	"venue_id" text NOT NULL,
	"external_id" text NOT NULL,
	"slug" text,
	"question" text NOT NULL,
	"category" text,
	"tags" jsonb,
	"condition_id" text,
	"question_id" text,
	"neg_risk" boolean DEFAULT false NOT NULL,
	"neg_risk_request_id" text,
	"resolved_by" text,
	"resolution_source" text,
	"outcomes" jsonb,
	"outcome_prices" jsonb,
	"clob_token_ids" jsonb,
	"end_date" timestamp with time zone,
	"listed_at" timestamp with time zone,
	"start_date" timestamp with time zone,
	"closed_time" timestamp with time zone,
	"active" boolean,
	"closed" boolean,
	"volume_usd" numeric,
	"liquidity_usd" numeric,
	"volume_24h" numeric,
	"uma_bond" numeric,
	"uma_reward" numeric,
	"uma_resolution_status" text,
	"oracle_mechanism" text DEFAULT 'unknown' NOT NULL,
	"gamma_raw" jsonb,
	"updated_at_venue" timestamp with time zone,
	"captured_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resolution_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"chain" text NOT NULL,
	"contract_address" text NOT NULL,
	"oracle" text NOT NULL,
	"event_name" text NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_time" timestamp with time zone,
	"question_id" text,
	"condition_id" text,
	"requester" text,
	"args" jsonb NOT NULL,
	"captured_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rules_clauses" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"rules_version_id" bigint NOT NULL,
	"clause_type" text NOT NULL,
	"span_start" integer NOT NULL,
	"span_end" integer NOT NULL,
	"text" text NOT NULL,
	"extractor" text NOT NULL,
	"model_version" text,
	"captured_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rules_versions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"market_id" text NOT NULL,
	"version_num" integer NOT NULL,
	"text_hash" text NOT NULL,
	"rules_text" text NOT NULL,
	"source" text NOT NULL,
	"occurred_at" timestamp with time zone,
	"captured_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"dispute_id" bigint,
	"identifier" text,
	"request_time" timestamp with time zone,
	"ancillary_hash" text,
	"voter" text,
	"price" numeric,
	"num_tokens" numeric,
	"round_id" integer,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"occurred_at" timestamp with time zone,
	"captured_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ambiguity_labels" ADD CONSTRAINT "ambiguity_labels_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linter_hits" ADD CONSTRAINT "linter_hits_rules_version_id_rules_versions_id_fk" FOREIGN KEY ("rules_version_id") REFERENCES "public"."rules_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linter_hits" ADD CONSTRAINT "linter_hits_clause_id_rules_clauses_id_fk" FOREIGN KEY ("clause_id") REFERENCES "public"."rules_clauses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_metrics" ADD CONSTRAINT "market_metrics_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules_clauses" ADD CONSTRAINT "rules_clauses_rules_version_id_rules_versions_id_fk" FOREIGN KEY ("rules_version_id") REFERENCES "public"."rules_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules_versions" ADD CONSTRAINT "rules_versions_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."disputes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ambiguity_labels_market_idx" ON "ambiguity_labels" USING btree ("market_id");--> statement-breakpoint
CREATE UNIQUE INDEX "disputes_request_uq" ON "disputes" USING btree ("request_key");--> statement-breakpoint
CREATE INDEX "disputes_market_idx" ON "disputes" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "disputes_question_idx" ON "disputes" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "linter_hits_version_idx" ON "linter_hits" USING btree ("rules_version_id");--> statement-breakpoint
CREATE INDEX "linter_hits_rule_idx" ON "linter_hits" USING btree ("rule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "linter_hits_uq" ON "linter_hits" USING btree ("rules_version_id","rule_id","span_start","span_end","linter_version");--> statement-breakpoint
CREATE INDEX "market_metrics_market_time_idx" ON "market_metrics" USING btree ("market_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "markets_venue_external_uq" ON "markets" USING btree ("venue_id","external_id");--> statement-breakpoint
CREATE INDEX "markets_condition_idx" ON "markets" USING btree ("condition_id");--> statement-breakpoint
CREATE INDEX "markets_question_idx" ON "markets" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "markets_listed_idx" ON "markets" USING btree ("listed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "resolution_events_uq" ON "resolution_events" USING btree ("chain","tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "resolution_events_question_idx" ON "resolution_events" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "resolution_events_condition_idx" ON "resolution_events" USING btree ("condition_id");--> statement-breakpoint
CREATE INDEX "resolution_events_name_idx" ON "resolution_events" USING btree ("event_name");--> statement-breakpoint
CREATE INDEX "resolution_events_block_idx" ON "resolution_events" USING btree ("chain","block_number");--> statement-breakpoint
CREATE INDEX "rules_clauses_version_idx" ON "rules_clauses" USING btree ("rules_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rules_versions_market_version_uq" ON "rules_versions" USING btree ("market_id","version_num");--> statement-breakpoint
CREATE INDEX "rules_versions_market_idx" ON "rules_versions" USING btree ("market_id");--> statement-breakpoint
CREATE UNIQUE INDEX "votes_uq" ON "votes" USING btree ("tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "votes_ancillary_idx" ON "votes" USING btree ("ancillary_hash");