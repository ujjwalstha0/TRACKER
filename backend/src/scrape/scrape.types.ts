export interface PriceDto {
  symbol: string;
  company: string | null;
  sector: string | null;
  ltp: number;
  change: number | null;
  changePct: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: bigint | null;
  turnover: number | null;
}

export interface IndexValueDto {
  indexName: string;
  value: number;
  change: number;
  changePct: number;
}

export interface MarketStatusDto {
  isOpen: boolean;
  label: 'OPEN' | 'CLOSED';
  session: string;
  source: 'nepalstock' | 'sharesansar' | 'unknown';
  asOf: string | null;
}
