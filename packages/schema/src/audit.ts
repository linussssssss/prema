import { desc, sql } from "drizzle-orm";
import type { Db } from "./db.ts";
import { auditLog } from "./tables.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";

const GENESIS = "GENESIS";
// Arbitrary constant key for the advisory lock serializing chain appends.
const AUDIT_LOCK_KEY = 764_001;

export interface AuditEntry {
  actor: string;
  action: string;
  entity?: string;
  entityId?: string;
  payload?: unknown;
}

/**
 * Append one entry to the audit hash chain.
 * row_hash = sha256(prev_hash | payload_hash | actor | action | entity | entity_id | ts)
 * Serialized with an advisory lock; never insert into audit_log any other way.
 */
export async function appendAudit(db: Db, entry: AuditEntry): Promise<string> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`);
    const last = await tx.select({ rowHash: auditLog.rowHash }).from(auditLog).orderBy(desc(auditLog.id)).limit(1);
    const prevHash = last[0]?.rowHash ?? GENESIS;
    const ts = new Date();
    const payloadHash = sha256Hex(canonicalJson(entry.payload ?? null));
    const rowHash = sha256Hex(
      [prevHash, payloadHash, entry.actor, entry.action, entry.entity ?? "", entry.entityId ?? "", ts.toISOString()].join("|"),
    );
    await tx.insert(auditLog).values({
      ts,
      actor: entry.actor,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      payloadHash,
      prevHash,
      rowHash,
    });
    return rowHash;
  });
}

/** Recompute the chain and compare; returns the first broken row id, or null if intact. */
export async function verifyAuditChain(db: Db): Promise<number | null> {
  const rows = await db.select().from(auditLog).orderBy(auditLog.id);
  let prev = GENESIS;
  for (const row of rows) {
    const expected = sha256Hex(
      [prev, row.payloadHash, row.actor, row.action, row.entity ?? "", row.entityId ?? "", row.ts.toISOString()].join("|"),
    );
    if (expected !== row.rowHash || row.prevHash !== prev) return row.id;
    prev = row.rowHash;
  }
  return null;
}
