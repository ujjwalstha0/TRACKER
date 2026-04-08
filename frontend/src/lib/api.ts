import {
  FeeCalculationInput,
  FeeCalculationResult,
  IndexApiRow,
  IndicatorsResponse,
  NepseCostRequest,
  NepseCostResponse,
  OhlcCandle,
  TradeRow,
  WatchlistApiRow,
} from '../types';

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';

export async function calculateFees(payload: FeeCalculationInput): Promise<FeeCalculationResult> {
  const res = await fetch(`${API_BASE}/fees/calculate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error('Failed to calculate charges');
  }

  return res.json();
}

export async function fetchTrades(): Promise<TradeRow[]> {
  const res = await fetch(`${API_BASE}/trades`);
  if (!res.ok) {
    throw new Error('Failed to load journal');
  }
  return res.json();
}

export async function createTrade(payload: Record<string, unknown>): Promise<TradeRow> {
  const res = await fetch(`${API_BASE}/trades`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error('Failed to save trade');
  }

  return res.json();
}

export async function calculateNepseCost(payload: NepseCostRequest): Promise<NepseCostResponse> {
  const res = await fetch(`${API_BASE}/calculate-nepse-cost`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error('Failed to calculate NEPSE cost');
  }

  return res.json();
}

export async function fetchBuyTrades(): Promise<TradeRow[]> {
  const res = await fetch(`${API_BASE}/trades?isBuy=true`);
  if (!res.ok) {
    throw new Error('Failed to load buy trades');
  }
  return res.json();
}

export async function fetchWatchlist(): Promise<WatchlistApiRow[]> {
  const res = await fetch(`${API_BASE}/watchlist`);
  if (!res.ok) {
    throw new Error('Failed to load watchlist');
  }
  return res.json();
}

export async function fetchIndices(): Promise<IndexApiRow[]> {
  const res = await fetch(`${API_BASE}/indices`);
  if (!res.ok) {
    throw new Error('Failed to load indices');
  }
  return res.json();
}

export async function fetchOhlc(symbol: string, interval = '1d', limit = 240): Promise<OhlcCandle[]> {
  const params = new URLSearchParams({
    symbol,
    interval,
    limit: String(limit),
  });

  const res = await fetch(`${API_BASE}/ohlc?${params.toString()}`);
  if (!res.ok) {
    throw new Error('Failed to load OHLC data');
  }

  return res.json();
}

export async function fetchIndicators(symbol: string, interval = '1d', limit = 240): Promise<IndicatorsResponse> {
  const params = new URLSearchParams({
    symbol,
    interval,
    limit: String(limit),
  });

  const res = await fetch(`${API_BASE}/indicators?${params.toString()}`);
  if (!res.ok) {
    throw new Error('Failed to load indicators');
  }

  return res.json();
}
