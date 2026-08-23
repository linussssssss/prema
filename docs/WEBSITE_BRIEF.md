# Prompt: build the Prema marketing website

> Paste everything below into a fresh Claude Code session. It is complete and
> self-contained — brand, copy, tech, and acceptance criteria. Use the project
> name **Prema** everywhere; there is no other name to display.

---

You are building the public marketing website for **Prema**. Build the whole
site to the spec below. Where a value is configurable it has a real default —
use it. Do not invent metrics, testimonials, customer/venue logos, press
quotes, or social handles; where we don't have something, omit it rather than
fake it. Work in small, conventional commits and write a README.

## 0. What Prema is (context — internalize, don't paste verbatim)

Prema is the neutral resolution layer for prediction markets. Prediction
markets settled roughly $50 billion of volume in July 2026. The objective
questions (did a team win; did a price close above a number) are settled
automatically by oracles. The remaining 10–15% — where the *wording* is the
problem, not the data — are settled by a token vote or an in-house desk, with
no precedent database, no structured evidence, and no independent appeal.
Disputes are at record highs. Off-the-shelf language models resolve about
83–89% of these questions correctly, and only 84–85% on politics and crypto,
which is exactly where disputes cluster. Prema exists for that ambiguous tail.

Prema has three surfaces, built in order:
- **A. Dispute-risk score** — at listing time, read a market's rules and return
  a 0–100 probability it will be contested, typed ambiguity flags, a suggested
  rewrite, and the nearest precedents. Sold later as an API + webhooks.
- **B. Evidence & precedent engine** — when a market is contested, assemble
  timestamped, hashed snapshots of every relevant source, map each fact to the
  exact rule clause, pull precedents for the same crux, and run independent
  multi-model adjudication with a dissent. Delivered as a signed bundle.
- **C. Appeals desk** — human reviewers with conflict-of-interest attestations
  sign decisions on top of the evidence; every bundle, decision, and daily
  audit-log head is hash-anchored on-chain.

**Non-negotiables (these are brand pillars and legal framing — surface them):**
1. Prema never operates a market, takes a position, holds customer funds, or
   issues a token.
2. No hindsight: every retrieval is filtered to what was public at the time;
   backtests use a time split fixed in code.
3. Append-only and hashed: scores, evidence, and decisions are versioned,
   never overwritten.
4. Outputs are a recommendation, not a ruling — published with confidence and
   dissent, mistakes shown in the open.
5. Conflicts declared: reviewers attest, assignments are random, logs public.

**The startup route (include this as a "Where this goes" section):**
- **Now** — the public reference for resolution risk: a complete record of
  prediction-market resolutions since 2024, an openly published calibration
  page for the Prema Score, and retro-adjudications of past disputes with
  accuracy shown in full. Nothing is sold before the calibration page is live.
- **12–18 months** — paid infrastructure: bots and market makers subscribe to
  the risk-score API; large position holders buy evidence bundles during
  disputes; a regulated venue adopts the listing gate and escalation desk.
- **3–5 years** — the layer everyone routes to: venues license the precedent
  corpus, oracle networks hand over the subjective tail, regulators cite the
  audit trail. Prema is built to be worth more for being neutral.

Because the calibration page and dataset are not public yet, the site is
**pre-launch**: it explains the mission, the method, and the route, runs a live
rules-reader demo, and captures early-access emails. It must not display any
Prema accuracy numbers, dispute counts, or calibration charts yet — those
launch with the dataset. Say so honestly where relevant.

## 1. Tech stack & architecture

- **Astro 4+** with **TypeScript** (strict), **Tailwind CSS**, a single
  **React island** (`@astrojs/react`) for the interactive rules-reader demo.
- **Self-hosted fonts** via `@fontsource-variable/fraunces`,
  `@fontsource-variable/inter`, `@fontsource/ibm-plex-mono` (no external font
  requests — performance and privacy).
- **Content collections** (Markdown/MDX) for a "Dispatches" writing section and
  the method page content.
- **Astro integrations**: `@astrojs/sitemap`, `@astrojs/mdx`. Generate
  `robots.txt`. Generate an OG image (static, brand-styled) for social cards.
