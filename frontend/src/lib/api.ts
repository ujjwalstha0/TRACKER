import {
  AppliedIpoAlertsResponse,
  AuthResponse,
  AuthUser,
  ChangePasswordPayload,
  CreateExecutionDecisionPayload,
  CreateHoldingPayload,
  EconomicNewsResponse,
  FloorsheetDeskResponse,
  FloorsheetSymbolResponse,
  ExecutionDecisionEntry,
  FeeCalculationInput,
  FeeCalculationResult,
  IndexApiRow,
  IndicatorsResponse,
  IpoAlertStatusResponse,
  MarketStatusResponse,
  NepalLivePricesResponse,
  NepseCostRequest,
  NepseCostResponse,
  OtpDispatchResponse,
  OhlcBackfillJobState,
  OhlcBackfillRequest,
  OhlcBackfillSymbolReport,
  OhlcCandle,
  PortfolioResponse,
  SignalNotebookResponse,
  TradingSignalResponse,
  TradeRow,
  UpdateExecutionDecisionPayload,
  WatchlistApiRow,
} from '../types';
import { clearAuthSession, getAuthToken } from './auth';

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';

function parseErrorMessage(body: { message?: string | string[] }, fallback: string): string {
  if (Array.isArray(body.message)) {
    return body.message.join(', ');
  }

  if (typeof body.message === 'string' && body.message.trim()) {
    return body.message;
  }

  return fallback;
}

class ApiError extends Error {
  retryAfterSeconds?: number;

  constructor(message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = 'ApiError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

async function throwApiError(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as {
    message?: string | string[];
    retryAfterSeconds?: number;
  };

  const retryAfter =
    typeof body.retryAfterSeconds === 'number' && Number.isFinite(body.retryAfterSeconds)
      ? body.retryAfterSeconds
      : undefined;

  throw new ApiError(parseErrorMessage(body, fallback), retryAfter);
}

function authHeaderOrThrow(): Record<string, string> {
  const token = getAuthToken();
  if (!token) {
    throw new Error('You need to login to access this feature.');
  }

  return {
    Authorization: `Bearer ${token}`,
  };
}

async function handleProtectedFailure(res: Response): Promise<never> {
  if (res.status === 401) {
    clearAuthSession();
    throw new Error('Session expired. Please login again.');
  }

  const fallback = `Request failed with status ${res.status}`;
  let message = fallback;

  try {
    const body = (await res.json()) as { message?: string | string[] };
    if (Array.isArray(body.message)) {
      message = body.message.join(', ');
    } else if (typeof body.message === 'string' && body.message.trim()) {
      message = body.message;
    }
  } catch {
    // Fall back to status-derived error message when body is not JSON.
  }

  throw new Error(message);
}

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
  const res = await fetch(`${API_BASE}/trades`, {
    headers: {
      ...authHeaderOrThrow(),
    },
  });
  if (!res.ok) {
    return handleProtectedFailure(res);
  }
  return res.json();
}

export async function createTrade(payload: Record<string, unknown>): Promise<TradeRow> {
  const res = await fetch(`${API_BASE}/trades`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaderOrThrow() },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    return handleProtectedFailure(res);
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
  const res = await fetch(`${API_BASE}/trades?isBuy=true`, {
    headers: {
      ...authHeaderOrThrow(),
    },
  });
  if (!res.ok) {
    return handleProtectedFailure(res);
  }
  return res.json();
}

export async function fetchWatchlist(): Promise<WatchlistApiRow[]> {
  const res = await fetch(`${API_BASE}/watchlist`, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('Failed to load watchlist');
  }
  return res.json();
}

export async function fetchIndices(): Promise<IndexApiRow[]> {
  const res = await fetch(`${API_BASE}/indices`, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('Failed to load indices');
  }
  return res.json();
}

export async function fetchMarketStatus(): Promise<MarketStatusResponse> {
  const res = await fetch(`${API_BASE}/market/status`, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('Failed to load market status');
  }

  return res.json();
}

export async function fetchFloorsheetDesk(params?: {
  symbols?: number;
  rows?: number;
}): Promise<FloorsheetDeskResponse> {
  const searchParams = new URLSearchParams();
  if (params?.symbols) searchParams.set('symbols', String(params.symbols));
  if (params?.rows) searchParams.set('rows', String(params.rows));

  const qs = searchParams.toString();
  const res = await fetch(`${API_BASE}/floorsheet/desk${qs ? `?${qs}` : ''}`, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('Failed to load floorsheet desk');
  }

  return res.json();
}

export async function fetchFloorsheetSymbol(
  symbol: string,
  params?: {
    rows?: number;
    buyer?: string;
    seller?: string;
  },
): Promise<FloorsheetSymbolResponse> {
  const normalized = symbol.trim().toUpperCase();
  const searchParams = new URLSearchParams();

  if (params?.rows) searchParams.set('rows', String(params.rows));
  if (params?.buyer) searchParams.set('buyer', params.buyer.trim());
  if (params?.seller) searchParams.set('seller', params.seller.trim());

  const qs = searchParams.toString();
  const res = await fetch(
    `${API_BASE}/floorsheet/symbol/${encodeURIComponent(normalized)}${qs ? `?${qs}` : ''}`,
    { cache: 'no-store' },
  );

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    throw new Error(parseErrorMessage(body, 'Failed to load symbol floorsheet'));
  }

