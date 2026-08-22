/**
 * Phase 0 STUB — search adapters + snapshotter arrive in Phase 2.
 * The one rule that already applies: every retrieval takes `publishedBefore`
 * and refuses to run without it (no-hindsight-leakage non-negotiable).
 */

export interface RetrievalQuery {
  query: string;
  /** Hard upper bound on publication date. REQUIRED — no default. */
  publishedBefore: Date;
  limit?: number;
}

export interface RetrievedDocument {
  url: string;
  title: string;
  publishedAt: Date;
  snippet: string;
  /** sha256 of the snapshotted content. */
  contentHash: string;
}

export async function search(q: RetrievalQuery): Promise<RetrievedDocument[]> {
  assertPublishedBefore(q);
  throw new Error("packages/retrieval is a Phase 0 stub — implemented in Phase 2.");
}

export function assertPublishedBefore(q: { publishedBefore?: Date | null }): void {
  if (!(q.publishedBefore instanceof Date) || Number.isNaN(q.publishedBefore.getTime())) {
    throw new Error("retrieval refused: publishedBefore is required (no-hindsight rule)");
  }
}
