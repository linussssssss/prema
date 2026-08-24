import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lintRulesText, type LintHit } from "../src/index.ts";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name: string) => readFileSync(path.join(fixturesDir, name), "utf8");

const ruleIds = (hits: LintHit[]) => new Set(hits.map((h) => h.ruleId));
const hitsFor = (hits: LintHit[], ruleId: string) => hits.filter((h) => h.ruleId === ruleId);

describe("hedge-words", () => {
  it("flags each hedge word with its span", () => {
    const text = "Resolves Yes once the acquisition is confirmed by credible sources.";
    const hits = hitsFor(lintRulesText(text), "hedge-words");
    const words = hits.map((h) => text.slice(h.span.start, h.span.end).toLowerCase());
    expect(words).toContain("confirmed");
    expect(words).toContain("credible");
  });

  it("prefers the longest match at one offset (significantly over significant)", () => {
    const text = "GDP must rise significantly.";
    const hits = hitsFor(lintRulesText(text), "hedge-words");
    expect(hits).toHaveLength(1);
    expect(text.slice(hits[0]!.span.start, hits[0]!.span.end)).toBe("significantly");
  });

  it("is silent on neutral wording", () => {
    expect(hitsFor(lintRulesText("Resolves Yes if the S&P 500 closes above 6000."), "hedge-words")).toHaveLength(0);
  });
});

describe("deadline-no-timezone", () => {
  it("flags 'by <date>' with no timezone anywhere as high severity", () => {
    const hits = hitsFor(lintRulesText("The merger must close by May 31, 2026."), "deadline-no-timezone");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.severity).toBe("high");
  });

  it("downgrades to warn when a timezone exists but boundary semantics don't", () => {
    const hits = hitsFor(lintRulesText("The merger must close by May 31, 2026 ET."), "deadline-no-timezone");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.severity).toBe("warn");
  });

  it("is silent when timezone and boundary are both explicit", () => {
    const text = "The merger must close by May 31, 2026, 11:59 PM ET.";
    expect(hitsFor(lintRulesText(text), "deadline-no-timezone")).toHaveLength(0);
  });

  it("does not treat 'Ethereum' as a timezone", () => {
    const hits = hitsFor(lintRulesText("Ethereum must flip Bitcoin by December 31, 2026."), "deadline-no-timezone");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.severity).toBe("high");
  });
});

describe("occurrence-vs-reporting", () => {
  it("flags a deadline tied to a lagging source without occurrence semantics", () => {
    const text = "Resolves Yes if the company files for bankruptcy by June 30, 2026, per court records.";
    const hits = hitsFor(lintRulesText(text), "occurrence-vs-reporting");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.severity).toBe("high");
  });

  it("is silent when the rules say which side of the gap counts", () => {
    const text =
      "Resolves Yes if the company files for bankruptcy by June 30, 2026, per court records, " +
      "regardless of when the filing is published.";
    expect(hitsFor(lintRulesText(text), "occurrence-vs-reporting")).toHaveLength(0);
  });
});

describe("status-verb-gap", () => {
  it("flags a bare status verb", () => {
    const hits = hitsFor(lintRulesText("Resolves Yes if the CEO steps down in 2026."), "status-verb-gap");
    expect(hits).toHaveLength(1);
  });

  it("is silent when edge cases are enumerated", () => {
    const text = "Resolves Yes if the CEO steps down in 2026 for any reason, including death or an interim replacement.";
    expect(hitsFor(lintRulesText(text), "status-verb-gap")).toHaveLength(0);
  });
});

describe("vague-source", () => {
  it("flags a source clause with no URL and no venue source field", () => {
    const text = "The primary resolution source for this market will be a consensus of credible reporting.";
    expect(hitsFor(lintRulesText(text, { resolutionSource: "" }), "vague-source")).toHaveLength(1);
  });

  it("is silent when the venue resolutionSource field is set", () => {
    const text = "The primary resolution source for this market will be a consensus of credible reporting.";
    expect(hitsFor(lintRulesText(text, { resolutionSource: "bls.gov/cpi" }), "vague-source")).toHaveLength(0);
  });
});

describe("outcomes-not-exhaustive", () => {
  it("flags >2 outcomes without a catch-all", () => {
    const hits = lintRulesText("Which candidate wins the nomination?", {
      outcomes: ["Newsom", "Ocasio-Cortez", "Ossoff"],
    });
    expect(ruleIds(hits)).toContain("outcomes-not-exhaustive");
  });

  it("is silent with an Other outcome or a binary market", () => {
    expect(
      ruleIds(lintRulesText("Which candidate wins?", { outcomes: ["Newsom", "Ossoff", "Other"] })),
    ).not.toContain("outcomes-not-exhaustive");
    expect(ruleIds(lintRulesText("Will X happen?", { outcomes: ["Yes", "No"] }))).not.toContain(
      "outcomes-not-exhaustive",
    );
  });
});

describe("no-na-condition", () => {
  it("flags rules with no invalidity/N-A provision", () => {
    const hits = hitsFor(lintRulesText("Resolves Yes if X happens, otherwise No."), "no-na-condition");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.severity).toBe("info");
  });

  it("is silent when a 50-50 or ambiguity provision exists", () => {
    const text = "If the event is canceled, the market resolves 50-50.";
    expect(hitsFor(lintRulesText(text), "no-na-condition")).toHaveLength(0);
  });
});

