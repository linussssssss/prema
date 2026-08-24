import wordlists from "./wordlists.json";

/** Bumping this invalidates the skip-check in `runLinterOverRules`, so the next
 *  linter pass re-lints the whole corpus (~2.6M versions, ~1h). Intended. */
export const LINTER_VERSION = "linter-v1.1.0";

export type Severity = "info" | "warn" | "high";

export type RuleId =
  | "hedge-words"
  | "deadline-no-timezone"
  | "occurrence-vs-reporting"
  | "status-verb-gap"
  | "vague-source"
  | "outcomes-not-exhaustive"
  | "template-residue"
  | "no-na-condition";

export interface LintHit {
  ruleId: RuleId;
  severity: Severity;
  span: { start: number; end: number };
  message: string;
}

export interface LintContext {
  /** Parsed outcome labels, e.g. ["Yes","No"] or candidate names. */
  outcomes?: string[];
  /** Venue-level resolutionSource field, if any. */
  resolutionSource?: string | null;
}

/** Case-insensitive search for every occurrence of `needle` at word-ish boundaries. */
function findAll(text: string, needle: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = /^[a-z0-9]/i.test(needle) ? `\\b${escaped}` : escaped;
  const suffix = /[a-z0-9]$/i.test(needle) ? "\\b" : "";
  const re = new RegExp(pattern + suffix, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length });
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return spans;
}

function containsAny(haystackLower: string, needles: string[]): boolean {
  return needles.some((n) => haystackLower.includes(n.toLowerCase()));
}

/** Multi-word needles match as substrings; single tokens require word boundaries
 *  (so "et" matches "11:59 PM ET" but not "etc" or "Ethereum"). */
function containsAnyToken(text: string, needles: string[]): boolean {
  return needles.some((n) =>
    n.includes(" ") ? text.toLowerCase().includes(n.toLowerCase()) : new RegExp(`\\b${n}\\b`, "i").test(text),
  );
}

const MONTHS =
  "January|February|March|April|May|June|July|August|September|October|November|December";

/** Date-ish phrases introduced by a deadline preposition.
 *  Factory: /g regexes are stateful, so every use gets a fresh instance. */
const deadlineRe = () =>
  new RegExp(
  `\\b(by|before|through|until|prior to|on or before|no later than)\\s+` +
    `((?:${MONTHS})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?` + // May 31, 2026
    `|\\d{1,2}\\s+(?:${MONTHS})(?:\\s+\\d{4})?` + // 31 May 2026
    `|\\d{4}-\\d{2}-\\d{2}` + // 2026-05-31
    `|\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?` + // 5/31/26
    `|(?:the\\s+)?end of (?:${MONTHS}|the year|\\d{4})` +
    `|\\d{4})`, // "before 2027"
    "gi",
  );

function rHedgeWords(text: string): LintHit[] {
  const hits: LintHit[] = [];
  for (const word of wordlists.hedgeWords) {
    for (const span of findAll(text, word)) {
      hits.push({
        ruleId: "hedge-words",
        severity: "warn",
        span,
        message: `Hedge word "${text.slice(span.start, span.end)}" — subjective threshold with no measurable definition.`,
      });
    }
  }
  // "significantly" spans contain "significant" etc. — keep the longest span per start offset.
  const byStart = new Map<number, LintHit>();
  for (const h of hits) {
    const prev = byStart.get(h.span.start);
    if (!prev || h.span.end > prev.span.end) byStart.set(h.span.start, h);
  }
  return [...byStart.values()];
}