  return res.json();
}

export async function fetchOhlc(symbol: string, interval = '1d', limit = 240): Promise<OhlcCandle[]> {
  const params = new URLSearchParams({
    symbol,
    interval,
    limit: String(limit),
  });

  const res = await fetch(`${API_BASE}/ohlc?${params.toString()}`, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('Failed to load OHLC data');
  }

  return res.json();
}

export async function startOhlcBackfill(request?: OhlcBackfillRequest): Promise<OhlcBackfillJobState> {
  const res = await fetch(`${API_BASE}/ohlc/backfill/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request ?? {}),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    throw new Error(parseErrorMessage(body, 'Failed to start OHLC backfill'));
  }

  return res.json();
}

export async function fetchOhlcBackfillStatus(): Promise<OhlcBackfillJobState> {
  const res = await fetch(`${API_BASE}/ohlc/backfill/status`, { cache: 'no-store' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    throw new Error(parseErrorMessage(body, 'Failed to load OHLC backfill status'));
  }

  return res.json();
}

export async function backfillOhlcSymbol(
  symbol: string,
  request?: OhlcBackfillRequest,
): Promise<OhlcBackfillSymbolReport> {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const res = await fetch(`${API_BASE}/ohlc/backfill/symbol/${encodeURIComponent(normalizedSymbol)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request ?? {}),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    throw new Error(parseErrorMessage(body, 'Failed to backfill selected symbol history'));
  }

  return res.json();
}

export async function fetchIndicators(symbol: string, interval = '1d', limit = 240): Promise<IndicatorsResponse> {
  const params = new URLSearchParams({
    symbol,
    interval,
    limit: String(limit),
  });

  const res = await fetch(`${API_BASE}/indicators?${params.toString()}`, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('Failed to load indicators');
  }

  return res.json();
}

export async function fetchSignal(symbol: string): Promise<TradingSignalResponse> {
  const params = new URLSearchParams({
    symbol: symbol.trim().toUpperCase(),
  });

  const res = await fetch(`${API_BASE}/signal?${params.toString()}`, { cache: 'no-store' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    throw new Error(parseErrorMessage(body, 'Failed to load trading signal'));
  }

  return res.json();
}

export async function generateSignalNotebook(limit = 45): Promise<SignalNotebookResponse> {
  const res = await fetch(`${API_BASE}/signal/notebook/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ limit }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    throw new Error(parseErrorMessage(body, 'Failed to generate daily signal notebook'));
  }

  return res.json();
}

export async function fetchSignalNotebookToday(): Promise<SignalNotebookResponse> {
  const res = await fetch(`${API_BASE}/signal/notebook/today`, { cache: 'no-store' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    throw new Error(parseErrorMessage(body, 'Failed to load today signal notebook'));
  }

  return res.json();
}

export async function evaluateSignalNotebookClose(): Promise<SignalNotebookResponse> {
  const res = await fetch(`${API_BASE}/signal/notebook/evaluate-close`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    throw new Error(parseErrorMessage(body, 'Failed to evaluate daily signal notebook'));
  }

  return res.json();
}

export async function fetchEconomicNews(limit = 30): Promise<EconomicNewsResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  const res = await fetch(`${API_BASE}/news/economy-market?${params.toString()}`, { cache: 'no-store' });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    throw new Error(parseErrorMessage(body, 'Failed to load economy-market news'));
  }

  return res.json();
}

export async function fetchNepalLivePrices(): Promise<NepalLivePricesResponse> {
  const res = await fetch(`${API_BASE}/news/live-prices`, { cache: 'no-store' });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    throw new Error(parseErrorMessage(body, 'Failed to load Nepal live prices'));
  }

  return res.json();
}

export async function fetchAppliedIpoAlerts(): Promise<AppliedIpoAlertsResponse> {
  const res = await fetch(`${API_BASE}/news/ipo-alerts/applied`, {
    headers: {
      ...authHeaderOrThrow(),
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    return handleProtectedFailure(res);
  }

  return res.json();
}

export async function markIpoAlertApplied(ipoAlertId: string): Promise<IpoAlertStatusResponse> {
  const res = await fetch(`${API_BASE}/news/ipo-alerts/apply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaderOrThrow(),
    },
    body: JSON.stringify({ ipoAlertId }),
  });

  if (!res.ok) {
    return handleProtectedFailure(res);
  }

  return res.json();
}