- **Waitlist backend**: a Cloudflare Pages Function at `functions/api/subscribe.ts`
  storing emails in a KV namespace (details in §6). The site targets
  **Cloudflare Pages** (free tier; matches Prema's infra choices).
- Project name: `prema-web`, standalone repo/folder (not a monorepo member).
- `SITE_URL` default `https://prema.markets`; `CONTACT_EMAIL` default
  `hello@prema.markets` — put both in one `src/config.ts`; note in the README
  they should be changed to the real domain/mailbox.
- Light and dark themes are both first-class (§2). Respect
  `prefers-color-scheme` and offer a manual toggle that persists in
  `localStorage` (wrapped in try/catch).
- **Accessibility**: semantic HTML, WCAG AA contrast, visible focus states,
  full keyboard operability, `prefers-reduced-motion` honored, alt text on all
  imagery, correct heading order.
- **Performance/SEO**: ship near-zero JS except the one island; Lighthouse
  ≥ 95 on Performance/Accessibility/Best-Practices/SEO on the home page;
  per-page `<title>`/meta description/canonical/OpenGraph/Twitter tags.

Suggested structure:
```
prema-web/
  astro.config.mjs   tailwind.config.ts   tsconfig.json   package.json
  src/
    config.ts
    styles/tokens.css        # CSS custom properties (light + dark)
    layouts/Base.astro
    components/ Header.astro Footer.astro ThemeToggle.astro
                Mark.astro   ScoreBadge.astro  ProductCard.astro
                RulesReader.tsx   # the React island
    pages/ index.astro  method.astro  who-its-for.astro
           dispatches/index.astro  dispatches/[...slug].astro
           about.astro  legal.astro  404.astro
    content/ config.ts  dispatches/*.md
    lib/ linter.ts               # client-side rules used by RulesReader
  functions/api/subscribe.ts
  public/ robots.txt  favicon.svg
  README.md
```

## 2. Brand system (Prema)

**Name & voice.** Always "Prema". Tone is a **court reporter, not a take
merchant**: precise, evidence-first, understated, confident about method and
humble about certainty. No hype, no exclamation marks, no emoji in product
copy, no crypto slang, no "revolutionary/disrupt". Headings in **sentence
case**. Active voice. Numbers, scores, hashes, and timestamps always in the
mono typeface. Frame model output as "a recommendation, not a ruling."

**Color tokens.** Define as CSS custom properties on `:root` (light) and
`:root[data-theme="dark"]` / `@media (prefers-color-scheme: dark)`:

Light:
- `--paper` `#F6F5F1` (page background, warm off-white — a "document" ground)
- `--surface` `#FFFFFF`
- `--ink` `#16181D` (primary text)
- `--ink-muted` `#565B63`
- `--hairline` `#E3E1D9`
- `--brand` `#0B6E6E` (deep teal — instrument/measurement, trust; links + primary accent)
- `--brand-strong` `#085454` (hover/active)
- risk ramp for the score: `--risk-low` `#12805C`, `--risk-mid` `#C98A00`, `--risk-high` `#B23A1E`

Dark:
- `--paper` `#0E1013`, `--surface` `#16191E`, `--ink` `#ECEBE5`,
  `--ink-muted` `#9BA1A9`, `--hairline` `#262A31`,
  `--brand` `#2AA7A0`, `--brand-strong` `#3FC0B8`,
  risk ramp: `--risk-low` `#2BBE86`, `--risk-mid` `#E0A93B`, `--risk-high` `#E06A47`

Give `body` an explicit `--paper` background in both themes. Meet AA contrast
for every text/background pair.

**Typography.**
- Display / headings & article titles: **Fraunces** (variable serif), weights
  400–600, slight optical size on large headings. Fallback `Georgia, serif`.
  Editorial gravitas — the "record of authority" feel.
- Body / UI: **Inter** (variable), 400/500/600. Fallback `system-ui, sans-serif`.
- Mono / data, scores, hashes, timestamps, code: **IBM Plex Mono**, 400/500.
  Fallback `ui-monospace, SFMono-Regular, monospace`.

**Logo / mark.** A minimal "gauge": inside a 24×24 rounded square (2px corner
radius, 1.5px stroke in `--brand`, no fill) draw a horizontal baseline from
(5,16) to (19,16) and a single vertical marker tick from (9,16) up to (9,7) —
a measurement point on a scale, i.e. a resolved position. Beside it, the
wordmark "Prema" in Fraunces 600 in `--ink`. Build it as an inline SVG
component (`Mark.astro`) that inherits `currentColor` where possible. Derive
`favicon.svg` and the OG image from the same mark on a `--paper` ground.

**Layout & imagery.** A document/record aesthetic: generous whitespace,
hairline rules, restrained line diagrams (a probability scale, a
propose→dispute→settle→vote timeline), and monospace data. **No stock photos**,
no people/handshake imagery, no 3D crypto art. Diagrams are inline SVG, theme-
aware. Max content width ~72ch for prose, wider for full-bleed section bands.

## 3. Site map & page copy (use this copy verbatim unless noted)

**Global header:** the Mark + wordmark (links home); nav: Method,
Who it's for, Dispatches, About; a right-aligned "Get early access" button that
scrolls to the waitlist; the theme toggle. Sticky, hairline bottom border.

**Global footer:** wordmark; nav repeat; the mono line
`Recommended assessments, not rulings.`; the legal disclaimer (§7); a
`Contact` mailto to `CONTACT_EMAIL`; `© Prema 2026`. No social links unless
provided.

### Home (`index.astro`)

Hero:
- Eyebrow (mono): `Resolution risk, measured.`
- H1: **Some markets are settled by data. The rest are settled by wording.**
- Subhead: "Prema is the neutral resolution layer for prediction markets. We
  score the probability a market will be disputed before it lists, read its
  rules for the ambiguities that cause fights, and assemble the evidence and
  precedent when a market is contested — with a timestamped, hashed audit trail
  behind every call. A recommendation, never a ruling."
- Primary CTA: `Get early access` (→ waitlist). Secondary: `Read the method`
  (→ /method).

Problem band:
- H2: **The ambiguous tail is where the money is lost.**
- Body: "Prediction markets settled roughly $50 billion in volume in July 2026.
  The objective questions are settled automatically by oracles. The rest — the
  10–15% where the wording is the problem — are settled by a token vote or an
  in-house desk, with no precedent database, no structured evidence, and no
  independent appeal. Disputes are at record highs. Off-the-shelf language
  models resolve about 83–89% of questions correctly, and only 84–85% on
  politics and crypto, exactly where the disputes cluster. Prema is built for
  that tail." (Keep the three figures in `src/config.ts` as an editable
  `industryContext` object with a short note that sources will be attached; do
  not present them as Prema's own results.)

Prema Score + demo:
- H2: **The Prema Score: dispute risk, before you trade.**
- Body: "At listing time, Prema reads a market's rules and returns a 0–100
  estimate of the probability it will be contested, the specific ambiguity
  flags it found, a suggested rewrite, and the closest precedents. Try the
  rules reader on any market wording below."
- The `RulesReader` island (§5).
- Caption under it (mono, muted): "A simplified, client-side preview of Prema's
  deterministic rules linter. The production linter runs seven rule families
  over every rules version and is calibrated against the outcomes of real
  disputes."

Three surfaces (three `ProductCard`s, each with a small status chip):
- **Dispute-risk score** — chip `In development` — "A listing-time API and
  webhooks: the probability a market is contested, typed ambiguity flags, a
  suggested rewrite, and the nearest precedents."
- **Evidence & precedent** — chip `Planned` — "When a market is contested:
  timestamped, hashed snapshots of every source, each fact mapped to the exact
  rule clause, precedents for the same crux, and independent multi-model
  adjudication with a dissent — delivered as a signed bundle."
- **Appeals desk** — chip `Planned` — "Human reviewers with conflict-of-interest
  attestations sign decisions on top of the evidence. Every bundle, decision,
  and daily audit-log head is hash-anchored on-chain."

Neutrality band (H2: **Neutral by construction.**) — five items, mono labels:
1. "We never operate a market, take a position, hold customer funds, or issue a
   token."
2. "No hindsight. Every retrieval is filtered to what was public at the time;
   backtests use a time split fixed in code."
3. "Append-only and hashed. Scores, evidence, and decisions are versioned,
   never overwritten."
4. "A recommendation, not a ruling. We publish outcomes with confidence and
   dissent — and our mistakes, in the open."
5. "Conflicts declared. Reviewers attest, assignments are random, logs are
   public."

Where this goes (H2: **Where this goes.**) — the three horizons from §0 as a
three-step vertical timeline (Now / 12–18 months / 3–5 years) using the copy
above. End with the line: "We sell nothing before the calibration page is live."

Waitlist (id `early-access`, H2: **Get early access.**):
- Body: "The calibration page and the daily riskiest-markets digest launch with
  the public dataset. Leave your email to get in first — one launch note and the
  digest when it ships, nothing else."
- Form + states per §6.

### Method (`method.astro`) — real content, no fabrication

- Intro: "Prema's method is public on purpose. Here is how we define a disputed
  market, what the rules reader looks for, and how we will report our own
  accuracy."
- **The contested label.** "We label a market *contested* if any of these is
  true: it was disputed on-chain; it escalated to a token-holder vote; it
  resolved N/A (an even payout); or its rules were edited after it began
  trading. We treat sharp last-minute price reversals and human flags as
  supporting signals, not part of the label."
- **What the rules reader looks for (seven families).** List them:
  1. Hedge words with no measurable threshold (credible, widely reported,
     significant, official, substantial, confirmed, announced, effectively).
  2. A deadline with no timezone or no inclusive/exclusive boundary.
  3. An occurrence-vs-reporting gap: the event must happen by a date, but the
     named source publishes on a lag.
  4. A status-change verb with no enumerated edge cases (leave office, step
     down, resign, launch, release, approve, sign — without death, interim,
     partial, or delayed-effect handling).
  5. A source clause that names a publisher but no specific feed or page, or a
     source that may not exist at resolution time.
  6. A multi-outcome market whose outcomes aren't clearly exclusive and
     exhaustive, with no "Other"/N/A.
  7. No N/A or invalidity condition at all.
- **The time split (fixed in code).** "Models are trained on markets listed
  through 31 December 2025, validated on the first half of 2026, and tested on
  each later month as it arrives. The split never moves — it is the guard
  against fitting the past."
- **No hindsight. Append-only. A recommendation, not a ruling.** One short
  paragraph each, echoing the pillars.
- Close with a callout: "The calibration page — our predicted dispute rates
  against realized outcomes, by category, updated openly — launches with the
  public dataset. Leave your email to be told when it does." (link to waitlist)

### Who it's for (`who-its-for.astro`)

Four blocks:
- **Traders & bot operators** — "Stop losing to wording traps. Screen any
  market's rules and get the riskiest open markets, daily."
- **Market makers & funds** — "Price resolution risk into your quotes and
  sizing with a real-time API."
- **Venues** — "Fewer disputes, a defensible listing and escalation process,
  and an independent desk regulators can trust."
- **Oracle networks** — "Route the subjective tail to a neutral layer built to
  handle it."
Each ends with a `Get early access` link to the waitlist.

### Dispatches (`dispatches/`)

A content collection for Prema's writing (the future home of dispute
post-mortems, method notes, and a quarterly "State of resolution risk"). Index
lists entries (title, date, one-line summary, reading time). Ship **one real
seed entry** titled **"How Prema reads a market"** — a method note (≈600–900
words) that walks through the seven rule families using clearly hypothetical
example wordings (not real disputes), and explains why each pattern predicts a
fight. Mark example wordings as illustrative. Do not invent real disputes,
figures, or outcomes. Where the future post-mortems will go, add a short note:
"Dispute post-mortems — the anatomy of specific contested markets — publish
with the dataset."