function rDeadlineNoTimezone(text: string): LintHit[] {
  const lower = text.toLowerCase();
  const hits: LintHit[] = [];
  const hasTimezone = containsAnyToken(text, wordlists.timezoneMarkers);
  const hasBoundarySemantics = containsAny(lower, wordlists.boundarySemanticsMarkers);
  const re = deadlineRe();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const span = { start: m.index, end: m.index + m[0].length };
    if (!hasTimezone) {
      hits.push({
        ruleId: "deadline-no-timezone",
        severity: "high",
        span,
        message: `Deadline "${m[0]}" but no timezone is stated anywhere in the rules.`,
      });
    } else if (!hasBoundarySemantics) {
      hits.push({
        ruleId: "deadline-no-timezone",
        severity: "warn",
        span,
        message: `Deadline "${m[0]}" has a timezone but no explicit inclusive/exclusive boundary (e.g. "11:59 PM", "on or before").`,
      });
    }
  }
  return hits;
}

function rOccurrenceVsReporting(text: string): LintHit[] {
  const lower = text.toLowerCase();
  const deadline = deadlineRe().exec(text);
  if (!deadline) return [];
  if (containsAny(lower, wordlists.occurrenceDisambiguators)) return [];
  const hits: LintHit[] = [];
  for (const src of wordlists.laggingSources) {
    const spans = findAll(text, src);
    if (spans.length > 0 && spans[0]) {
      hits.push({
        ruleId: "occurrence-vs-reporting",
        severity: "high",
        span: spans[0],
        message:
          `Rules name a lagging source ("${src}") and a deadline ("${deadline[0]}") without saying whether the event must ` +
          `*occur* by the deadline or be *reported/published* by it.`,
      });
      break; // one hit per text is enough for this rule
    }
  }
  return hits;
}

function rStatusVerbGap(text: string): LintHit[] {
  const lower = text.toLowerCase();
  if (containsAny(lower, wordlists.edgeCaseMarkers)) return [];
  const hits: LintHit[] = [];
  const seen = new Set<number>();
  for (const verb of wordlists.statusVerbs) {
    for (const span of findAll(text, verb)) {
      if (seen.has(span.start)) continue;
      seen.add(span.start);
      hits.push({
        ruleId: "status-verb-gap",
        severity: "high",
        span,
        message:
          `Status change "${text.slice(span.start, span.end)}" without enumerated edge cases ` +
          `(death, interim/acting, partial, temporary, delayed effect).`,
      });
    }
  }
  return hits;
}

const URL_RE = /\bhttps?:\/\/\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\/\S*/i;
const DOMAIN_RE = /\b[a-z0-9-]+\.(?:com|org|net|gov|edu|io|xyz|co)\b/i;

function rVagueSource(text: string, ctx: LintContext): LintHit[] {
  const sourceField = (ctx.resolutionSource ?? "").trim();
  const cueSpans = wordlists.sourceClauseCues.flatMap((cue) => findAll(text, cue));
  if (cueSpans.length === 0) return [];
  const specificInText = URL_RE.test(text) || DOMAIN_RE.test(text);
  const specificInField = sourceField.length > 0;
  if (specificInText || specificInField) return [];
  const first = cueSpans.sort((a, b) => a.start - b.start)[0]!;
  return [
    {
      ruleId: "vague-source",
      severity: "warn",
      span: first,
      message:
        "A resolution-source clause names no specific feed or page (no URL, no venue resolutionSource field). " +
        '"Consensus of reporting"-style sources are a known dispute vector.',
    },
  ];
}

/**
 * NOTE (2026-08-24): this rule fires **zero** times across all 2,615,958
 * Polymarket rules versions, because every one of those markets has exactly two
 * outcomes — NegRisk multi-outcome events are modelled as separate binary
 * markets, so the >2 case simply does not occur in this venue's data. The rule
 * is correct and unreachable, not broken; it is kept for venues whose markets
 * are genuinely multi-outcome. `template-residue` below is the pattern that
 * actually bites on a binary corpus.
 */
