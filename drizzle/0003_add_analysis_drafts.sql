CREATE TABLE analysis_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  company_name TEXT NOT NULL DEFAULT '',
  price REAL,
  market_cap REAL,
  currency TEXT NOT NULL DEFAULT 'USD',
  price_as_of TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  claimed_at INTEGER,
  created_at INTEGER NOT NULL
);
