import {
  AuthResponse,
  AuthUser,
  ChangePasswordPayload,
  CreateHoldingPayload,
  FeeCalculationInput,
  FeeCalculationResult,
  IndexApiRow,
  IndicatorsResponse,
  NepseCostRequest,
  NepseCostResponse,
  OtpDispatchResponse,
  OhlcCandle,
  PortfolioResponse,
  TradeRow,
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
