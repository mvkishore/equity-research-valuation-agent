import { defineAction, z, type ActionsModule } from "@hatch/space-sdk";
import { desc, eq } from "drizzle-orm";
import * as schema from "./schema";

// ---------- helpers ----------
function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)); }
function money0(v: number | null | undefined) { return v == null ? "—" : `$${v.toFixed(2)}`; }

function dcfPerShare(fcf0Bn: number, growthPct: number, discountPct: number, terminalPct: number, netCashBn: number, sharesBn: number): number | null {
  if (!isFinite(fcf0Bn) || fcf0Bn <= 0 || !isFinite(sharesBn) || sharesBn <= 0) return null;
  const g = clamp(growthPct, -15, 45) / 100;
  const r = clamp(discountPct, 6, 15) / 100;
  let tg = clamp(terminalPct, 0, 4) / 100;
  if (tg >= r - 0.01) tg = r - 0.015;
  let pv = 0; let fcf = fcf0Bn;
  for (let t = 1; t <= 5; t++) { fcf = fcf0Bn * Math.pow(1 + g, t); pv += fcf / Math.pow(1 + r, t); }
  const tv = (fcf * (1 + tg)) / (r - tg);
  pv += tv / Math.pow(1 + r, 5);
  return (pv + netCashBn) / sharesBn;
}

function impliedGrowth(fcf0Bn: number, discountPct: number, terminalPct: number, netCashBn: number, sharesBn: number, price: number): number | null {
  if (!price || fcf0Bn <= 0) return null;
  let lo = -10, hi = 50;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const iv = dcfPerShare(fcf0Bn, mid, discountPct, terminalPct, netCashBn, sharesBn);
    if (iv == null) return null;
    if (iv < price) lo = mid; else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 10) / 10;
}

const scoreSchema = z.object({
  businessQuality: z.number(), moat: z.number(), growthDurability: z.number(), profitability: z.number(),
  fcfGeneration: z.number(), balanceSheet: z.number(), capitalAllocation: z.number(), management: z.number(),
  valuationAttractiveness: z.number(), riskProfile: z.number(),
});

const synthesisSchema = z.object({
  companyName: z.string(),
  sector: z.string().nullable(),
  reportingPeriod: z.string().nullable(),
  businessSummary: z.string(),
  revenueStreams: z.array(z.string()),
  customers: z.string().nullable(),
  revenueBn: z.number().nullable(),
  revenueGrowthPct: z.number().nullable(),
  grossMarginPct: z.number().nullable(),
  operatingMarginPct: z.number().nullable(),
  netMarginPct: z.number().nullable(),
  roicPct: z.number().nullable(),
  roePct: z.number().nullable(),
  fcfBn: z.number().nullable(),
  ocfBn: z.number().nullable(),
  capexBn: z.number().nullable(),
  sbcBn: z.number().nullable(),
  fcfMarginPct: z.number().nullable(),
  dilutionPctPerYear: z.number().nullable(),
  netCashBn: z.number().nullable(),
  sharesDilutedBn: z.number().nullable(),
  epsDiluted: z.number().nullable(),
  dividendYieldPct: z.number().nullable(),
  debtToEbitda: z.number().nullable(),
  history: z.array(z.object({ year: z.string(), revenueBn: z.number().nullable(), fcfBn: z.number().nullable() })),
  moatType: z.string(),
  moatAssessment: z.string(),
  moatSources: z.array(z.string()),
  competitors: z.array(z.string()),
  whyCustomersStay: z.string(),
  industryNote: z.string(),
  managementNote: z.string(),
  capitalAllocationNote: z.string(),
  sbcNote: z.string(),
  scores: scoreSchema,
  scoreNotes: z.object({
    businessQuality: z.string(), moat: z.string(), growthDurability: z.string(), profitability: z.string(),
    fcfGeneration: z.string(), balanceSheet: z.string(), capitalAllocation: z.string(), management: z.string(),
    valuationAttractiveness: z.string(), riskProfile: z.string(),
  }),
  thesis: z.string(),
  thesisBreakers: z.array(z.string()),
  reasonsToOwn: z.array(z.string()),
  reasonsNotToOwn: z.array(z.string()),
  risks: z.array(z.object({ title: z.string(), category: z.string(), detail: z.string(), signal: z.string() })),
  monitorMetrics: z.array(z.string()),
  guidanceNote: z.string().nullable(),
  bear: z.object({ fcfGrowthPct: z.number(), discountPct: z.number(), terminalGrowthPct: z.number(), narrative: z.string() }),
  base: z.object({ fcfGrowthPct: z.number(), discountPct: z.number(), terminalGrowthPct: z.number(), narrative: z.string() }),
  bull: z.object({ fcfGrowthPct: z.number(), discountPct: z.number(), terminalGrowthPct: z.number(), narrative: z.string() }),
  recommendation: z.enum(["Strong Buy", "Buy", "Accumulate", "Hold", "Watchlist", "Trim", "Sell"]),
  conviction: z.enum(["High", "Medium", "Low"]),
  dataGaps: z.array(z.string()),
});

