# Data Plan

## Context provenance
- `I don't want an agent that simply summarizes earnings reports, repeats management guidance, calculates P/E ratios, and concludes that a company is undervalued. I want one that thinks like a disciplined long-term investor` (verbatim build request; shaped the committee-report structure — quality judged separately from price, with disagreement surfaced)
- `A wonderful business can be a terrible investment at the wrong price.` (verbatim request; drove the two-axis verdict: Business Quality score vs Valuation Attractiveness score, never averaged into one number)
- `business_quality_score, moat_assessment, fcf_growth_rate, roic, dilution_rate, intrinsic_value_bear/base/bull, margin_of_safety, investment_thesis, thesis_breakers, recommendation` (user's proposed research schema; adopted verbatim as the persisted analysis record shape)
- `If I have $10,000 of additional capital today, which investment offers the best risk-adjusted expected return over five years?` (verbatim request; became the Compare / Opportunity-Cost view)
- `Investing framework (2026-11-05): Buffett (quality/moat/capital allocation), Munger (opportunity cost), Graham (margin of safety), plus FCF/ROIC/DCF/scenario analysis` (standing memory; confirms philosophy framing and the Hold/Add/Trim/Exit language)
- Earnings-intelligence table (Previous vs Current vs What changed) from the request; became change-detection: every re-analysis of a ticker diffs against the prior saved analysis (revenue growth, margins, FCF, dilution, guidance tone, intrinsic value) and answers `Did the business become more valuable, or did only the price change?`

## Tested sources
### ctx.tool.finance_ticker — live quotes + price history
**Used by**: `getQuote`, `analyzeTicker`, `refreshQuotes`
**Test command**: `bun /opt/muse/assets/spaces/ts-runtime/dist/probe-ctx.js < /tmp/probe-finance.ts` with `ctx.tool.finance_ticker("MSFT", { interval: "1d" })`
**Sample output**: resolved exact MSFT; instrument price 535.93 USD, change -19.87 (-3.575%), market_cap 3,765,971,800,000, week_52_high 551.15 / low 349.2, beta 1.066, as_of 2026-11-05T22:22:46Z, plus ~65 daily OHLCV points (Aug–Nov 2026) and a summary carrying P/E 26.4 and EPS 17.95. All observation fields nullable per schema — UI degrades gracefully.
**Processing**: price/market-cap/52w range rendered as-is with as_of timestamp and market-status note; history points feed the price chart verbatim (no resampling, no simulated movement). One symbol per call; watchlist refresh uses Promise.all.

### ctx.tool.web_search — fundamentals, moat, risks distillation source
**Used by**: `analyzeTicker` (three queries per ticker: 5–10yr financials; moat/competitors/management; risks/guidance/earnings)
**Test command**: `bun /opt/muse/assets/spaces/ts-runtime/dist/probe-ctx.js < /tmp/probe-search.ts` with `ctx.tool.web_search("MSFT Microsoft revenue free cash flow ROIC 2025 2024 10K financials")`
**Sample output**: 8 results with rich snippets — stockrow 10-year table (MSFT revenue 2024 $245.1B → 2025 $281.7B, gross margin ~69%, FCF/share, P/E history), matterofstocks cash-flow quality (FCF margin 20.2%, SBC-adjusted FCF margin 16.4%, ROIC proxy 28.4%, ROE 28.4%), 10-K summary (FY2025 revenue +15%, net income $101.8B, diluted EPS $13.64). Sources carry title + URL for citation display.
**Processing**: snippets piped through `ctx.inference.complete` with a Zod schema to distill typed fundamentals (revenue history, margins, ROIC, FCF, OCF, capex, SBC, share-count trend, net cash/debt, reporting period). Reported figures labeled `Reported`; anything the model estimates labeled `Estimate`. Missing fields stay null and render as `Not available` — never invented. Source titles/URLs saved with the analysis for provenance.

### ctx.inference.complete — buy-side synthesis (Zod-schema structured output)
**Used by**: `analyzeTicker` (fundamentals distillation + committee synthesis: scorecard, moat, risks, thesis, breakers, scenario assumptions)
**Test command**: probe confirmed the contract — `complete` requires a Zod `schema` in options (plain-JSON-schema and no-schema calls both error in the probe runner, matching the SDK contract used in actions via `z` from `@hatch/space-sdk`).
**Processing**: inference proposes judgments and scenario assumptions only; all DCF arithmetic (PV of FCF, terminal value, per-share IV, margin-of-safety entry prices, upside/downside, probability-weighted IV) is computed deterministically in server code from those inputs, with assumptions clamped to sane bands (discount rate 6–15%, terminal growth 0–4%) so the model cannot justify a price with an absurd WACC. SBC handled explicitly: SBC-adjusted FCF shown alongside reported FCF and dilution rate is a first-class field.

## Long-term data behavior
- **Refresh policy**: Quotes are live-at-open via finance_ticker (no simulated data; stale cache labeled with as_of on failure). Analyses are point-in-time records — re-running Analyze creates a new version and a change-detection diff, never overwrites history. No scheduled cron: the user analyzes on demand; refresh triggers were none.
- **Growth**: One row per analysis version per ticker (bounded by user usage); positions/watchlist rows are user-entered only — the app starts empty, no seeded holdings, no demo companies presented as the user's portfolio.
- **Ordering**: Analyses newest-first per ticker; portfolio sorted by expected return in Compare, by market value in Portfolio.
- **Time semantics**: Quote as_of rendered in America/New_York (venue time) with the source timestamp; analysis created_at rendered viewer-local; financial figures always carry their fiscal reporting period label (FY/TTM) from the distillation.

## Rejected approaches
- **Tried**: Plain fetch to a free financials API (e.g. unauthenticated endpoints)
  **Why rejected**: No key-free endpoint was verified to return 5–10yr statements reliably; finance_ticker + web_search distillation is proven above and carries citations. No undeclared hosts are fetched at runtime.
- **Tried**: Letting the LLM compute the DCF numbers in prose
  **Why rejected**: Violates the request's own discipline (`show calculations and assumptions`, `never manufacture precision`). Deterministic server-side DCF from stated assumptions is auditable and reproducible; the LLM only supplies judged inputs.
- **Imagery**: Not needed — this is a data-dense analyst tool; price and FCF charts (from real history/financials) carry the visuals. No stock photography or generated art.
