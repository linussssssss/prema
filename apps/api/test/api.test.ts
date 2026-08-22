import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { ambiguityLabels, createDb, markets, venues, type DbHandle } from "@verdict/schema";
import { buildServer } from "../src/server.ts";

let handle: DbHandle;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  handle = await createDb("pglite://memory");
  await handle.migrate();
  await handle.db.insert(venues).values({ id: "polymarket", name: "Polymarket", kind: "onchain" });
  await handle.db.insert(markets).values({
    id: "polymarket:42",
    venueId: "polymarket",
    externalId: "42",
    question: "Test market?",
    capturedAt: new Date(),
  });
  await handle.db.insert(ambiguityLabels).values({
    marketId: "polymarket:42",
    disputed: true,
    escalated: false,
    resolvedNa: false,
    rulesEditedAfterListing: false,
    contested: true,
    labelVersion: "label-v1",
    computedAt: new Date(),
  });
  app = await buildServer(handle);
});

afterAll(async () => {
  await app.close();
  await handle.close();
});

describe("api", () => {
  it("GET /health", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
  });

  it("GET /v1/markets/:id returns market + latest label and the disclaimer", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/markets/42" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.market.question).toBe("Test market?");
    expect(body.label.contested).toBe(true);
    expect(body.disclaimer).toMatch(/not a ruling/);
  });

  it("404s for unknown markets", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/markets/999999" });
    expect(res.statusCode).toBe(404);
  });
});
