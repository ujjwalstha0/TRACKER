export type NewsImpactLevel = 'HIGH' | 'MEDIUM' | 'LOW';
export type NewsSentiment = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
export type NewsImpactScope = 'COMPANY' | 'SECTOR' | 'MARKET' | 'MACRO';
export type NepalLivePriceKey = 'GOLD' | 'SILVER' | 'PETROL' | 'DIESEL';

export interface EconomicNewsItem {
  headline: string;
  summary: string;
  url: string;
  source: string;
  publishedDate: string | null;
  impact: NewsImpactLevel;
  sentiment: NewsSentiment;
  impactScope: NewsImpactScope;
  marketEffect: string;
  affectedSectors: string[];
  affectedSymbols: string[];
  relevanceScore: number;
  tags: string[];
}

export interface EconomicNewsResponse {
  asOf: string;
  source: string;
  count: number;
  items: EconomicNewsItem[];
}

export interface NepalLivePriceItem {
  key: NepalLivePriceKey;
  label: string;
  value: number | null;
  unit: string;
  currency: 'NPR';
  source: string;
  asOf: string | null;
  note: string | null;
}

export interface NepalLivePricesResponse {
  asOf: string;
  source: string;
  count: number;
  items: NepalLivePriceItem[];
}

export interface AppliedIpoAlertItem {
  ipoAlertId: string;
  appliedAt: string;
}

export interface AppliedIpoAlertsResponse {
  count: number;
  items: AppliedIpoAlertItem[];
}

export interface IpoAlertStatusResponse {
  ipoAlertId: string;
  applied: boolean;
  appliedAt: string | null;
}