const analysisSummary = z.object({
  id: z.number(), ticker: z.string(), companyName: z.string(), createdAt: z.string(),
  price: z.number().nullable(), marketCap: z.number().nullable(), currency: z.string(), priceAsOf: z.string().nullable(),
  recommendation: z.string(), conviction: z.string(),
  intrinsicBear: z.number().nullable(), intrinsicBase: z.number().nullable(), intrinsicBull: z.number().nullable(), intrinsicWeighted: z.number().nullable(),
  marginOfSafety: z.number().nullable(), businessQualityScore: z.number().nullable(), valuationScore: z.number().nullable(),
  payload: z.string(),
});

function rowToSummary(r: typeof schema.analyses.$inferSelect) {
  return {
    id: r.id, ticker: r.ticker, companyName: r.companyName, createdAt: r.createdAt.toISOString(),
    price: r.price, marketCap: r.marketCap, currency: r.currency, priceAsOf: r.priceAsOf,
    recommendation: r.recommendation, conviction: r.conviction,
    intrinsicBear: r.intrinsicBear, intrinsicBase: r.intrinsicBase, intrinsicBull: r.intrinsicBull, intrinsicWeighted: r.intrinsicWeighted,
    marginOfSafety: r.marginOfSafety, businessQualityScore: r.businessQualityScore, valuationScore: r.valuationScore,
    payload: r.payload,
  };
}

