import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { EconomicNewsItem, EconomicNewsResponse, NewsImpactLevel } from './news.types';

const CACHE_TTL_MS = 3 * 60 * 1000;
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 80;
const RECENT_DAYS_WINDOW = 5;
const MIN_RELEVANCE_SCORE = 4;
const RELAXED_RELEVANCE_SCORE = 2;

const NEWS_SOURCES: Array<{ key: string; url: string; selectors: string[] }> = [
  {
    key: 'sharesansar',
    url: 'https://www.sharesansar.com/news-page',
    selectors: ['a[href*="/newsdetail/"]', '.news-title a[href]'],
  },
  {
    key: 'merolagani',
    url: 'https://merolagani.com/NewsList.aspx',
    selectors: ['a[href*="NewsDetail.aspx"]', '.media-news-list a[href]'],
  },
  {
    key: 'bizshala',
    url: 'https://www.bizshala.com/category/share-market',
    selectors: ['a[href*="/story/"]', '.post-title a[href]'],
  },
];

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

interface CachedNews {
  fetchedAt: number;
  payload: EconomicNewsResponse;
}

interface ParsedNewsSourceItem {
  headline: string;
  url: string;
  source: string;
  publishedDate: string;
}

@Injectable()
export class NewsService {
  private readonly logger = new Logger(NewsService.name);
  private cache: CachedNews | null = null;

  async getEconomicMarketNews(limit?: number): Promise<EconomicNewsResponse> {
    const normalizedLimit = this.normalizeLimit(limit);
    const now = Date.now();

    if (this.cache && now - this.cache.fetchedAt < CACHE_TTL_MS) {
      return {
        ...this.cache.payload,
        count: Math.min(normalizedLimit, this.cache.payload.items.length),
        items: this.cache.payload.items.slice(0, normalizedLimit),
      };
    }

    const parsed = await this.fetchAndParseAllSources(new Date(now));
    const curated = this.curateUsefulItems(parsed).sort((a, b) => {
      const dateA = Date.parse(a.publishedDate ?? '1970-01-01');
      const dateB = Date.parse(b.publishedDate ?? '1970-01-01');
      return dateB - dateA || b.relevanceScore - a.relevanceScore;
    });

    const limited = curated.slice(0, MAX_LIMIT);

    const payload: EconomicNewsResponse = {
      asOf: new Date(now).toISOString(),
      source: 'multi-source',
      count: Math.min(normalizedLimit, limited.length),
      items: limited.slice(0, normalizedLimit),
    };

    this.cache = {
      fetchedAt: now,
      payload: {
        ...payload,
        count: limited.length,
        items: limited,
      },
    };

    return payload;
  }

  private curateUsefulItems(parsed: ParsedNewsSourceItem[]): EconomicNewsItem[] {
    const scored = parsed.map((item) => {
      const tags = this.detectTags(item.headline);
      const relevanceScore = this.computeRelevanceScore(item.headline, tags);

      return {
        headline: item.headline,
        url: item.url,
        source: item.source,
        publishedDate: item.publishedDate,
        impact: this.toImpact(relevanceScore),
        relevanceScore,
        tags,
      } satisfies EconomicNewsItem;
    });

    const strict = scored.filter((item) =>
      this.isUsefulForUsers(item.headline, item.tags, item.relevanceScore),
    );

    if (strict.length >= 8) {
      return strict;
    }

    const strictUrls = new Set(strict.map((item) => item.url));
    const relaxed = scored.filter((item) => {
      if (strictUrls.has(item.url)) {
        return false;
      }

      if (item.relevanceScore < RELAXED_RELEVANCE_SCORE) {
        return false;
      }

      return !this.isLikelyNoiseHeadline(item.headline);
    });

    return [...strict, ...relaxed];
  }

