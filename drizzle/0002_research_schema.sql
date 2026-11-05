DROP TABLE IF EXISTS entries;
--> statement-breakpoint
CREATE TABLE analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  company_name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  price REAL,
  market_cap REAL,
  currency TEXT NOT NULL DEFAULT 'USD',
  price_as_of TEXT,
  recommendation TEXT NOT NULL DEFAULT 'Hold',
  conviction TEXT NOT NULL DEFAULT 'Medium',
  intrinsic_bear REAL,
  intrinsic_base REAL,
  intrinsic_bull REAL,
  intrinsic_weighted REAL,
  margin_of_safety REAL,
  business_quality_score REAL,
  valuation_score REAL,
  payload TEXT NOT NULL DEFAULT '{}'
);
--> statement-breakpoint
CREATE TABLE positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  company_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'watchlist',
  shares REAL,
  cost_basis REAL,
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE thesis_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'note',
  note TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
