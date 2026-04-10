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

export interface OhlcBackfillRequest {
  symbolsLimit?: number;
  sinceDays?: number;
  throttleMs?: number;
}

export interface OhlcBackfillSymbolReport {
  symbol: string;
  companyId: number;
  fetchedRows: number;
  insertedCandles: number;
  newestDate: string | null;
  oldestDate: string | null;
  error: string | null;
}

export type OhlcBackfillJobStatus = 'IDLE' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface OhlcBackfillJobState {
  jobId: string | null;
  status: OhlcBackfillJobStatus;
  startedAt: string | null;
  finishedAt: string | null;
  options: {
    symbolsLimit: number;
    sinceDays: number | null;
    throttleMs: number;
  };
  progress: {
    totalSymbols: number;
    processedSymbols: number;
    totalFetchedRows: number;
    totalInsertedCandles: number;
    currentSymbol: string | null;
  };
  recentReports: OhlcBackfillSymbolReport[];
  error: string | null;
}