### About (`about.astro`)

- H1: **An independent resolution layer.**
- Body: "Prema is an independent team building the neutral infrastructure for
  resolving ambiguous prediction-market outcomes. We are deliberately not a
  venue, an oracle that rules, or a token. Our value is that we are worth more
  for being neutral, and we build — in code and in process — so that stays
  true." Restate the five non-negotiables. Contact via `CONTACT_EMAIL` and the
  waitlist. Do not fabricate team bios, headcount, investors, or a founding
  date beyond "2026".

### Legal (`legal.astro`) and 404

Legal page holds the disclaimer, a plain-language privacy note (§7), and a
short terms note. 404: on-brand, a mono "no market found at this address" line
and a link home.

## 4. The rules-reader demo (`RulesReader.tsx` + `lib/linter.ts`)

A client-side, dependency-free React island. A textarea pre-filled with the
first sample below; as the user edits, flags update live. Show each flag as a
row: a severity dot (high = `--risk-high`, medium = `--risk-mid`), the rule
name, a one-line explanation, and the matched text highlighted in the input.
Show a small mono summary ("3 flags · 2 high"). Include a row of three sample
buttons that load the samples. Keep everything in `lib/linter.ts` as pure
functions so it is easy to extend.

Implement these rule families client-side (faithful to Prema's real linter):
- **hedge-words** (medium): flag any of `credible, widely reported,
  significant, significantly, official, officially, substantial, confirmed,
  announced, effectively, widely` (case-insensitive, word-boundary).
- **deadline-no-timezone** (high): flag a deadline phrase (`by|before|through|
  until|on or before|no later than` followed by a month-name date, a
  `YYYY-MM-DD`, an `M/D`, `end of <month/year>`, or a bare 4-digit year) when
  the text contains no timezone token (`ET, EST, EDT, CT, CST, PT, PST, UTC,
  GMT, CET`, or `eastern/pacific/central time`). If a timezone exists but no
  explicit boundary (`11:59`, `midnight`, `end of day`, `on or before`,
  `inclusive`), downgrade to medium.
- **status-verb-gap** (high): flag any of `leave office, leaves office, step
  down, steps down, resign, resigns, cease operations, launch, launches,
  release, releases, approve, approves, sign, signs, remain in office, remains
  in office` unless the text also contains an edge-case marker (`for any
  reason, or otherwise, interim, acting, temporar, death, dies, incapacit,
  regardless of, even if, partial, delayed`).
- **vague-source** (medium): if the text contains a source cue (`resolution
  source, resolve according to, resolved based on, as reported by, consensus
  of`) but no URL and no bare domain (`something.com/org/net/gov/io`), flag it.
- **no-na-condition** (low/info): if the text contains none of `50-50, 50/50,
  n/a, invalid, cancel, void, annul, unable to determine, in the event of
  ambiguity, refund`, flag it.

Three sample inputs (load via buttons; these are illustrative, not real
markets):
1. "This market resolves Yes if the CEO steps down before May 31, 2026,
   according to credible reporting." — expect: hedge-words, deadline-no-timezone,
   status-verb-gap, vague-source, no-na-condition.
2. "Resolves Yes if the merger closes by Q4 2026, per the company's official
   filing; otherwise No." — expect: deadline-no-timezone (Q4/year with no tz),
   hedge-words (official), and (optionally) an occurrence-vs-reporting note.
3. "Resolves Yes if BTC's closing price on Coinbase at 2026-12-31 23:59:59 UTC
   is above $150,000; No otherwise; N/A if Coinbase halts spot trading that
   day." — expect: no high flags (the contrast case).

Above the demo, a one-line honest note that this is a preview and the
production linter is calibrated against real outcomes.

## 5. Waitlist backend (`functions/api/subscribe.ts`)

- `POST /api/subscribe` with JSON `{ email }`. Validate the email server-side
  (simple, robust regex; reject empty/oversized). On success store to a
  Cloudflare KV namespace bound as `PREMA_WAITLIST` (key = normalized email,
  value = JSON `{ ts, source: "web" }`); treat an existing key as success
  (idempotent), not an error. Return `{ ok: true }` or
  `{ ok: false, error }` with correct status codes. Never log the raw email at
  info level.
- **Graceful degradation:** if the KV binding is absent (local dev), do not
  crash — `console.warn` once and return `{ ok: true }` so the UI works
  everywhere. Document the `wrangler.toml` KV binding + `pages deploy` steps in
  the README.
- Front-end form states: idle, submitting (disabled + spinner text), success
  ("You're on the list — we'll email you when the calibration page is live."),
  already-subscribed (same as success), and error ("Something went wrong —
  try again, or email us."). Validate on the client too, keep it accessible
  (label, `aria-live` for the status), and never block on JS for the page to
  render.

## 6. Honesty & legal rules (hard constraints)

- No fabricated metrics, calibration charts, dispute counts, testimonials,
  customer/venue/partner logos, press quotes, team bios, funding, or social
  handles. Omit what we don't have.
- Present the three industry figures ($50B July 2026; 83–89% overall; 84–85%
  politics/crypto) as industry context in one editable config object, not as
  Prema results.
- Footer disclaimer (verbatim): "Prema publishes recommended assessments, not
  rulings, and does not provide financial or investment advice. Prema does not
  operate prediction markets, take positions, hold customer funds, or issue any
  token."
- Privacy note (verbatim intent): "We store the email you give us only to
  contact you about early access to Prema. We don't sell or share it, and you
  can ask us to delete it at any time by emailing us."

## 7. Deliverables & acceptance

- `npm run dev` serves the site; `npm run build` produces a static site (plus
  the Pages Function) with no type errors and no console errors.
- All pages in §3 exist with the specified copy; the rules reader works and
  matches the expected flags on the three samples; the waitlist form works and
  degrades gracefully without KV.
- Both light and dark themes are correct and AA-contrast; the toggle persists;
  `prefers-reduced-motion` is honored; keyboard navigation and focus states
  work throughout.
- Lighthouse ≥ 95 on all four categories for the home page; valid sitemap,
  robots.txt, canonical + OpenGraph/Twitter tags with the generated OG image.
- README documents: local dev, the `SITE_URL`/`CONTACT_EMAIL` config, the
  Cloudflare Pages deploy, and the `PREMA_WAITLIST` KV binding.
- Small conventional commits throughout.
