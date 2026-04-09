export type NewsImpactLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface EconomicNewsItem {
  headline: string;
  url: string;
  source: string;
  publishedDate: string | null;
  impact: NewsImpactLevel;
  relevanceScore: number;
  tags: string[];
}

export interface EconomicNewsResponse {
  asOf: string;
  source: string;
  count: number;
  items: EconomicNewsItem[];
}
