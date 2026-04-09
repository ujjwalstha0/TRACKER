import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { EconomicNewsItem, EconomicNewsResponse, NewsImpactLevel } from './news.types';

const NEWS_SOURCE_URL = 'https://www.sharesansar.com/news-page';
const CACHE_TTL_MS = 3 * 60 * 1000;
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 80;

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

    const html = await this.fetchNewsHtml();
    const parsed = this.parseNews(html)
      .sort((a, b) => {
        const dateA = a.publishedDate ? Date.parse(a.publishedDate) : 0;
        const dateB = b.publishedDate ? Date.parse(b.publishedDate) : 0;
        return dateB - dateA || b.relevanceScore - a.relevanceScore;
      })
      .slice(0, MAX_LIMIT);

    const payload: EconomicNewsResponse = {
      asOf: new Date(now).toISOString(),
      source: 'sharesansar',
      count: Math.min(normalizedLimit, parsed.length),
      items: parsed.slice(0, normalizedLimit),
    };

    this.cache = {
      fetchedAt: now,
      payload: {
        ...payload,
        count: parsed.length,
        items: parsed,
      },
    };

    return payload;
  }

  private async fetchNewsHtml(): Promise<string> {
    try {
      const response = await axios.get<string>(NEWS_SOURCE_URL, {
        timeout: 12000,
        headers: FETCH_HEADERS,
        responseType: 'text',
      });

      return response.data;
    } catch (error) {
      this.logger.warn('Unable to fetch economy news source; returning cached headlines when available.');
      if (this.cache) {
        return this.renderFallbackHtml(this.cache.payload.items);
      }

      throw error;
    }
  }

  private parseNews(html: string): EconomicNewsItem[] {
    const $ = cheerio.load(html);
    const dedupe = new Set<string>();
    const items: EconomicNewsItem[] = [];

    for (const anchor of $('a[href*="/newsdetail/"]').toArray()) {
      const element = $(anchor);
      const href = element.attr('href');
      const headline = element.text().replace(/\s+/g, ' ').trim();

      if (!href || headline.length < 14) {
        continue;
      }

      const url = href.startsWith('http') ? href : new URL(href, NEWS_SOURCE_URL).toString();
      if (dedupe.has(url)) {
        continue;
      }

      const tags = this.detectTags(headline);
      if (!tags.length) {
        continue;
      }

      dedupe.add(url);

      const relevanceScore = this.computeRelevanceScore(headline, tags);
      const impact = this.toImpact(relevanceScore);

      items.push({
        headline,
        url,
        source: 'sharesansar',
        publishedDate: this.extractDateFromUrl(url),
        impact,
        relevanceScore,
        tags,
      });
    }

    return items;
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
    let score = tags.length;

    if (/(nrb|central bank|monetary|policy rate|interest rate|liquidity|budget|tax)/.test(lower)) {
      score += 3;
    }

    if (/(nepse|ipo|fpo|right share|dividend|bonus|merger|acquisition)/.test(lower)) {
      score += 2;
    }

    if (/(gdp|inflation|remittance|forex|currency|credit|deposit|lending)/.test(lower)) {
      score += 2;
    }

    if (/(profit|quarter|q1|q2|q3|q4|results)/.test(lower)) {
      score += 1;
    }

    return Math.min(score, 10);
  }

  private toImpact(score: number): NewsImpactLevel {
    if (score >= 7) return 'HIGH';
    if (score >= 4) return 'MEDIUM';
    return 'LOW';
  }

  private extractDateFromUrl(url: string): string | null {
    const match = url.match(/(\d{4}-\d{2}-\d{2})(?:$|[^\d])/);
    return match?.[1] ?? null;
  }

  private normalizeLimit(limit?: number): number {
    const parsed = Number(limit ?? DEFAULT_LIMIT);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_LIMIT;
    }

    return Math.min(Math.floor(parsed), MAX_LIMIT);
  }

  private renderFallbackHtml(items: EconomicNewsItem[]): string {
    const links = items
      .map((item) => `<a href="${item.url}">${item.headline}</a>`)
      .join('\n');

    return `<html><body>${links}</body></html>`;
  }
}
