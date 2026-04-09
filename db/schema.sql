CREATE TABLE IF NOT EXISTS trades (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,
  is_buy BOOLEAN NOT NULL,
  price NUMERIC(14,4) NOT NULL,
  qty INTEGER NOT NULL,
  broker VARCHAR(100) NOT NULL,
  total_value NUMERIC(16,2) NOT NULL,
  broker_fee NUMERIC(16,2) NOT NULL,
  sebon_fee NUMERIC(16,2) NOT NULL,
  dp_fee NUMERIC(16,2) NOT NULL,
  cgt_rate NUMERIC(8,5) NOT NULL DEFAULT 0,
  cgt_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
  net_cost_or_proceeds NUMERIC(16,2) NOT NULL,
  purchased_at DATE,
  sold_at DATE,
  holding_days INTEGER,
  sector VARCHAR(100),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS simulation_sessions (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  starting_capital NUMERIC(16,2) NOT NULL DEFAULT 500000,
  current_capital NUMERIC(16,2) NOT NULL DEFAULT 500000,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS simulation_trades (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES simulation_sessions(id) ON DELETE CASCADE,
  symbol VARCHAR(20) NOT NULL,
  is_buy BOOLEAN NOT NULL,
  price NUMERIC(14,4) NOT NULL,
  qty INTEGER NOT NULL,
  total_value NUMERIC(16,2) NOT NULL,
  broker_fee NUMERIC(16,2) NOT NULL,
  sebon_fee NUMERIC(16,2) NOT NULL,
  dp_fee NUMERIC(16,2) NOT NULL,
  cgt_rate NUMERIC(8,5) NOT NULL DEFAULT 0,
  cgt_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
  net_cost_or_proceeds NUMERIC(16,2) NOT NULL,
  placed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS watchlist (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL UNIQUE,
  sector VARCHAR(100),
  buy_price NUMERIC(14,4) NOT NULL,
  current_price NUMERIC(14,4) NOT NULL,
  instrument_type VARCHAR(20) NOT NULL DEFAULT 'equity',
  listing_type VARCHAR(20) NOT NULL DEFAULT 'listed',
  quantity INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "SignalNotebookEntry" (
  "id" BIGSERIAL PRIMARY KEY,
  "tradeDate" DATE NOT NULL,
  "symbol" VARCHAR(20) NOT NULL,
  "signal" VARCHAR(10) NOT NULL,
  "confidence" VARCHAR(10) NOT NULL,
  "entryPrice" NUMERIC(18,4) NOT NULL,
  "stopLoss" NUMERIC(18,4) NOT NULL,
  "targetPrice" NUMERIC(18,4) NOT NULL,
  "riskReward" NUMERIC(10,4) NOT NULL,
  "qualityScore" NUMERIC(6,2) NOT NULL,
  "reasons" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "requiredChecks" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "failedChecks" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "recommendedAction" VARCHAR(80) NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "evaluatedAt" TIMESTAMP(3),
  "closePrice" NUMERIC(18,4),
  "outcome" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  "accuracyScore" NUMERIC(6,2)
);

CREATE UNIQUE INDEX IF NOT EXISTS "SignalNotebookEntry_tradeDate_symbol_key"
  ON "SignalNotebookEntry" ("tradeDate", "symbol");

CREATE INDEX IF NOT EXISTS "SignalNotebookEntry_tradeDate_idx"
  ON "SignalNotebookEntry" ("tradeDate");

CREATE INDEX IF NOT EXISTS "SignalNotebookEntry_tradeDate_evaluatedAt_idx"
  ON "SignalNotebookEntry" ("tradeDate", "evaluatedAt");

CREATE TABLE IF NOT EXISTS "User" (
  "id" BIGSERIAL PRIMARY KEY,
  "email" VARCHAR(255) NOT NULL,
  "passwordHash" VARCHAR(255) NOT NULL,
  "displayName" VARCHAR(120),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key"
  ON "User" ("email");

CREATE TABLE IF NOT EXISTS "ExecutionDecision" (
  "id" BIGSERIAL PRIMARY KEY,
  "userId" BIGINT NOT NULL,
  "tradeDate" DATE NOT NULL,
  "side" VARCHAR(10) NOT NULL,
  "symbol" VARCHAR(20) NOT NULL,
  "reason" VARCHAR(600) NOT NULL,
  "plan" VARCHAR(600),
  "confidence" INTEGER NOT NULL,
  "outcome" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "reviewNote" VARCHAR(800),
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExecutionDecision_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "ExecutionDecision_userId_idx"
  ON "ExecutionDecision" ("userId");

CREATE INDEX IF NOT EXISTS "ExecutionDecision_userId_tradeDate_idx"
  ON "ExecutionDecision" ("userId", "tradeDate");

CREATE INDEX IF NOT EXISTS "ExecutionDecision_tradeDate_idx"
  ON "ExecutionDecision" ("tradeDate");

CREATE INDEX IF NOT EXISTS "ExecutionDecision_createdAt_idx"
  ON "ExecutionDecision" ("createdAt");
