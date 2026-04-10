export type TradingSignalKind = 'BUY' | 'SELL' | 'HOLD';
export type TradingSignalConfidence = 'HIGH' | 'MEDIUM' | 'LOW';
export type SignalInterval = '1m' | '5m' | '15m' | '1h' | '1d';
export type SignalNotebookSessionState = 'OPEN' | 'POST_CLOSE' | 'CLOSED';
export type SignalNotebookOutcome =
  | 'PENDING'
  | 'HIT_TARGET'
  | 'HIT_STOP'
  | 'MOVED_IN_FAVOR'
  | 'MOVED_AGAINST'
  | 'FLAT';

export interface SignalNotebookAutomationStatus {
  sessionState: SignalNotebookSessionState;
  autoMode: boolean;
  nextAction: string;
  note: string;
}

export interface SignalCheckItem {
  key: string;
  label: string;
  required: boolean;
  passed: boolean;
  weight: number;
}

export interface SignalTradePlan {
  entryPrice: number;
  stopLoss: number;
  targetPrice: number;
  takeProfit1: number;
  takeProfit2: number;
  trailingStop: number;
  riskPerShare: number;
  rewardPerShare: number;
  riskReward: number;
  expectedMovePct: number;
  invalidation: string;
  primaryExitRule: string;
  exitRationale: string;
}

export interface SignalStructureLevel {
  price: number;
  touches: number;
  distancePct: number;
}

export interface SignalMarketStructure {
  trendBias: 'BULLISH' | 'BEARISH' | 'RANGE';
  nearestSupport: number | null;
  nearestResistance: number | null;
  supportLevels: SignalStructureLevel[];
  resistanceLevels: SignalStructureLevel[];
}

export interface SignalPerformanceStats {
  sampleSize: number;
  winRatePct: number;
  averageAccuracyPct: number;
  recentWinRatePct: number;
  calibrationAdjustment: number;
  note: string;
}

export interface SignalPriceContext {
  close: number;
  ema8: number;
  ema21: number;
  ema20: number;
  ema50: number;
  rsi14: number;
  vwap: number;
  volume: number;
  avgVolume20: number;
}

export interface TradingSignalResult {
  signal: TradingSignalKind;
  confidence: TradingSignalConfidence;
  buyScore: number;
  sellScore: number;
  strength: number;
  reasons: string[];
  recommendedAction: string;
  qualityScore: number;
  plan: SignalTradePlan | null;
  requiredChecks: SignalCheckItem[];
  failedChecks: string[];
  priceContext: SignalPriceContext;
  structure: SignalMarketStructure;
  performance: SignalPerformanceStats;
  interval: SignalInterval;
  generatedAt: string;
}

export interface SignalNotebookEntryDto {
  id: number;
  tradeDate: string;
  symbol: string;
  signal: Exclude<TradingSignalKind, 'HOLD'>;
  confidence: TradingSignalConfidence;
  entryPrice: number;
  stopLoss: number;
  targetPrice: number;
  riskReward: number;
  qualityScore: number;
  reasons: string[];
  requiredChecks: string[];
  failedChecks: string[];
  recommendedAction: string;
  generatedAt: string;
  evaluatedAt: string | null;
  closePrice: number | null;
  outcome: SignalNotebookOutcome;
  accuracyScore: number | null;
}

export interface SignalNotebookSummaryDto {
  total: number;
  buyCount: number;
  sellCount: number;
  pendingCount: number;
  evaluatedCount: number;
  hitTargetCount: number;
  hitStopCount: number;
  movedInFavorCount: number;
  movedAgainstCount: number;
  winRatePct: number;
  averageAccuracyPct: number;
}

export interface SignalNotebookPayload {
  tradeDate: string;
  generatedAt: string | null;
  evaluatedAt: string | null;
  automation: SignalNotebookAutomationStatus;
  summary: SignalNotebookSummaryDto;
  entries: SignalNotebookEntryDto[];
}

export interface SignalInputData {
  ema8: number;
  ema21: number;
  ema20: number;
  ema50: number;
  rsi14: number;
  close: number;
  vwap: number;
  volume: number;
  avgVolume20: number;
  bbLower: number;
  bbUpper: number;
}
