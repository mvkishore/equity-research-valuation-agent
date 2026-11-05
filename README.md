# Equity Research & Valuation Agent

A personal **buy-side** equity research app for deciding whether a stock deserves
capital in your portfolio — add, hold, trim, or exit — built on a
Buffett / Munger / Graham framework plus modern FCF, ROIC and DCF analysis.

> A wonderful business can be a terrible investment at the wrong price.
> Business quality is judged first, and priced second.

This is a personal research tool, not financial advice.

## What it does

Enter any listed ticker and it runs a full investment-committee analysis:

- **Live quote** plus web-researched, reported fundamentals (revenue, margins,
  ROIC, FCF, stock-based compensation and dilution). Anything that cannot be
  sourced is shown as a named *data gap* — never invented.
- **10-dimension scorecard** (business quality, moat, revenue durability,
  profitability, FCF generation, balance-sheet strength, capital allocation,
  management, valuation attractiveness, risk) — quality kept separate from price.
- **Moat & competitors, risks with warning signals, and explicit thesis breakers.**
- **DCF computed deterministically in code** (`server/src/actions.ts`):
  Bear / Base / Bull scenarios, probability-weighted intrinsic value,
  10% / 20% / 30% margin-of-safety entry prices, and a reverse DCF
  (implied growth backed out by bisection). Sliders let you test your own
  assumptions.
- **Committee reconciliation:** the final verdict (Strong Buy / Buy / Accumulate /
  Hold / Watchlist / Trim / Sell) is checked against the computed numbers on the
  server, so a verdict cannot contradict the valuation gap.
- **Change detection:** re-running a ticker after earnings diffs the new report
  against the previous version — did the business become more valuable, or did
  only the price change?
- **Thesis memory:** per-company thesis check-in notes.
- **Portfolio tab:** holdings / watchlist tracked against their latest verdicts.
- **Opportunity Cost tab:** ranks every analyzed name by expected return for a
  stated amount of new capital ("where does the next $10,000 work hardest?").

Discipline rules enforced by design: never buy because a stock fell, never sell
because it rose, analyst price targets are never used as intrinsic value, SBC is
always counted as a cost, and every new dollar is compared against its best
alternative.

## Architecture

```
client/src/App.tsx      # 643 lines — the whole UI: 3 tabs, report, progress panel
client/src/api.ts       # thin client for the server actions
client/src/main.tsx     # React entry point
client/src/theme.css    # Tailwind 4 theme
server/src/actions.ts   # 403 lines — the brain:
                        #   dcfPerShare()        deterministic DCF
                        #   impliedGrowth()      reverse DCF (bisection)
                        #   Actions.analyzeTicker  quote → research → synthesis
                        #                          → DCF → reconciliation → save
                        #   Actions.getQuote     fast ticker pre-check
server/src/schema.ts    # Drizzle schema: analyses, positions, thesis_notes
drizzle/*.sql           # SQLite migrations
DATA-PLAN.md            # design doc for the research schema — read this first
space.json              # Muse space manifest (runtime, entry point)
```

Stack: TypeScript, Bun, React 19, Drizzle ORM (SQLite), Zod,
TanStack React Query, Recharts, Tailwind CSS 4.

## Running it

### Prerequisites

- [Bun](https://bun.sh) 1.3+ (`packageManager` is pinned to `bun@1.3.10`)
- This app was built as a **Muse (Hatch) TypeScript Space**. Its server imports
  `@hatch/space-sdk` (see `package.json` — a `file:` dependency on the Muse
  runtime) and the hosted runtime injects the database, the live-quote /
  finance data tool, and web search used by `analyzeTicker`.

That means:

1. **Inside Muse (recommended):** the app runs as-is. The Muse runtime
   provides the SDK, the SQLite database (`app.db`, created from `drizzle/`
   migrations), and the data tools.
2. **Standalone / local development:** you can install, typecheck and build
   the code, and read/edit everything, but to *execute* the analysis pipeline
   outside Muse you will need to replace the `@hatch/space-sdk` action layer
   and provide your own equivalents for:
   - a quotes/financials API (for `getQuote` / fundamentals),
   - web search + an LLM synthesis step (for the committee report), and
   - a database handle (any SQLite via Drizzle works with `server/src/schema.ts`).

### Install, typecheck, build

```bash
bun install
bun run typecheck   # tsc --noEmit for both client and server
bun run build       # build:server (Bun bundle) + build:client
```

Build outputs:

- Server bundle: `server/dist/actions.js`
- Client bundle: `client/dist/` (entry: `client/dist/index.html`, per `space.json`)

### How an analysis runs (1–3 minutes)

Analysis is split into two server steps, each with its own time budget — a
single combined call could exceed the per-action deadline on research-heavy
tickers (MELI measured ~150s combined: fundamentals synthesis ~74s +
narrative synthesis ~72s) and time out.

1. `getQuote` — fast pre-check; a bogus ticker fails in seconds with a clear error.
2. `beginAnalysis` — live quote, 5+ years of researched financials; the result
   is saved as a draft in `analysis_drafts` (migration `0003`).
3. `completeAnalysis` — moat/thesis/risks narrative, scorecard synthesis, then
   the DCF, reverse DCF, margin-of-safety prices and verdict reconciliation,
   all computed in TypeScript on the server — not by the language model.
   If this step times out, it retries automatically from the saved draft
   (no duplicates: a consumed draft cannot be completed twice).
4. The result is saved as a new row/version in `analyses`, which powers the
   change-detection diff on the next run. The progress panel shows the actual
   server step (not a clock estimate), and the UI polls while a run is in
   flight, so a dropped connection or a page reload recovers and displays
   the finished report instead of spinning forever.

## Data notes

- Production data lives in the Muse app's own SQLite database and is **not**
  included in this repository (no `app.db`, no `node_modules`, no build output).
- Figures are reported financials where sourced; estimates and guidance are
  labelled as such. Unsourceable fields are explicit gaps, by design.

## License

Personal project — all rights reserved unless the owner states otherwise.
