import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const analyses = sqliteTable("analyses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(),
  companyName: text("company_name").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  price: real("price"),
  marketCap: real("market_cap"),
  currency: text("currency").notNull().default("USD"),
  priceAsOf: text("price_as_of"),
  recommendation: text("recommendation").notNull().default("Hold"),
  conviction: text("conviction").notNull().default("Medium"),
  intrinsicBear: real("intrinsic_bear"),
  intrinsicBase: real("intrinsic_base"),
  intrinsicBull: real("intrinsic_bull"),
  intrinsicWeighted: real("intrinsic_weighted"),
  marginOfSafety: real("margin_of_safety"),
  businessQualityScore: real("business_quality_score"),
  valuationScore: real("valuation_score"),
  payload: text("payload").notNull().default("{}"),
});

// Intermediate state for the two-step analysis pipeline: beginAnalysis saves
// the extracted fundamentals + research here; completeAnalysis claims the
// draft, runs the narrative synthesis, computes the DCF and writes the final
// analyses row. A draft is claimed via status/claimedAt so a resumed or
// repeated completion cannot produce duplicate reports.
export const analysisDrafts = sqliteTable("analysis_drafts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(),
  companyName: text("company_name").notNull().default(""),
  price: real("price"),
  marketCap: real("market_cap"),
  currency: text("currency").notNull().default("USD"),
  priceAsOf: text("price_as_of"),
  payload: text("payload").notNull().default("{}"),
  status: text("status", { enum: ["pending", "running"] }).notNull().default("pending"),
  claimedAt: integer("claimed_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const positions = sqliteTable("positions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(),
  companyName: text("company_name").notNull().default(""),
  status: text("status", { enum: ["holding", "watchlist"] }).notNull().default("watchlist"),
  shares: real("shares"),
  costBasis: real("cost_basis"),
  notes: text("notes").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const thesisNotes = sqliteTable("thesis_notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(),
  kind: text("kind").notNull().default("note"),
  note: text("note").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
