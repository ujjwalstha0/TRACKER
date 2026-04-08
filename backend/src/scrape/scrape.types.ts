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
