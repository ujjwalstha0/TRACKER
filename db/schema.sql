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