describe("real historical markets (recorded Gamma fixtures)", () => {
  it("Biden-COVID 2020: 'before November 3rd, 2020' with no timezone → deadline-no-timezone high", () => {
    const text = fixture("biden-covid-before-election-2020.txt");
    const hits = hitsFor(lintRulesText(text, { resolutionSource: "" }), "deadline-no-timezone");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.severity).toBe("high");
    expect(text.slice(hits[0]!.span.start, hits[0]!.span.end)).toMatch(/before November 3rd, 2020/i);
  });

  it("Netanyahu 2021: 'remain prime minister' with no enumerated edge cases → status-verb-gap", () => {
    const text = fixture("netanyahu-remain-pm-through-2021.txt");
    const hits = hitsFor(lintRulesText(text, { resolutionSource: "protocol.un.org/x" }), "status-verb-gap");
    expect(hits.length).toBeGreaterThan(0);
    expect(text.slice(hits[0]!.span.start, hits[0]!.span.end).toLowerCase()).toContain("remain prime minister");
  });

  it("Xi Jinping 2025: hedge words hit, but enumerated edge cases suppress status-verb-gap", () => {
    const text = fixture("xi-jinping-out-before-2027.txt");
    const hits = lintRulesText(text, { resolutionSource: "" });
    expect(ruleIds(hits)).toContain("hedge-words");
    expect(ruleIds(hits)).not.toContain("status-verb-gap");
  });
});

describe("announcement-vs-report", () => {
  it("catches the June 2026 Strategy market that occurrence-vs-reporting missed", () => {
    // Real listing-time text of market 2169995 (>$60M, escalated to a DVM vote).
    // The dispute: 32 BTC sold 26-31 May, disclosed in an 8-K filed 1 June. The
    // act met the deadline; the evidence did not. occurrence-vs-reporting needs
    // a formal lagging source and this text names none, so it stayed silent.
    const text = fixture("microstrategy-sells-bitcoin-may-2026.txt");
    const ids = ruleIds(lintRulesText(text, { outcomes: ["Yes", "No"] }));
    expect(ids).toContain("announcement-vs-report");
    expect(ids).not.toContain("occurrence-vs-reporting"); // pins the gap this rule fills
  });

  it("stays silent without a private act, however reporting-heavy the source", () => {
    // "consensus of credible reporting" is boilerplate in 38% of the corpus, so
    // it must never be sufficient on its own — that way lies another
    // hedge-words.
    const text =
      'This market resolves to "Yes" if BTC trades above $100,000 by May 31, 2026, ' +
      "per a consensus of credible reporting.";
    expect(ruleIds(lintRulesText(text))).not.toContain("announcement-vs-report");
  });

  it("stays silent when the rules disambiguate which date governs", () => {
    const text =
      "Resolves Yes if the company sells any Bitcoin by May 31, 2026, regardless of when " +
      "it is reported, per a consensus of credible reporting.";
    expect(ruleIds(lintRulesText(text))).not.toContain("announcement-vs-report");
  });

  it("stays silent with no deadline", () => {
    const text = "Resolves Yes if the company sells any Bitcoin, per a consensus of credible reporting.";
    expect(ruleIds(lintRulesText(text))).not.toContain("announcement-vs-report");
  });
});

describe("template-residue", () => {
  const binary = { outcomes: ["Yes", "No"] };

  it("flags a resolution target that is not one of the market's outcomes", () => {
    // The live case: binary Fed markets whose rules resolve to a bracket that
    // exists only in the multi-outcome template they were copied from.
    const hits = lintRulesText(
      'If the Fed holds rates steady, this market resolves to the "No change" bracket.',
      binary,
    );
    const hit = hits.find((h) => h.ruleId === "template-residue");
    expect(hit).toBeDefined();
    expect(hit!.message).toContain("No change");
    // The span must point at the offending text, not the whole document.
    expect(hit!.span.end).toBeGreaterThan(hit!.span.start);
  });

  it("does not flag a target that IS an outcome", () => {
    const hits = lintRulesText('This market resolves to "Yes" if the bill passes.', binary);
    expect(ruleIds(hits)).not.toContain("template-residue");
  });

  it("is case- and punctuation-insensitive when matching outcomes", () => {
    const hits = lintRulesText('Resolves to "yes." if confirmed.', binary);
    expect(ruleIds(hits)).not.toContain("template-residue");
  });

  it("exempts legitimate void targets", () => {
    // Voiding to N/A or 50-50 is a real resolution path, not a stray label.
    for (const t of ['resolves to "N/A" if the event is cancelled.', 'resolves to "50-50" if undetermined.']) {
      expect(ruleIds(lintRulesText(t, binary))).not.toContain("template-residue");
    }
  });

  it("does not fire on unquoted prose about resolution", () => {
    // High precision is the point: free-text mentions are too noisy to flag.
    const hits = lintRulesText(
      "This market resolves to the outcome determined by the official source.",
      binary,
    );
    expect(ruleIds(hits)).not.toContain("template-residue");
  });

  it("stays silent when outcomes are unknown", () => {
    expect(ruleIds(lintRulesText('resolves to "No change" bracket.', {}))).not.toContain("template-residue");
  });

  it("reports each distinct stray target once", () => {
    const hits = lintRulesText(
      'Resolves to "No change" bracket. Otherwise resolves to "No change" bracket again.',
      binary,
    ).filter((h) => h.ruleId === "template-residue");
    expect(hits).toHaveLength(1);
  });
});

describe("determinism", () => {
  it("same input, same output", () => {
    const text = fixture("xi-jinping-out-before-2027.txt");
    expect(lintRulesText(text)).toEqual(lintRulesText(text));
  });

  it("empty text yields no hits", () => {
    expect(lintRulesText("   ")).toEqual([]);
  });
});