export async function markIpoAlertPending(ipoAlertId: string): Promise<IpoAlertStatusResponse> {
  const res = await fetch(`${API_BASE}/news/ipo-alerts/pending`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaderOrThrow(),
    },
    body: JSON.stringify({ ipoAlertId }),
  });

  if (!res.ok) {
    return handleProtectedFailure(res);
  }

  return res.json();
}

export async function requestRegisterOtp(payload: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<OtpDispatchResponse> {
  const res = await fetch(`${API_BASE}/auth/register/request-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    return throwApiError(res, 'Failed to send registration OTP');
  }

  return res.json();
}

export async function verifyRegisterOtp(payload: {
  email: string;
  otp: string;
}): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE}/auth/register/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    throw new Error(parseErrorMessage(body, 'Failed to verify OTP'));
  }

  return res.json();
}

export async function loginUser(payload: { email: string; password: string }): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    throw new Error(parseErrorMessage(body, 'Failed to login'));
  }

  return res.json();
}

export async function requestForgotPasswordOtp(payload: {
  email: string;
}): Promise<OtpDispatchResponse> {
  const res = await fetch(`${API_BASE}/auth/password/forgot/request-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    return throwApiError(res, 'Failed to send password reset OTP');
  }

  return res.json();
}

export async function resetForgotPassword(payload: {
  email: string;
  otp: string;
  newPassword: string;
}): Promise<{ message: string }> {
  const res = await fetch(`${API_BASE}/auth/password/forgot/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    return throwApiError(res, 'Failed to reset password');
  }

  return res.json();
}

export async function changePassword(payload: ChangePasswordPayload): Promise<{ message: string }> {
  const res = await fetch(`${API_BASE}/auth/password/change`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaderOrThrow(),
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    return handleProtectedFailure(res);
  }

  return res.json();
}

export function getRetryAfterSeconds(error: unknown): number | undefined {
  return error instanceof ApiError ? error.retryAfterSeconds : undefined;
}

export async function fetchMe(): Promise<AuthUser> {
  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: {
      ...authHeaderOrThrow(),
    },
  });

  if (!res.ok) {
    return handleProtectedFailure(res);
  }

  return res.json();
}

export async function fetchPortfolio(): Promise<PortfolioResponse> {
  const res = await fetch(`${API_BASE}/portfolio/holdings`, {
    headers: {
      ...authHeaderOrThrow(),
    },
  });

  if (!res.ok) {
    return handleProtectedFailure(res);
  }

  return res.json();
}

export async function createHolding(payload: CreateHoldingPayload) {
  const res = await fetch(`${API_BASE}/portfolio/holdings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaderOrThrow(),
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    return handleProtectedFailure(res);
  }

  return res.json();
}

export async function updateHolding(id: number, payload: Partial<CreateHoldingPayload>) {
  const res = await fetch(`${API_BASE}/portfolio/holdings/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaderOrThrow(),
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    return handleProtectedFailure(res);
  }

  return res.json();
}

export async function removeHolding(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/portfolio/holdings/${id}`, {
    method: 'DELETE',
    headers: {
      ...authHeaderOrThrow(),
    },
  });

  if (!res.ok) {
    return handleProtectedFailure(res);
  }
}

export async function fetchExecutionDecisions(params?: {
  tradeDate?: string;
  limit?: number;
}): Promise<ExecutionDecisionEntry[]> {
  const searchParams = new URLSearchParams();
  if (params?.tradeDate) searchParams.set('tradeDate', params.tradeDate);
  if (params?.limit) searchParams.set('limit', String(params.limit));

  const qs = searchParams.toString();
  const res = await fetch(`${API_BASE}/execution-decisions${qs ? `?${qs}` : ''}`, {
    headers: {
      ...authHeaderOrThrow(),
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    return handleProtectedFailure(res);
  }

  return res.json();
}

export async function createExecutionDecision(payload: CreateExecutionDecisionPayload): Promise<ExecutionDecisionEntry> {
  const res = await fetch(`${API_BASE}/execution-decisions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaderOrThrow(),
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    return handleProtectedFailure(res);
  }

  return res.json();
}

export async function updateExecutionDecision(
  id: number,
  payload: UpdateExecutionDecisionPayload,
): Promise<ExecutionDecisionEntry> {
  const res = await fetch(`${API_BASE}/execution-decisions/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaderOrThrow(),
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    return handleProtectedFailure(res);
  }

  return res.json();
}

export async function removeExecutionDecision(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/execution-decisions/${id}`, {
    method: 'DELETE',
    headers: {
      ...authHeaderOrThrow(),
    },
  });

  if (!res.ok) {
    return handleProtectedFailure(res);
  }
}