function rOutcomesNotExhaustive(text: string, ctx: LintContext): LintHit[] {
  const outcomes = (ctx.outcomes ?? []).map((o) => o.toLowerCase());
  if (outcomes.length <= 2) return []; // binary Yes/No is exhaustive by construction
  const lower = text.toLowerCase();
  const hasOther =
    outcomes.some((o) => containsAny(o, wordlists.otherOutcomeMarkers)) ||
    containsAny(lower, wordlists.otherOutcomeMarkers);
  if (hasOther) return [];
  return [
    {
      ruleId: "outcomes-not-exhaustive",
      severity: "warn",
      span: { start: 0, end: 0 },
      message: `Multi-outcome market (${outcomes.length} outcomes) with no "Other"/"None of the above"/N/A catch-all; outcomes may not be exhaustive.`,
    },
  ];
}

/**
 * Template residue: the rules name a resolution target that is not one of the
 * market's actual outcomes — a copy-paste artefact from another market family.
 * Observed live: binary Fed markets resolving to a nonexistent "No change"
 * bracket, a USA tiebreak clause pasted into non-USA relay markets.
 *
 * Identified by the blinded ambiguity study as both common and highly lintable
 * (`prema-web/docs/AMBIGUITY-STUDY.md`), and it is the pattern
 * `outcomes-not-exhaustive` was reaching for but cannot see on a binary corpus.
 *
 * Deliberately high-precision: only *explicitly delimited* targets count — a
 * quoted string, or a capitalised phrase followed by bracket/option/outcome.
 * Free-text mentions are too noisy to be worth flagging. Void targets
 * ("N/A", "50-50") are legitimate and exempt.
 */
function rTemplateResidue(text: string, ctx: LintContext): LintHit[] {
  const outcomes = (ctx.outcomes ?? []).map(normalizeTarget).filter((o) => o.length > 0);
  if (outcomes.length === 0) return [];

  const hits: LintHit[] = [];
  const seen = new Set<string>();
  const patterns = [
    /resolv\w*\s+to\s+(?:the\s+)?["“'”]([^"“'”]{1,40})["“'”]/gi,
    /resolv\w*\s+to\s+(?:the\s+)?([A-Z][\w'’-]*(?:\s+[\w'’-]+){0,3})\s+(?:bracket|option|outcome|category|bucket)\b/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const raw = m[1] ?? "";
      const target = normalizeTarget(raw);
      if (target.length === 0 || seen.has(target)) continue;
      if (outcomes.includes(target)) continue;
      // Voiding to N/A or 50-50 is a legitimate target, not a stray label.
      if (containsAny(target, wordlists.naMarkers)) continue;
      seen.add(target);
      hits.push({
        ruleId: "template-residue",
        severity: "high",
        span: { start: m.index, end: m.index + m[0].length },
        message: `Rules resolve to "${raw.trim()}", which is not one of this market's outcomes (${(ctx.outcomes ?? []).join(", ")}) — likely copied from another market family.`,
      });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  return hits;
}

/** Lowercase, strip surrounding punctuation and collapse whitespace, so
 *  `"No change"` and `no  change.` compare equal. */
function normalizeTarget(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,;:!?]+$/g, "")
    .replace(/^[\s"'“”]+|[\s"'“”]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function rNoNaCondition(text: string): LintHit[] {
  const lower = text.toLowerCase();
  if (containsAny(lower, wordlists.naMarkers)) return [];
  return [
    {
      ruleId: "no-na-condition",
      severity: "info",
      span: { start: 0, end: 0 },
      message: "Rules state no N/A / invalid / 50-50 condition for unresolvable or voided scenarios.",
    },
  ];
}

/** Pure, deterministic lint over one rules text. */
export function lintRulesText(text: string, ctx: LintContext = {}): LintHit[] {
  if (text.trim().length === 0) return [];
  const hits = [
    ...rHedgeWords(text),
    ...rDeadlineNoTimezone(text),
    ...rOccurrenceVsReporting(text),
    ...rStatusVerbGap(text),
    ...rVagueSource(text, ctx),
    ...rOutcomesNotExhaustive(text, ctx),
    ...rTemplateResidue(text, ctx),
    ...rNoNaCondition(text),
  ];
  return hits.sort((a, b) => a.span.start - b.span.start || a.ruleId.localeCompare(b.ruleId));
}
