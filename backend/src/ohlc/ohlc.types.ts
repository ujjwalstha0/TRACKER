export type OhlcInterval = '1m' | '5m' | '15m' | '1h' | '1d';

export interface OhlcCandleDto {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number | null;
}

export interface OhlcQuery {
  symbol: string;
  interval?: string;
  limit?: number;
}