export const Actions = {
  getQuote: defineAction({
    description: "Fetches the live quote and daily price history for one ticker symbol.",
    request: z.object({ ticker: z.string().min(1).max(12) }),
    response: z.object({
      found: z.boolean(), symbol: z.string(), name: z.string().nullable(),
      price: z.number().nullable(), currency: z.string().nullable(), change: z.number().nullable(), changePercent: z.number().nullable(),
      marketCap: z.number().nullable(), week52High: z.number().nullable(), week52Low: z.number().nullable(),
      beta: z.number().nullable(), asOf: z.string().nullable(), marketStatus: z.string().nullable(),
      history: z.array(z.object({ date: z.string(), close: z.number().nullable() })),
    }),
    async handler(ctx, args) {
      const res = await ctx.tool.finance_ticker(args.ticker.toUpperCase(), { interval: "1d" });
      const inst = res.content.instrument;
      if (!inst) return { found: false, symbol: args.ticker.toUpperCase(), name: null, price: null, currency: null, change: null, changePercent: null, marketCap: null, week52High: null, week52Low: null, beta: null, asOf: null, marketStatus: null, history: [] };
      return {
        found: true, symbol: inst.symbol ?? args.ticker.toUpperCase(), name: inst.name,
        price: inst.price ?? null, currency: inst.currency ?? null, change: inst.change ?? null, changePercent: inst.change_percent ?? null,
        marketCap: inst.market_cap ?? null, week52High: inst.week_52_high ?? null, week52Low: inst.week_52_low ?? null,
        beta: inst.beta ?? null, asOf: inst.as_of ?? null, marketStatus: inst.market_status ?? null,
        history: (inst.history?.points ?? []).map((p) => ({ date: p.date ?? "", close: p.close ?? null })),
      };
    },
  }),

  analyzeTicker: defineAction({
    description: "Runs a full buy-side committee analysis for a ticker: live quote, web-researched fundamentals, scorecard, deterministic DCF scenarios, margin of safety, risks and thesis — saved as a new version.",
    request: z.object({ ticker: z.string().min(1).max(12) }),
    response: z.object({ analysis: analysisSummary }),
    async handler(ctx, args) {
      const ticker = args.ticker.toUpperCase().trim();
      const db = ctx.db<typeof schema>();

      const quoteRes = await ctx.tool.finance_ticker(ticker, { interval: "1d" });
      const inst = quoteRes.content.instrument;
      if (!inst || inst.price == null) throw new Error(`Ticker ${ticker} could not be resolved to a traded instrument. Check the symbol and try again.`);
      const price = inst.price;
      const marketCap = inst.market_cap;
      const companyNameGuess = inst.name;

      const [s1, s2, s3] = await Promise.all([
        ctx.tool.web_search(`${ticker} ${companyNameGuess} revenue free cash flow operating margin ROIC return on invested capital 10-K financials last 5 years`),
        ctx.tool.web_search(`${ticker} ${companyNameGuess} competitive moat competitors market share management capital allocation buybacks stock based compensation dilution`),
        ctx.tool.web_search(`${ticker} ${companyNameGuess} latest earnings results guidance risks outlook most recent quarter`),
      ]);
      const fmt = (s: typeof s1) => s.content.results.map((r) => `- [${r.title}] ${r.snippet ?? ""}`).join("\n").slice(0, 7000);
      const sources = [...s1.content.sources, ...s2.content.sources, ...s3.content.sources].slice(0, 12);

      const prompt = `You are a disciplined buy-side equity analyst in the Buffett / Munger / Graham tradition. Analyze ${companyNameGuess} (${ticker}) using ONLY the research snippets below plus the live quote. Never invent a figure: if a number is not supported by the snippets, return null for it and list it in dataGaps. Distinguish reported figures from estimates in reportingPeriod. Be skeptical: judge business quality separately from valuation. Score each dimension 0-10 honestly (10 = best; for riskProfile 10 = lowest risk). Treat stock-based compensation as a real cost in sbcNote and dilution. Scenario assumptions are 5-year FCF growth rates: bear must be genuinely adverse, bull genuinely strong but plausible; discount rate 7-12% for most businesses, terminal growth 1.5-3%.

LIVE QUOTE: price ${price} ${inst.currency ?? "USD"}, market cap ${marketCap ?? "unknown"}, 52-week range ${inst.week_52_low ?? "?"}–${inst.week_52_high ?? "?"}, beta ${inst.beta ?? "?"}. Quote summary: ${inst.summary.slice(0, 1200)}

FINANCIALS RESEARCH:
${fmt(s1)}

MOAT / MANAGEMENT / CAPITAL ALLOCATION RESEARCH:
${fmt(s2)}

EARNINGS / GUIDANCE / RISKS RESEARCH:
${fmt(s3)}

All monetary values in billions of USD (revenueBn, fcfBn, ocfBn, capexBn, sbcBn, netCashBn where net debt is negative). Percentages as plain numbers (e.g. 28.4 means 28.4%). History: up to 6 most recent fiscal years, oldest first. Provide at least 4 risks and at least 3 thesis breakers, 3 reasons to own and 3 reasons not to own where the evidence supports them.`;

      const syn = await ctx.inference.complete(prompt, { schema: synthesisSchema });

      // Deterministic DCF
      const sharesBn = syn.sharesDilutedBn ?? (marketCap && price ? marketCap / price / 1e9 : null);
      const netCashBn = syn.netCashBn ?? 0;
      const netCashAssumed = syn.netCashBn == null;
      let fcf0 = syn.fcfBn;
      if ((fcf0 == null || fcf0 <= 0) && syn.revenueBn != null && syn.fcfMarginPct != null) fcf0 = syn.revenueBn * (syn.fcfMarginPct / 100);
      const ivBear = fcf0 != null && sharesBn ? dcfPerShare(fcf0, syn.bear.fcfGrowthPct, syn.bear.discountPct, syn.bear.terminalGrowthPct, netCashBn, sharesBn) : null;
      const ivBase = fcf0 != null && sharesBn ? dcfPerShare(fcf0, syn.base.fcfGrowthPct, syn.base.discountPct, syn.base.terminalGrowthPct, netCashBn, sharesBn) : null;
      const ivBull = fcf0 != null && sharesBn ? dcfPerShare(fcf0, syn.bull.fcfGrowthPct, syn.bull.discountPct, syn.bull.terminalGrowthPct, netCashBn, sharesBn) : null;
      const ivWeighted = ivBear != null && ivBase != null && ivBull != null ? 0.25 * ivBear + 0.5 * ivBase + 0.25 * ivBull : ivBase;
      const mos = ivWeighted != null && price ? (ivWeighted - price) / ivWeighted * 100 : null;
      const implied = fcf0 != null && sharesBn ? impliedGrowth(fcf0, syn.base.discountPct, syn.base.terminalGrowthPct, netCashBn, sharesBn, price) : null;

      // Committee reconciliation: the verdict may never contradict the computed
      // valuation. The orchestrator reconciles disagreements instead of
      // averaging them — a quality business far above its weighted intrinsic
      // value is a Watchlist, not a Hold, and nothing is a Buy at a premium.
      let finalRecommendation: string = syn.recommendation;
      let verdictNote: string | null = null;
      const upW = ivWeighted != null ? (ivWeighted - price) / price * 100 : null;
      if (upW != null && !["Trim", "Sell"].includes(finalRecommendation)) {
        if (upW < 0 && ["Strong Buy", "Buy", "Accumulate"].includes(finalRecommendation)) {
          const nr = upW <= -25 ? (syn.scores.businessQuality >= 6 ? "Watchlist" : "Sell") : "Hold";
          verdictNote = `Committee reconciliation: the analyst draft said “${finalRecommendation}”, but the probability-weighted intrinsic value (${money0(ivWeighted)}) sits below the price (${money0(price)}). Under this framework that cannot be a buy. Verdict set to ${nr}.`;
          finalRecommendation = nr;
        } else if (upW <= -25 && ["Hold", "Accumulate"].includes(finalRecommendation)) {
          const nr = syn.scores.businessQuality >= 6 ? "Watchlist" : "Sell";
          verdictNote = `Committee reconciliation: the analyst draft said “${finalRecommendation}”, but the probability-weighted intrinsic value (${money0(ivWeighted)}) is ${Math.abs(upW).toFixed(0)}% below the price (${money0(price)}) — even the range of computed values does not support holding at this price for new capital. A high-quality business at an unattractive valuation is a Watchlist under this framework. Verdict set to ${nr}. Existing holders should weigh taxes and alternatives before acting; this is not a sell instruction.`;
          finalRecommendation = nr;
        }
      }

      // Change detection vs previous version
      const priorRows = await db.select().from(schema.analyses).where(eq(schema.analyses.ticker, ticker)).orderBy(desc(schema.analyses.id)).limit(1);
      let changeDetection: Array<{ area: string; previous: string; current: string; verdict: string }> = [];
      let valueVerdict = "First analysis for this ticker — no prior version to compare against.";
      const prior = priorRows[0];
      if (prior) {
        try {
          const pp = JSON.parse(prior.payload) as { syn?: typeof syn; intrinsicBase?: number | null };
          const ps = pp.syn;
          if (ps) {
            const f = (v: number | null | undefined, u = "") => v == null ? "n/a" : `${v}${u}`;
            changeDetection = [
              { area: "Revenue growth", previous: f(ps.revenueGrowthPct, "%"), current: f(syn.revenueGrowthPct, "%"), verdict: syn.revenueGrowthPct != null && ps.revenueGrowthPct != null ? (syn.revenueGrowthPct >= ps.revenueGrowthPct ? "Accelerating / stable" : "Decelerating") : "Insufficient data" },
              { area: "Operating margin", previous: f(ps.operatingMarginPct, "%"), current: f(syn.operatingMarginPct, "%"), verdict: syn.operatingMarginPct != null && ps.operatingMarginPct != null ? (syn.operatingMarginPct >= ps.operatingMarginPct ? "Expanding / stable" : "Compressing") : "Insufficient data" },
              { area: "Free cash flow", previous: f(ps.fcfBn, "B"), current: f(syn.fcfBn, "B"), verdict: syn.fcfBn != null && ps.fcfBn != null ? (syn.fcfBn >= ps.fcfBn ? "Cash generation improving" : "Cash generation weakening") : "Insufficient data" },
              { area: "Dilution (per year)", previous: f(ps.dilutionPctPerYear, "%"), current: f(syn.dilutionPctPerYear, "%"), verdict: syn.dilutionPctPerYear != null && ps.dilutionPctPerYear != null ? (syn.dilutionPctPerYear <= ps.dilutionPctPerYear ? "Shareholder impact stable / improving" : "Dilution worsening") : "Insufficient data" },
              { area: "Intrinsic value (base)", previous: pp.intrinsicBase != null ? `$${pp.intrinsicBase.toFixed(2)}` : "n/a", current: ivBase != null ? `$${ivBase.toFixed(2)}` : "n/a", verdict: ivBase != null && pp.intrinsicBase != null ? (ivBase >= pp.intrinsicBase ? "Business became more valuable" : "Intrinsic value declined") : "Insufficient data" },
            ];
            if (ivBase != null && pp.intrinsicBase != null) {
              valueVerdict = ivBase >= pp.intrinsicBase
                ? `Intrinsic value rose from $${pp.intrinsicBase.toFixed(2)} to $${ivBase.toFixed(2)} — the business itself became more valuable, not just the price.`
                : `Intrinsic value fell from $${pp.intrinsicBase.toFixed(2)} to $${ivBase.toFixed(2)} — check whether the price move reflects real deterioration or only sentiment.`;
            }
          }
        } catch { /* prior payload unparsable — skip diff */ }
      }

      const payload = JSON.stringify({
        syn, sources, netCashAssumed, sharesBnUsed: sharesBn, fcf0UsedBn: fcf0, verdictNote, analystDraftRecommendation: syn.recommendation,
        intrinsicBase: ivBase, intrinsicWeighted: ivWeighted,
        impliedGrowthPct: implied, changeDetection, valueVerdict,
        historyPoints: (inst.history?.points ?? []).map((p) => ({ date: p.date ?? "", close: p.close })),
        entryPrices: ivBase != null ? { mos10: ivBase * 0.9, mos20: ivBase * 0.8, mos30: ivBase * 0.7 } : null,
      });

      const inserted = await db.insert(schema.analyses).values({
        ticker, companyName: syn.companyName || companyNameGuess,
        price, marketCap: marketCap ?? null, currency: inst.currency ?? "USD", priceAsOf: inst.as_of,
        recommendation: finalRecommendation, conviction: syn.conviction,
        intrinsicBear: ivBear, intrinsicBase: ivBase, intrinsicBull: ivBull, intrinsicWeighted: ivWeighted,
        marginOfSafety: mos, businessQualityScore: syn.scores.businessQuality, valuationScore: syn.scores.valuationAttractiveness,
        payload,
      }).returning();
      const row = inserted[0];
      if (!row) throw new Error("Failed to save analysis.");
      ctx.invalidateQueries();
      return { analysis: rowToSummary(row) };
    },
  }),

  listAnalyses: defineAction({
    description: "Lists saved analyses, newest first, optionally filtered to one ticker.",
    request: z.object({ ticker: z.string().max(12).optional(), limit: z.number().int().positive().max(100).default(50) }),
    response: z.object({ analyses: z.array(analysisSummary) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = args.ticker
        ? await db.select().from(schema.analyses).where(eq(schema.analyses.ticker, args.ticker.toUpperCase())).orderBy(desc(schema.analyses.id)).limit(args.limit)
        : await db.select().from(schema.analyses).orderBy(desc(schema.analyses.id)).limit(args.limit);
      return { analyses: rows.map(rowToSummary) };
    },
  }),

  deleteAnalysis: defineAction({
    description: "Deletes one saved analysis by id.",
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.analyses).where(eq(schema.analyses.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  listPositions: defineAction({
    description: "Lists the user's portfolio positions and watchlist entries.",
    request: z.object({}),
    response: z.object({
      positions: z.array(z.object({
        id: z.number(), ticker: z.string(), companyName: z.string(), status: z.string(),
        shares: z.number().nullable(), costBasis: z.number().nullable(), notes: z.string(),
      })),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.positions).orderBy(desc(schema.positions.id));
      return { positions: rows.map((r) => ({ id: r.id, ticker: r.ticker, companyName: r.companyName, status: r.status, shares: r.shares, costBasis: r.costBasis, notes: r.notes })) };
    },
  }),

  upsertPosition: defineAction({
    description: "Creates or updates a portfolio position or watchlist entry (ticker, status, shares, cost basis, notes).",
    request: z.object({
      id: z.number().int().positive().optional(),
      ticker: z.string().min(1).max(12), companyName: z.string().max(120).default(""),
      status: z.enum(["holding", "watchlist"]).default("watchlist"),
      shares: z.number().nonnegative().nullable().default(null),
      costBasis: z.number().nonnegative().nullable().default(null),
      notes: z.string().max(2000).default(""),
    }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const ticker = args.ticker.toUpperCase().trim();
      if (args.id) {
        await db.update(schema.positions).set({ ticker, companyName: args.companyName, status: args.status, shares: args.shares, costBasis: args.costBasis, notes: args.notes, updatedAt: new Date() }).where(eq(schema.positions.id, args.id));
        ctx.invalidateQueries();
        return { id: args.id };
      }
      const ins = await db.insert(schema.positions).values({ ticker, companyName: args.companyName, status: args.status, shares: args.shares, costBasis: args.costBasis, notes: args.notes }).returning({ id: schema.positions.id });
      const row = ins[0];
      if (!row) throw new Error("Failed to save position.");
      ctx.invalidateQueries();
      return { id: row.id };
    },
  }),

  deletePosition: defineAction({
    description: "Removes a portfolio position or watchlist entry by id.",
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.positions).where(eq(schema.positions.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  addThesisNote: defineAction({
    description: "Adds a dated thesis note or earnings check-in for a ticker to its permanent investment record.",
    request: z.object({ ticker: z.string().min(1).max(12), kind: z.string().max(40).default("note"), note: z.string().min(1).max(4000) }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const ins = await db.insert(schema.thesisNotes).values({ ticker: args.ticker.toUpperCase().trim(), kind: args.kind, note: args.note }).returning({ id: schema.thesisNotes.id });
      const row = ins[0];
      if (!row) throw new Error("Failed to save note.");
      ctx.invalidateQueries();
      return { id: row.id };
    },
  }),

  listThesisNotes: defineAction({
    description: "Lists thesis notes, newest first, optionally for one ticker.",
    request: z.object({ ticker: z.string().max(12).optional() }),
    response: z.object({ notes: z.array(z.object({ id: z.number(), ticker: z.string(), kind: z.string(), note: z.string(), createdAt: z.string() })) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = args.ticker
        ? await db.select().from(schema.thesisNotes).where(eq(schema.thesisNotes.ticker, args.ticker.toUpperCase())).orderBy(desc(schema.thesisNotes.id)).limit(100)
        : await db.select().from(schema.thesisNotes).orderBy(desc(schema.thesisNotes.id)).limit(100);
      return { notes: rows.map((r) => ({ id: r.id, ticker: r.ticker, kind: r.kind, note: r.note, createdAt: r.createdAt.toISOString() })) };
    },
  }),

  compareOpportunities: defineAction({
    description: "Ranks every analyzed ticker by probability-weighted expected return versus its live price, for a given amount of new capital — the opportunity-cost view.",
    request: z.object({ capital: z.number().positive().max(100_000_000).default(10000) }),
    response: z.object({
      capital: z.number(),
      rows: z.array(z.object({
        ticker: z.string(), companyName: z.string(), price: z.number().nullable(), intrinsicWeighted: z.number().nullable(),
        expectedReturnPct: z.number().nullable(), businessQualityScore: z.number().nullable(), valuationScore: z.number().nullable(),
        recommendation: z.string(), sharesForCapital: z.number().nullable(), asOf: z.string().nullable(),
      })),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const all = await db.select().from(schema.analyses).orderBy(desc(schema.analyses.id)).limit(200);
      const latest = new Map<string, typeof all[number]>();
      for (const r of all) if (!latest.has(r.ticker)) latest.set(r.ticker, r);
      const rows = await Promise.all([...latest.values()].map(async (r) => {
        let livePrice = r.price; let asOf = r.priceAsOf;
        try {
          const q = await ctx.tool.finance_ticker(r.ticker);
          if (q.content.instrument?.price != null) { livePrice = q.content.instrument.price; asOf = q.content.instrument.as_of ?? null; }
        } catch { /* keep stored price */ }
        const exp = livePrice && r.intrinsicWeighted ? (r.intrinsicWeighted - livePrice) / livePrice * 100 : null;
        return {
          ticker: r.ticker, companyName: r.companyName, price: livePrice, intrinsicWeighted: r.intrinsicWeighted,
          expectedReturnPct: exp, businessQualityScore: r.businessQualityScore, valuationScore: r.valuationScore,
          recommendation: r.recommendation, sharesForCapital: livePrice ? Math.floor((args.capital / livePrice) * 1000) / 1000 : null, asOf,
        };
      }));
      rows.sort((a, b) => (b.expectedReturnPct ?? -999) - (a.expectedReturnPct ?? -999));
      return { capital: args.capital, rows };
    },
  }),
} satisfies ActionsModule;
