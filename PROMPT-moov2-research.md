# PROMPT — MOOv2 dispute-suppression research

Paste into Claude Research. Self-contained: it assumes no access to our repo or
database. Everything under "Verified facts" was measured directly, on-chain or
in our own database, on 2026-08-23 — treat it as given and do not spend effort
re-deriving it.

---

I am building a research dataset of prediction-market resolution outcomes,
using Polymarket markets on Polygon and UMA's Optimistic Oracle as the
resolution layer. I need to understand a specific mechanism change, because a
measurement I depend on appears to have gone to zero.

## Verified facts (measured 2026-08-23 — take as given)

- Polymarket's current **V4 CTF adapters** on Polygon are
  `0x65070BE91477460D8A7AeEb94ef92fe056C2f2A7` (UMA CTF Adapter V4) and
  `0x69c47De9D4D3Dad79590d61b9e05918E03775f24` (Neg Risk UMA CTF Adapter V4).
  Together they resolve ~1.88M of 2.62M markets in our corpus.
- Calling the public `optimisticOracle()` getter on **both** V4 adapters
  returns `0x2C0367a9DB231dDeBd88a94b4f6461a6e47C58B1`.
- The older adapters — CTF Adapter v3 `0x157Ce2d672854c848c9b79C49a8Cc6cc89176a49`,
  the previous NegRisk adapter `0x2F5e3684cb1F318ec51b00Edba38d79Ac2c0aA9d`,
  and UmaSportsOracle `0xb21182d0494521Cf45DbbeEbb5A3ACAAb6d22093` — all still
  return plain OptimisticOracleV2 `0xeE3Afe347D5C74317041E2618C49534dAf887c24`.
- **The measurement that prompted this.** Indexing an 11-hour window of Polygon
  (blocks 92,511,501–92,531,501, 2026-08-23) captured **8,430 `ProposePrice`
  and 6,881 `Settle`** events on `0x2C03…`, and **zero `DisputePrice`**. For
  comparison, our 2024 data on plain OOv2 shows **198 `DisputePrice` against
  6,832 `ProposePrice` — a 2.90% dispute rate**. At that rate, 8,430 proposals
  should have produced ~244 disputes. The 95% upper bound on the observed rate
  is ~0.036%, i.e. at least ~80x below the 2024 baseline.
- We decode `ProposePrice` and `Settle` from `0x2C03…` successfully using the
  standard `OptimisticOracleV2Interface` event signatures, so the ABI is at
  least broadly correct for that contract.

## What I need

**1. Identify `0x2C0367a9DB231dDeBd88a94b4f6461a6e47C58B1`.** Confirm from a
citable source what this contract is — I believe it is UMA's
ManagedOptimisticOracleV2 (UMIP-189), but I have not verified the name. A
Polygonscan name tag, a UMA deployment registry, an UMIP, a governance vote, or
the deployment transaction would all settle it. If it is something else
entirely, that is the most important thing you can tell me.

**2. How do disputes work in the managed oracle?** This is the core question.
   - Is `DisputePrice(address indexed requester, address indexed proposer,
     address indexed disputer, bytes32 identifier, uint256 timestamp, bytes
     ancillaryData, int256 proposedPrice)` still the event emitted on dispute,
     with that exact signature? Or does the managed variant emit a differently
     named or differently shaped event that a filter built for OOv2 would
     silently miss?
   - **Who may dispute?** UMA's managed model whitelists *proposers*. Is the
     right to dispute also restricted to a whitelist, or open to anyone posting
     a bond?
   - Is there a path by which a contested outcome is resolved **without** an
     on-chain `DisputePrice` — an administrative override, a manager role, an
     off-chain challenge process, a re-request, or a settlement negotiated
     before the liveness window closes?
   - Does a managed dispute still escalate to the DVM on Ethereum mainnet
     (`VotingV2` `0x004395edb43EFca9885CEdad51EC9fAf93Bd34ac`), or somewhere else?

**3. Is the near-zero dispute rate a known, expected effect?** UMIP-189's
rationale, UMA governance discussion, Polymarket engineering posts, or any
public commentary on how the managed oracle changed dispute volume. A published
before/after dispute rate would be ideal. I want to distinguish "working as
designed" from "we are querying the wrong thing".

**4. Ground truth I can test against — the most actionable ask.** Find me
**specific, publicly documented Polymarket market disputes from 2026**, ideally
with transaction hashes, market slugs, or UMA request identifiers. Sources
worth checking: UMA's oracle interface (oracle.uma.xyz), UMA governance
discourse, Polymarket's own docs or announcements, crypto press covering
contested resolutions, and X/Twitter threads about disputed markets. Even two
or three concrete examples let me verify directly on-chain whether my indexer
sees them — which distinguishes a real-world change from a bug in my code.

**5. Timeline.** When were the V4 adapters deployed, and when did the migration
to the managed oracle take effect? Approximate dates are fine; I can convert to
Polygon block numbers myself (~2s blocks).

**6. If disputes really have gone away, what replaces them?** I need observable
on-chain evidence that a resolution was contested. Candidates I already index
are the adapters' `QuestionReset` and `QuestionManuallyResolved` events. Are
these the right signals in the managed regime, are they common, and are there
others — anything in the managed oracle or the adapters that marks a resolution
as disputed, corrected, re-proposed, or overridden?

**7. The proposer whitelist.** UMA's docs reportedly list ~37 whitelisted
proposer addresses (`managedoptimisticoraclev2/default-proposer-whitelist.md`
in the uma-docs repo). Confirm it exists, and give me the current list or a
stable link.

## Output

Answer 1–7 in order. For each claim, cite the source and label it clearly as
**documented** (primary source: contract code, UMIP, official docs, deployment
registry), **reported** (secondary: press, blog, forum), or **inferred**. Where
sources conflict or you find nothing, say so explicitly rather than filling the
gap — an honest "no public source found" is more useful to me than a plausible
guess, because I will otherwise go and verify it on-chain at some cost.

Primary sources I would start from: the `UMAprotocol/protocol` and
`UMAprotocol/uma-docs` GitHub repos, UMA's UMIP repository, docs.uma.xyz,
UMA's governance discourse, Polygonscan for `0x2C03…`, and
docs.polymarket.com.
