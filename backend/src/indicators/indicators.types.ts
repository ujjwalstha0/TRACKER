import { OhlcCandleDto, OhlcInterval } from '../ohlc/ohlc.types';

export interface IndicatorQuery {
  symbol: string;
  interval?: string;
  limit?: number;
}

export interface IndicatorPoint {
  t: string;
  value: number | null;
}

export interface IndicatorResponse {
  symbol: string;
  interval: OhlcInterval;
  candles: OhlcCandleDto[];
  sma20: IndicatorPoint[];
  ema20: IndicatorPoint[];
  rsi14: IndicatorPoint[];
  macd: {
    line: IndicatorPoint[];
    signal: IndicatorPoint[];
    histogram: IndicatorPoint[];
  };
  bollinger: {
    upper: IndicatorPoint[];
    middle: IndicatorPoint[];
    lower: IndicatorPoint[];
  };
  vwap: IndicatorPoint[];
}