  private async fetchAndParseAllSources(now: Date): Promise<ParsedNewsSourceItem[]> {
    const results = await Promise.all(
      NEWS_SOURCES.map(async (source) => {
        const html = await this.fetchNewsHtml(source.url, source.key);
        if (!html) {
          return [] as ParsedNewsSourceItem[];
        }

        return this.parseNewsBySource(source.url, source.key, source.selectors, html, now);
      }),
    );

    const dedupe = new Set<string>();
    const merged: ParsedNewsSourceItem[] = [];

    for (const sourceItems of results) {
      for (const item of sourceItems) {
        if (dedupe.has(item.url)) {
          continue;
        }

        dedupe.add(item.url);
        merged.push(item);
      }
    }

    if (!merged.length && this.cache) {
      return this.cache.payload.items
        .filter((item) => item.publishedDate)
        .map((item) => ({
          headline: item.headline,
          url: item.url,
          source: item.source,
          publishedDate: item.publishedDate as string,
        }));
    }

    return merged;
  }

  private async fetchNewsHtml(url: string, sourceKey: string): Promise<string | null> {
    try {
      const response = await axios.get<string>(url, {
        timeout: 12000,
        headers: FETCH_HEADERS,
        responseType: 'text',
      });

      return response.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Unable to fetch ${sourceKey} news source: ${message}`);
      return null;
    }
  }

  private parseNewsBySource(
    sourceUrl: string,
    sourceKey: string,
    selectors: string[],
    html: string,
    now: Date,
  ): ParsedNewsSourceItem[] {
    const $ = cheerio.load(html);
    const dedupe = new Set<string>();
    const items: ParsedNewsSourceItem[] = [];
    const selector = selectors.join(', ');

    for (const anchor of $(selector).toArray()) {
      const element = $(anchor);
      const href = element.attr('href');
      const headline = element.text().replace(/\s+/g, ' ').trim();

      if (!href || headline.length < 20 || headline.length > 220) {
        continue;
      }

      const url = this.normalizeUrl(href, sourceUrl);
      if (!url || this.isLikelyNonArticleLink(url)) {
        continue;
      }

      if (dedupe.has(url)) {
        continue;
      }

      const publishedDate = this.extractPublishedDate(url, element.closest('article,li,div').text());
      if (!publishedDate || !this.isWithinRecentWindow(publishedDate, now)) {
        continue;
      }

      dedupe.add(url);

      items.push({
        headline,
        url,
        source: sourceKey,
        publishedDate,
      });
    }

    return items;
  }

  private normalizeUrl(href: string, sourceUrl: string): string | null {
    try {
      return href.startsWith('http') ? href : new URL(href, sourceUrl).toString();
    } catch {
      return null;
    }
  }

  private isLikelyNonArticleLink(url: string): boolean {
    const lower = url.toLowerCase();
    return (
      lower.includes('/category/') ||
      lower.includes('/tag/') ||
      lower.includes('/author/') ||
      lower.includes('/advertise')
    );
  }

  private detectTags(headline: string): string[] {
    const lower = headline.toLowerCase();
    const tags = new Set<string>();

    if (/(nrb|central bank|monetary|policy rate|interest rate|repo|liquidity)/.test(lower)) {
      tags.add('Monetary Policy');
    }

    if (/(inflation|cpi|commodity|gold|silver|fuel|oil)/.test(lower)) {
      tags.add('Inflation & Commodities');
    }

    if (/(budget|fiscal|tax|revenue|expenditure|capital expenditure)/.test(lower)) {
      tags.add('Fiscal Policy');
    }

    if (/(remittance|forex|currency|exchange rate|trade deficit)/.test(lower)) {
      tags.add('External Sector');
    }

    if (/(bank|lending|deposit|credit|profit|npl|bfi)/.test(lower)) {
      tags.add('Banking & Credit');
    }

    if (/(nepse|ipo|fpo|right share|dividend|bonus|merger|acquisition|book closure|agm|sgm)/.test(lower)) {
      tags.add('Market Structure');
    }

    if (/(gdp|economic growth|economy|macro)/.test(lower)) {
      tags.add('Macro Growth');
    }

    return [...tags].slice(0, 3);
  }

  private computeRelevanceScore(headline: string, tags: string[]): number {
    const lower = headline.toLowerCase();
    let score = tags.length * 1.5;

    if (/(nrb|central bank|monetary|policy rate|interest rate|liquidity|budget|tax)/.test(lower)) {
      score += 3;
    }

    if (/(nepse|index|turnover|trading volume|market capitalization)/.test(lower)) {
      score += 2.5;
    }

    if (/(gdp|inflation|remittance|forex|currency|credit|deposit|lending)/.test(lower)) {
      score += 2;
    }

    if (/(ipo|fpo|right share|book closure|agm|sgm|listed|allotment)/.test(lower)) {
      score -= 1.5;
    }

    if (/(profit|quarter|q1|q2|q3|q4|results)/.test(lower)) {
      score += 1;
    }

    return Math.max(0, Math.min(score, 10));
  }

  private isUsefulForUsers(headline: string, tags: string[], score: number): boolean {
    if (score < MIN_RELEVANCE_SCORE) {
      return false;
    }

    const lower = headline.toLowerCase();
    const hasCoreTag = tags.some((tag) =>
      [
        'Monetary Policy',
        'Inflation & Commodities',
        'Fiscal Policy',
        'External Sector',
        'Banking & Credit',
        'Macro Growth',
      ].includes(tag),
    );

    if (hasCoreTag) {
      return true;
    }

    return /(nepse index|market turnover|market capitalization|liquidity crunch|credit growth)/.test(lower);
  }

  private isLikelyNoiseHeadline(headline: string): boolean {
    const lower = headline.toLowerCase();
    return /(vacancy|career|sponsored|advertisement|event registration)/.test(lower);
  }

  private toImpact(score: number): NewsImpactLevel {
    if (score >= 7) return 'HIGH';
    if (score >= 4) return 'MEDIUM';
    return 'LOW';
  }

  private extractPublishedDate(url: string, contextText: string): string | null {
    const fromUrl = this.extractDateFromUrl(url);
    if (fromUrl) {
      return fromUrl;
    }

    const fromText = this.extractDateFromText(contextText);
    return fromText;
  }

  private extractDateFromUrl(url: string): string | null {
    const isoMatch = url.match(/(\d{4}-\d{2}-\d{2})(?:$|[^\d])/);
    if (isoMatch?.[1]) {
      return isoMatch[1];
    }

    const slashMatch = url.match(/(20\d{2})\/(\d{2})\/(\d{2})/);
    if (slashMatch) {
      return `${slashMatch[1]}-${slashMatch[2]}-${slashMatch[3]}`;
    }

    return null;
  }

  private extractDateFromText(rawText: string): string | null {
    const text = rawText.replace(/\s+/g, ' ');
    const isoMatch = text.match(/(20\d{2})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if (isoMatch) {
      const year = Number(isoMatch[1]);
      const month = Number(isoMatch[2]);
      const day = Number(isoMatch[3]);

      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }

    const dmyMatch = text.match(/(\d{1,2})[-\/](\d{1,2})[-\/](20\d{2})/);
    if (dmyMatch) {
      const day = Number(dmyMatch[1]);
      const month = Number(dmyMatch[2]);
      const year = Number(dmyMatch[3]);

      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }

    const match = text.match(
      /(\d{1,2})\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[,\s]+(20\d{2})/i,
    );

    if (!match) {
      return null;
    }

    const day = Number(match[1]);
    const monthToken = match[2].slice(0, 3).toLowerCase();
    const year = Number(match[3]);
    const monthMap: Record<string, number> = {
      jan: 1,
      feb: 2,
      mar: 3,
      apr: 4,
      may: 5,
      jun: 6,
      jul: 7,
      aug: 8,
      sep: 9,
      oct: 10,
      nov: 11,
      dec: 12,
    };

    const month = monthMap[monthToken];
    if (!month || day < 1 || day > 31) {
      return null;
    }

    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  private isWithinRecentWindow(isoDate: string, now: Date): boolean {
    const parsed = Date.parse(isoDate);
    if (!Number.isFinite(parsed)) {
      return false;
    }

    const ageMs = now.getTime() - parsed;
    if (ageMs < 0) {
      return false;
    }

    return ageMs <= RECENT_DAYS_WINDOW * 24 * 60 * 60 * 1000;
  }

  private normalizeLimit(limit?: number): number {
    const parsed = Number(limit ?? DEFAULT_LIMIT);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_LIMIT;
    }

    return Math.min(Math.floor(parsed), MAX_LIMIT);
  }

}
