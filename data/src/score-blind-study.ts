/**
 * Unblinds and scores the ambiguity study (TODO P0 "signal validation").
 *
 * Parses the judge's table out of prema-web/docs/AMBIGUITY-STUDY.md, joins it
 * to data/blind/key.json, and reports the contested-vs-control ambiguity rate.
 *
 * Scored three ways — all items, excluding disclosed, and disclosed only —
 * because the judge's disclosure rule creates an asymmetry that cannot be
 * wished away: famous markets are famous largely *because* they were disputed,
 * so recognition falls more on the contested group. Dropping disclosed items
 * biases toward less notable disputes; keeping them admits contamination.
 * Reporting all three is the only honest treatment: if the effect survives
 * exclusion it is judgement, if it lives only among disclosed items it is
 * recognition.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

interface Judgement {
  itemId: string;
  ambiguous: boolean;
  kind: string;
  confidence: number;
}

const two = (n: number, d: number): string => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`);

/** Wilson score interval — honest at these sample sizes, unlike normal approx. */
function wilson(k: number, n: number): string {
  if (n === 0) return "n/a";
  const p = k / n;
  const z = 1.96;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return `[${(100 * Math.max(0, centre - half)).toFixed(0)}%, ${(100 * Math.min(1, centre + half)).toFixed(0)}%]`;
}

export function parseJudgements(markdown: string): Judgement[] {
  const out: Judgement[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const m = /^\|\s*(item-\d{3})\s*\|\s*(yes|no)\s*\|\s*([^|]*?)\s*\|\s*(\d)\s*\|/i.exec(line);
    if (!m) continue;
    out.push({
      itemId: m[1]!,
      ambiguous: m[2]!.toLowerCase() === "yes",
      kind: (m[3] ?? "").trim(),
      confidence: Number(m[4]),
    });
  }
  return out;
}

/** Item ids named anywhere in the Disclosures section. */
export function parseDisclosed(markdown: string): Set<string> {
  const start = markdown.indexOf("## Disclosures");
  if (start < 0) return new Set();
  const rest = markdown.slice(start);
  const end = rest.indexOf("\n## ", 3);
  const section = end < 0 ? rest : rest.slice(0, end);
  return new Set(section.match(/item-\d{3}/g) ?? []);
}

function report(label: string, rows: Array<{ disputed: boolean; ambiguous: boolean }>): void {
  const d = rows.filter((r) => r.disputed);
  const c = rows.filter((r) => !r.disputed);
  const dy = d.filter((r) => r.ambiguous).length;
  const cy = c.filter((r) => r.ambiguous).length;
  console.log(`\n### ${label}  (n=${rows.length}: ${d.length} contested, ${c.length} control)`);
  console.log(`  contested ambiguous : ${dy}/${d.length}  ${two(dy, d.length)}  95% CI ${wilson(dy, d.length)}`);
  console.log(`  control   ambiguous : ${cy}/${c.length}  ${two(cy, c.length)}  95% CI ${wilson(cy, c.length)}`);
  const pd = d.length ? dy / d.length : 0;
  const pc = c.length ? cy / c.length : 0;
  console.log(`  difference          : ${((pd - pc) * 100).toFixed(1)} pp`);
  console.log(`  lift                : ${pc > 0 ? (pd / pc).toFixed(2) + "x" : "n/a"}`);
}

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..", "..");
const studyPath = path.resolve(repoRoot, "..", "prema-web", "docs", "AMBIGUITY-STUDY.md");
const keyPath = path.join(repoRoot, "data", "blind-key", "key.json");

const md = readFileSync(studyPath, "utf8");
const judgements = parseJudgements(md);
const disclosed = parseDisclosed(md);
const key = JSON.parse(readFileSync(keyPath, "utf8")) as Array<{
  item_id: string;
  market_id: string;
  disputed: boolean;
}>;
const keyById = new Map(key.map((k) => [k.item_id, k]));

console.log(`judgements parsed: ${judgements.length}   key items: ${key.length}   disclosed: ${disclosed.size}`);
const missing = key.filter((k) => !judgements.some((j) => j.itemId === k.item_id));
if (missing.length > 0) console.log(`WARNING unjudged items: ${missing.map((m) => m.item_id).join(", ")}`);

const joined = judgements
  .map((j) => ({ ...j, disputed: keyById.get(j.itemId)?.disputed ?? null }))
  .filter((j): j is Judgement & { disputed: boolean } => j.disputed !== null);

report("ALL ITEMS", joined);
report("EXCLUDING DISCLOSED", joined.filter((j) => !disclosed.has(j.itemId)));
report("DISCLOSED ONLY", joined.filter((j) => disclosed.has(j.itemId)));

// High-confidence only: if the signal is real it should sharpen, not vanish.
report("CONFIDENCE >= 2, excluding disclosed", joined.filter((j) => !disclosed.has(j.itemId) && j.confidence >= 2));

console.log("\n### kind breakdown among `yes` judgements (excluding disclosed)");
const kinds = new Map<string, { contested: number; control: number }>();
for (const j of joined) {
  if (!j.ambiguous || disclosed.has(j.itemId)) continue;
  const e = kinds.get(j.kind) ?? { contested: 0, control: 0 };
  if (j.disputed) e.contested++;
  else e.control++;
  kinds.set(j.kind, e);
}
for (const [kind, v] of [...kinds.entries()].sort((a, b) => b[1].contested + b[1].control - (a[1].contested + a[1].control))) {
  const total = v.contested + v.control;
  console.log(`  ${kind.padEnd(22)} contested=${String(v.contested).padStart(3)} control=${String(v.control).padStart(3)}  contested share ${two(v.contested, total)}`);
}
