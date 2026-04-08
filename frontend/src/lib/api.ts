import { FeeCalculationInput, FeeCalculationResult, NepseCostRequest, NepseCostResponse, TradeRow } from '../types';

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
