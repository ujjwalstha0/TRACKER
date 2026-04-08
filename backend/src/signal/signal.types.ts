export type TradingSignalKind = 'BUY' | 'SELL' | 'HOLD';
export type TradingSignalConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface TradingSignalResult {
  signal: TradingSignalKind;
  confidence: TradingSignalConfidence;
  buyScore: number;
  sellScore: number;
  strength: number;
  reasons: string[];
  recommendedAction: string;
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
