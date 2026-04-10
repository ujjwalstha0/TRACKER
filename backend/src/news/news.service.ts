import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { PrismaService } from '../prisma/prisma.service';
import {
  AppliedIpoAlertsResponse,
  AppliedIpoAlertItem,
  EconomicNewsItem,
  EconomicNewsResponse,
  IpoAlertStatusResponse,
  NewsImpactLevel,
  NewsImpactScope,
  NepalLivePriceItem,
  NepalLivePricesResponse,
  NewsSentiment,
} from './news.types';

const CACHE_TTL_MS = 3 * 60 * 1000;
const LIVE_PRICE_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 80;
const RECENT_DAYS_WINDOW = 5;
const MIN_RELEVANCE_SCORE = 4;
const RELAXED_RELEVANCE_SCORE = 2;

const NEPSE_PROVE_URL = 'https://www.nepalstock.com.np/api/authenticate/prove';
const NEPSE_NOTICE_URL = 'https://www.nepalstock.com.np/api/web/notice/';
const NEPSE_DISCLOSURE_URL = 'https://www.nepalstock.com.np/api/nots/news/companies/disclosure';
const FENEGOSIDA_URL = 'https://fenegosida.org';
const NOC_RETAIL_URL = 'https://noc.org.np/retailprice';
const NOC_HOME_URL = 'https://noc.org.np';
const NPSTOCKS_BLOG_API_URL = 'https://api.npstocks.com/api/blog/public/all-blogs';

interface HtmlNewsSourceConfig {
  key: string;
  url: string;
  selectors: string[];
}

interface RssNewsSourceConfig {
  key: string;
  url: string;
}

const HTML_NEWS_SOURCES: HtmlNewsSourceConfig[] = [
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
  {
    key: 'sebon',
    url: 'https://www.sebon.gov.np/news',
    selectors: ['a[href*="/news/"]', 'a[href*="/notices/"]', 'a[href*="/prospectus/"]'],
  },
  {
    key: 'sebon',
    url: 'https://www.sebon.gov.np/notices',
    selectors: ['a[href*="/notices/"]', 'a[href*="/news/"]'],
  },
  {
    key: 'cdsc',
    url: 'https://cdsc.com.np/Home/news',
    selectors: ['a[href*="news_notice_files/"]', 'a[href*="/Home/news"]'],
  },
  {
    key: 'cdsc',
    url: 'https://cdsc.com.np/Home/pressrelease',
    selectors: ['a[href*="press_release_files/"]'],
  },
  {
    key: 'cdsc',
    url: 'https://cdsc.com.np/circulars',
    selectors: ['a[href*="downloads_files/"]'],
  },
];

const RSS_NEWS_SOURCES: RssNewsSourceConfig[] = [
  {
    key: 'kathmandupost',
    url: 'https://kathmandupost.com/rss/money',
  },
  {
    key: 'myrepublica',
    url: 'https://myrepublica.nagariknetwork.com/rss/business',
  },
  {
    key: 'investopaper',
    url: 'https://www.investopaper.com/news/feed/',
  },
  {
    key: 'bbc-business',
    url: 'https://feeds.bbci.co.uk/news/business/rss.xml',
  },
  {
    key: 'reuters-business',
    url: 'https://feeds.reuters.com/reuters/businessNews',
  },
  {
    key: 'cnbc-world',
    url: 'https://www.cnbc.com/id/100727362/device/rss/rss.html',
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

interface CachedLivePrices {
  fetchedAt: number;
  payload: NepalLivePricesResponse;
}

interface ParsedNewsSourceItem {
  headline: string;
  url: string;
  source: string;
  publishedDate: string;
}

interface NepseProveResponse {
  accessToken?: string;
}

interface NepseNoticeApiItem {
  id?: number;
  noticeHeading?: string;
  noticeBody?: string;
  noticeFilePath?: string;
  modifiedDate?: string;
  noticeExpiryDate?: string;
}

interface NepseDisclosureApiItem {
  id?: number;
  messageTitle?: string;
  messageBody?: string;
  addedDate?: string;
  modifiedDate?: string;
  approvedDate?: string;
}

interface NepseDisclosureApiResponse {
  exchangeMessages?: NepseDisclosureApiItem[];
}

interface NpStocksBlogApiItem {
  title?: string;
  blogDate?: string;
  pageUrl?: string;
}

interface NpStocksBlogApiResponse {
  data?: NpStocksBlogApiItem[];
}

interface BullionSnapshot {
  goldPerTola: number | null;
  silverPerTola: number | null;
  asOf: string;
  note: string | null;
}

interface FuelSnapshot {
  petrolPerL: number | null;
  dieselPerL: number | null;
  asOf: string;
  note: string | null;
}

interface IpoAlertStatusRow {
  ipoAlertId: string;
  appliedAt: Date | string;
}

@Injectable()
export class NewsService {
  private readonly logger = new Logger(NewsService.name);
  private cache: CachedNews | null = null;
  private livePriceCache: CachedLivePrices | null = null;

  constructor(private readonly prisma: PrismaService) {}

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
    const ranked = this.curateUsefulItems(parsed).sort((a, b) => {
      const dateA = Date.parse(a.publishedDate ?? '1970-01-01');
      const dateB = Date.parse(b.publishedDate ?? '1970-01-01');
      return dateB - dateA || b.relevanceScore - a.relevanceScore;
    });

    const curated = this.prioritizeSourceDiversity(ranked);

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

  async getNepalLivePrices(): Promise<NepalLivePricesResponse> {
    const now = Date.now();
    if (this.livePriceCache && now - this.livePriceCache.fetchedAt < LIVE_PRICE_CACHE_TTL_MS) {
      return this.livePriceCache.payload;
    }

    const [bullionResult, fuelResult] = await Promise.allSettled([
      this.fetchBullionPrices(),
      this.fetchFuelPrices(),
    ]);

    const nowIso = new Date(now).toISOString();

    const bullion = bullionResult.status === 'fulfilled' ? bullionResult.value : null;
    const fuel = fuelResult.status === 'fulfilled' ? fuelResult.value : null;

    if (bullionResult.status === 'rejected') {
      this.logger.warn(`Unable to fetch bullion prices: ${String(bullionResult.reason)}`);
    }

    if (fuelResult.status === 'rejected') {
      this.logger.warn(`Unable to fetch fuel prices: ${String(fuelResult.reason)}`);
    }

    const items: NepalLivePriceItem[] = [
      {
        key: 'GOLD',
        label: 'Gold',
        value: bullion?.goldPerTola ?? null,
        unit: 'per tola',
        currency: 'NPR',
        source: 'FENEGOSIDA',
        asOf: bullion?.asOf ?? null,
        note: bullion?.note ?? null,
      },
      {
        key: 'SILVER',
        label: 'Silver',
        value: bullion?.silverPerTola ?? null,
        unit: 'per tola',
        currency: 'NPR',
        source: 'FENEGOSIDA',
        asOf: bullion?.asOf ?? null,
        note: bullion?.note ?? null,
      },
      {
        key: 'PETROL',
        label: 'Petrol',
        value: fuel?.petrolPerL ?? null,
        unit: 'per litre',
        currency: 'NPR',
        source: 'NOC',
        asOf: fuel?.asOf ?? null,
        note: fuel?.note ?? null,
      },
      {
        key: 'DIESEL',
        label: 'Diesel',
        value: fuel?.dieselPerL ?? null,
        unit: 'per litre',
        currency: 'NPR',
        source: 'NOC',
        asOf: fuel?.asOf ?? null,
        note: fuel?.note ?? null,
      },
    ];

    const payload: NepalLivePricesResponse = {
      asOf: nowIso,
      source: 'fenegosida+noc',
      count: items.length,
      items,
    };

    this.livePriceCache = {
      fetchedAt: now,
      payload,
    };

    return payload;
  }

  async getAppliedIpoAlerts(userId: number): Promise<AppliedIpoAlertsResponse> {
    const rows = (await this.prisma.$queryRaw`
      SELECT "ipoAlertId", "appliedAt"
      FROM "IpoAlertStatus"
      WHERE "userId" = ${BigInt(userId)}
      ORDER BY "appliedAt" DESC
      LIMIT 500
    `) as IpoAlertStatusRow[];

    const items = rows.map((row): AppliedIpoAlertItem => ({
      ipoAlertId: row.ipoAlertId,
      appliedAt: this.toIsoString(row.appliedAt),
    }));

    return {
      count: items.length,
      items,
    };
  }

  async markIpoApplied(userId: number, ipoAlertId: string): Promise<IpoAlertStatusResponse> {
    const normalizedId = this.normalizeIpoAlertId(ipoAlertId);

    const rows = (await this.prisma.$queryRaw`
      INSERT INTO "IpoAlertStatus" ("userId", "ipoAlertId", "appliedAt")
      VALUES (${BigInt(userId)}, ${normalizedId}, CURRENT_TIMESTAMP)
      ON CONFLICT ("userId", "ipoAlertId")
      DO UPDATE SET
        "appliedAt" = CURRENT_TIMESTAMP,
        "updatedAt" = CURRENT_TIMESTAMP
      RETURNING "ipoAlertId", "appliedAt"
    `) as IpoAlertStatusRow[];

    const row = rows[0];

    return {
      ipoAlertId: row?.ipoAlertId ?? normalizedId,
      applied: true,
      appliedAt: row ? this.toIsoString(row.appliedAt) : new Date().toISOString(),
    };
  }

  async markIpoPending(userId: number, ipoAlertId: string): Promise<IpoAlertStatusResponse> {
    const normalizedId = this.normalizeIpoAlertId(ipoAlertId);

    await this.prisma.$executeRaw`
      DELETE FROM "IpoAlertStatus"
      WHERE "userId" = ${BigInt(userId)}
        AND "ipoAlertId" = ${normalizedId}
    `;

    return {
      ipoAlertId: normalizedId,
      applied: false,
      appliedAt: null,
    };
  }

  private curateUsefulItems(parsed: ParsedNewsSourceItem[]): EconomicNewsItem[] {
    const scored = parsed.map((item) => {
      const tags = this.detectTags(item.headline);
      const relevanceScore = this.computeRelevanceScore(item.headline, tags);
      const impact = this.toImpact(relevanceScore);
      const sentiment = this.detectSentiment(item.headline, tags);
      const impactScope = this.detectImpactScope(item.headline, tags);
      const affectedSectors = this.detectAffectedSectors(item.headline, tags);
      const affectedSymbols = this.detectLikelySymbols(item.headline);
      const marketEffect = this.buildMarketEffect(
        sentiment,
        impactScope,
        affectedSectors,
        affectedSymbols,
      );

      return {
        headline: item.headline,
        summary: this.buildSummary(item.headline, tags, impact, item.source, sentiment, impactScope),
        url: item.url,
        source: item.source,
        publishedDate: item.publishedDate,
        impact,
        sentiment,
        impactScope,
        marketEffect,
        affectedSectors,
        affectedSymbols,
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

  private prioritizeSourceDiversity(items: EconomicNewsItem[]): EconomicNewsItem[] {
    const pickedIndexes = new Set<number>();
    const seenSources = new Set<string>();
    const diversified: EconomicNewsItem[] = [];

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (seenSources.has(item.source)) {
        continue;
      }

      seenSources.add(item.source);
      pickedIndexes.add(index);
      diversified.push(item);
    }

    for (let index = 0; index < items.length; index += 1) {
      if (pickedIndexes.has(index)) {
        continue;
      }

      diversified.push(items[index]);
    }

    return diversified;
  }

  private async fetchAndParseAllSources(now: Date): Promise<ParsedNewsSourceItem[]> {
    const [htmlResults, rssResults, nepseItems, npstocksItems] = await Promise.all([
      Promise.all(
        HTML_NEWS_SOURCES.map(async (source) => {
          const html = await this.fetchNewsHtml(source.url, source.key);
          if (!html) {
            return [] as ParsedNewsSourceItem[];
          }

          return this.parseNewsBySource(source.url, source.key, source.selectors, html, now);
        }),
      ),
      Promise.all(
        RSS_NEWS_SOURCES.map(async (source) => {
          const xml = await this.fetchNewsHtml(source.url, source.key);
          if (!xml) {
            return [] as ParsedNewsSourceItem[];
          }

          return this.parseRssBySource(source.url, source.key, xml, now);
        }),
      ),
      this.fetchNepseOfficialItems(now),
      this.fetchNpStocksItems(now),
    ]);

    const results: ParsedNewsSourceItem[][] = [...htmlResults, ...rssResults, nepseItems, npstocksItems];

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

  private async fetchNepseOfficialItems(now: Date): Promise<ParsedNewsSourceItem[]> {
    try {
      const proveResponse = await axios.get<NepseProveResponse>(NEPSE_PROVE_URL, {
        timeout: 12000,
        headers: {
          ...FETCH_HEADERS,
          Accept: 'application/json, text/plain, */*',
          Referer: 'https://www.nepalstock.com.np/',
        },
      });

      const accessToken = proveResponse.data?.accessToken;
      if (!accessToken) {
        return [];
      }

      const apiHeaders = {
        ...FETCH_HEADERS,
        Accept: 'application/json, text/plain, */*',
        Referer: 'https://www.nepalstock.com.np/',
        Authorization: `Salter ${accessToken}`,
      };

      const [noticeResult, disclosureResult] = await Promise.allSettled([
        axios.get<NepseNoticeApiItem[]>(NEPSE_NOTICE_URL, {
          timeout: 12000,
          headers: apiHeaders,
          responseType: 'json',
        }),
        axios.get<NepseDisclosureApiResponse>(NEPSE_DISCLOSURE_URL, {
          timeout: 12000,
          headers: apiHeaders,
          responseType: 'json',
        }),
      ]);

      const items: ParsedNewsSourceItem[] = [];
      const dedupe = new Set<string>();

      if (noticeResult.status === 'fulfilled' && Array.isArray(noticeResult.value.data)) {
        for (const notice of noticeResult.value.data.slice(0, 30)) {
          const headline = this.normalizeHeadline(
            (notice.noticeHeading ?? this.toPlainText(notice.noticeBody ?? '')).trim(),
          );

          if (!headline || headline.length < 10) {
            continue;
          }

          const publishDate = this.normalizeFeedDate(notice.modifiedDate);
          if (publishDate && !this.isWithinRecentWindow(publishDate, now)) {
            continue;
          }

          const id = notice.id ?? 0;
          const url = `https://www.nepalstock.com.np/notices?noticeId=${id}`;
          if (dedupe.has(url)) {
            continue;
          }

          dedupe.add(url);

          items.push({
            headline,
            url,
            source: 'nepse-official',
            publishedDate: publishDate ?? now.toISOString().slice(0, 10),
          });
        }
      }

      if (disclosureResult.status === 'fulfilled') {
        const disclosures = disclosureResult.value.data?.exchangeMessages;
        if (Array.isArray(disclosures)) {
          for (const disclosure of disclosures.slice(0, 40)) {
            const headline = this.normalizeHeadline(
              (disclosure.messageTitle ?? this.toPlainText(disclosure.messageBody ?? '')).trim(),
            );

            if (!headline || headline.length < 10) {
              continue;
            }

            const publishDate =
              this.normalizeFeedDate(disclosure.addedDate) ||
              this.normalizeFeedDate(disclosure.modifiedDate) ||
              this.normalizeFeedDate(disclosure.approvedDate);

            if (publishDate && !this.isWithinRecentWindow(publishDate, now)) {
              continue;
            }

            const id = disclosure.id ?? 0;
            const url = `https://www.nepalstock.com.np/corporatedisclosures?messageId=${id}`;
            if (dedupe.has(url)) {
              continue;
            }

            dedupe.add(url);

            items.push({
              headline,
              url,
              source: 'nepse-official',
              publishedDate: publishDate ?? now.toISOString().slice(0, 10),
            });
          }
        }
      }

      return items;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Unable to fetch NEPSE official updates: ${message}`);
      return [];
    }
  }

  private async fetchNpStocksItems(now: Date): Promise<ParsedNewsSourceItem[]> {
    try {
      const response = await axios.get<NpStocksBlogApiResponse>(NPSTOCKS_BLOG_API_URL, {
        timeout: 12000,
        headers: {
          ...FETCH_HEADERS,
          Accept: 'application/json, text/plain, */*',
        },
        responseType: 'json',
      });

      const blogs = Array.isArray(response.data?.data) ? response.data.data : [];
      const fresh: ParsedNewsSourceItem[] = [];
      const fallback: ParsedNewsSourceItem[] = [];
      const dedupe = new Set<string>();

      for (const blog of blogs) {
        const headline = this.normalizeHeadline((blog.title ?? '').trim());
        if (!headline || headline.length < 12) {
          continue;
        }

        const url = this.buildNpStocksBlogUrl(blog.pageUrl);
        if (!url || dedupe.has(url)) {
          continue;
        }

        dedupe.add(url);

        const publishDate = this.normalizeFeedDate(blog.blogDate);
        const parsed: ParsedNewsSourceItem = {
          headline,
          url,
          source: 'npstocks',
          publishedDate: publishDate ?? now.toISOString().slice(0, 10),
        };

        if (publishDate && this.isWithinRecentWindow(publishDate, now)) {
          fresh.push(parsed);
        } else {
          fallback.push(parsed);
        }
      }

      if (fresh.length) {
        return fresh;
      }

      return fallback.slice(0, 3);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Unable to fetch npstocks updates: ${message}`);
      return [];
    }
  }

  private async fetchBullionPrices(): Promise<BullionSnapshot> {
    const html = await this.fetchNewsHtml(FENEGOSIDA_URL, 'fenegosida');
    if (!html) {
      return {
        goldPerTola: null,
        silverPerTola: null,
        asOf: new Date().toISOString(),
        note: 'Source fetch failed',
      };
    }

    const $ = cheerio.load(html);
    let goldPerTola: number | null = null;
    let silverPerTola: number | null = null;

    for (const node of $('p').toArray()) {
      const block = $(node);
      const text = block.text().replace(/\s+/g, ' ').trim().toUpperCase();
      const value = this.parseDecimalValue(block.find('b').first().text());

      if (value === null) {
        continue;
      }

      if (text.includes('FINE GOLD') && text.includes('1 TOLA')) {
        goldPerTola = value;
      }

      if (text.includes('SILVER') && text.includes('1 TOLA')) {
        silverPerTola = value;
      }
    }

    return {
      goldPerTola,
      silverPerTola,
      asOf: new Date().toISOString(),
      note: 'Federation published spot retail rate',
    };
  }

  private async fetchFuelPrices(): Promise<FuelSnapshot> {
    const [retailHtml, homeHtml] = await Promise.all([
      this.fetchNewsHtml(NOC_RETAIL_URL, 'noc-retail'),
      this.fetchNewsHtml(NOC_HOME_URL, 'noc-home'),
    ]);

    let petrolPerL: number | null = null;
    let dieselPerL: number | null = null;
    let asOf = new Date().toISOString();

    if (retailHtml) {
      const $ = cheerio.load(retailHtml);
      let newestDate = Number.NEGATIVE_INFINITY;

      for (const row of $('table tbody tr').toArray()) {
        const cols = $(row)
          .find('td')
          .toArray()
          .map((cell) => $(cell).text().replace(/\s+/g, ' ').trim());

        if (cols.length < 4) {
          continue;
        }

        const petrol = this.parseDecimalValue(cols[2]);
        const diesel = this.parseDecimalValue(cols[3]);

        if (petrol === null || diesel === null) {
          continue;
        }

        const normalizedDate = this.extractDateFromText(cols[0]);
        const parsedDate = normalizedDate ? Date.parse(normalizedDate) : Number.NaN;

        if (Number.isFinite(parsedDate) && parsedDate > newestDate) {
          newestDate = parsedDate;
          petrolPerL = petrol;
          dieselPerL = diesel;
          asOf = new Date(parsedDate).toISOString();
        }
      }
    }

    let rangeNote: string | null = null;
    if (homeHtml) {
      const petrolValues = [...homeHtml.matchAll(/Petrol\(MS\):NRs\s*([\d.]+)\/L/gi)]
        .map((match) => this.parseDecimalValue(match[1]))
        .filter((value): value is number => value !== null);

      const dieselValues = [...homeHtml.matchAll(/Diesel\(HSD\):NRs\s*([\d.]+)\/L/gi)]
        .map((match) => this.parseDecimalValue(match[1]))
        .filter((value): value is number => value !== null);

      if (petrolValues.length && dieselValues.length) {
        const petrolMin = Math.min(...petrolValues);
        const petrolMax = Math.max(...petrolValues);
        const dieselMin = Math.min(...dieselValues);
        const dieselMax = Math.max(...dieselValues);

        rangeNote = `Depot range - petrol: ${petrolMin.toFixed(1)} to ${petrolMax.toFixed(1)}, diesel: ${dieselMin.toFixed(1)} to ${dieselMax.toFixed(1)}.`;

        if (petrolPerL === null) {
          petrolPerL = petrolMax;
        }

        if (dieselPerL === null) {
          dieselPerL = dieselMax;
        }
      }
    }

    return {
      petrolPerL,
      dieselPerL,
      asOf,
      note: rangeNote,
    };
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
      if (!href) {
        continue;
      }

      const url = this.normalizeUrl(href, sourceUrl);
      if (!url || this.isLikelyNonArticleLink(url)) {
        continue;
      }

      const anchorHeadline = element.text().replace(/\s+/g, ' ').trim();
      const fallbackHeadline = this.extractHeadlineFromUrl(url);
      const headline = (anchorHeadline.length >= 12 ? anchorHeadline : fallbackHeadline).replace(/\s+/g, ' ').trim();

      if (headline.length < 12 || headline.length > 260) {
        continue;
      }

      if (dedupe.has(url)) {
        continue;
      }

      const extractedDate = this.extractPublishedDate(url, element.closest('article,li,div').text());
      if (extractedDate && !this.isWithinRecentWindow(extractedDate, now)) {
        continue;
      }

      const publishedDate = extractedDate ?? now.toISOString().slice(0, 10);

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

  private parseRssBySource(
    sourceUrl: string,
    sourceKey: string,
    xml: string,
    now: Date,
  ): ParsedNewsSourceItem[] {
    const $ = cheerio.load(xml, { xmlMode: true });
    const dedupe = new Set<string>();
    const items: ParsedNewsSourceItem[] = [];

    for (const node of $('item').toArray()) {
      const item = $(node);
      const headline = item.find('title').first().text().replace(/\s+/g, ' ').trim();
      const linkRaw =
        item.find('link').first().text().trim() || item.find('guid').first().text().trim();

      if (!headline || headline.length < 20 || !linkRaw) {
        continue;
      }

      const url = this.normalizeUrl(linkRaw, sourceUrl);
      if (!url || this.isLikelyNonArticleLink(url) || dedupe.has(url)) {
        continue;
      }

      const pubDateRaw =
        item.find('pubDate').first().text().trim() ||
        item.find('dc\\:date').first().text().trim() ||
        item.find('published').first().text().trim();

      const fallbackContext = item.find('description').first().text();
      const extractedDate =
        this.normalizeFeedDate(pubDateRaw) || this.extractDateFromText(fallbackContext);

      if (extractedDate && !this.isWithinRecentWindow(extractedDate, now)) {
        continue;
      }

      dedupe.add(url);

      items.push({
        headline,
        url,
        source: sourceKey,
        publishedDate: extractedDate ?? now.toISOString().slice(0, 10),
      });
    }

    return items;
  }

  private normalizeFeedDate(value: string | null | undefined): string | null {
    if (!value) {
      return null;
    }

    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) {
      return null;
    }

    return new Date(parsed).toISOString().slice(0, 10);
  }

  private normalizeUrl(href: string, sourceUrl: string): string | null {
    try {
      return href.startsWith('http') ? href : new URL(href, sourceUrl).toString();
    } catch {
      return null;
    }
  }

  private extractHeadlineFromUrl(url: string): string {
    try {
      const parsed = new URL(url);
      const pathname = decodeURIComponent(parsed.pathname);
      const lastSegment = pathname.split('/').filter(Boolean).pop() ?? '';
      const withoutExt = lastSegment.replace(/\.[a-z0-9]{2,6}$/i, '');
      const withoutTimestamp = withoutExt.replace(/^\d{4}[._-]\d{2}[._-]\d{2}[._-]\d{2}[._-]\d{2}[._-]\d{2}[._-]?/, '');

      return withoutTimestamp
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    } catch {
      return '';
    }
  }

  private toPlainText(raw: string): string {
    if (!raw) {
      return '';
    }

    return cheerio.load(`<div>${raw}</div>`)
      .text()
      .replace(/\s+/g, ' ')
      .trim();
  }

  private buildNpStocksBlogUrl(pageUrl: string | undefined): string | null {
    if (!pageUrl) {
      return null;
    }

    const trimmed = pageUrl.trim();
    if (!trimmed) {
      return null;
    }

    const path = trimmed.startsWith('/blogs/')
      ? trimmed
      : `/blogs/${trimmed.replace(/^\/+/, '')}`;

    try {
      return new URL(path, 'https://npstocks.com').toString();
    } catch {
      return null;
    }
  }

  private parseDecimalValue(raw: string): number | null {
    const normalized = raw.replace(/,/g, '').trim();
    if (!normalized) {
      return null;
    }

    const match = normalized.match(/\d+(?:\.\d+)?/);
    if (!match) {
      return null;
    }

    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private isLikelyNonArticleLink(url: string): boolean {
    const lower = url.toLowerCase();
    return (
      lower.includes('/category/') ||
      lower.includes('/tag/') ||
      lower.includes('/author/') ||
      lower.includes('/advertise') ||
      lower.includes('?page=') ||
      lower.endsWith('/news') ||
      lower.endsWith('/notices') ||
      lower.endsWith('/prospectus') ||
      lower.endsWith('/pressrelease') ||
      lower.endsWith('/circulars')
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

    if (/(nepse|sebon|cdsc|ipo|fpo|right share|dividend|bonus|merger|acquisition|book closure|agm|sgm|listing|depository|disclosure|broker)/.test(lower)) {
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

    if (/(nepse|sebon|cdsc|index|turnover|trading volume|market capitalization|disclosure|listing)/.test(lower)) {
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

  private detectSentiment(headline: string, tags: string[]): NewsSentiment {
    const lower = headline.toLowerCase();

    const hasPositiveSignal =
      /(surge|rally|record high|gain|gains|rises|rise|improve|improves|growth|expands|expansion|upbeat|boost)/.test(
        lower,
      ) ||
      /(policy support|rate cut|eases|easing|strong demand|profit jump|dividend approved)/.test(lower);

    const hasNegativeSignal =
      /(fall|falls|drop|drops|decline|declines|slump|plunge|sell-off|bearish|loss|losses|weakness)/.test(
        lower,
      ) ||
      /(rate hike|tightening|inflation spike|default|downgrade|penalty|investigation|warning)/.test(lower);

    if (hasPositiveSignal && !hasNegativeSignal) {
      return 'POSITIVE';
    }

    if (hasNegativeSignal && !hasPositiveSignal) {
      return 'NEGATIVE';
    }

    if (tags.includes('Monetary Policy') || tags.includes('Fiscal Policy')) {
      return 'NEUTRAL';
    }

    return 'NEUTRAL';
  }

  private detectImpactScope(headline: string, tags: string[]): NewsImpactScope {
    const lower = headline.toLowerCase();

    if (
      tags.some((tag) =>
        ['Monetary Policy', 'Inflation & Commodities', 'Fiscal Policy', 'External Sector', 'Macro Growth'].includes(
          tag,
        ),
      ) ||
      /(nrb|central bank|budget|fiscal|inflation|gdp|remittance|forex|currency|policy rate|interest rate)/.test(
        lower,
      )
    ) {
      return 'MACRO';
    }

    if (
      /(nepse|sebon|cdsc|bourse|benchmark index|market turnover|broader market|all sectors|market-wide|depository|listing)/.test(
        lower,
      )
    ) {
      return 'MARKET';
    }

    if (
      /(banking sector|hydropower sector|insurance sector|microfinance sector|hotel sector|manufacturing sector|sector index)/.test(
        lower,
      )
    ) {
      return 'SECTOR';
    }

    return 'COMPANY';
  }

  private detectAffectedSectors(headline: string, tags: string[]): string[] {
    const lower = headline.toLowerCase();
    const sectors = new Set<string>();

    if (/(bank|banking|bfi|finance|credit)/.test(lower) || tags.includes('Banking & Credit')) {
      sectors.add('Banking');
    }

    if (/(hydro|hydropower|power project)/.test(lower)) {
      sectors.add('Hydropower');
    }

    if (/(insurance|life insurance|non-life)/.test(lower)) {
      sectors.add('Insurance');
    }

    if (/(microfinance|laghubitta)/.test(lower)) {
      sectors.add('Microfinance');
    }

    if (/(hotel|tourism)/.test(lower)) {
      sectors.add('Hotels & Tourism');
    }

    if (/(manufacturing|cement|factory)/.test(lower)) {
      sectors.add('Manufacturing');
    }

    if (/(trading company|import|export)/.test(lower)) {
      sectors.add('Trading');
    }

    return [...sectors].slice(0, 3);
  }

  private detectLikelySymbols(headline: string): string[] {
    const matches = headline.match(/\b[A-Z]{3,6}\b/g) ?? [];
    const blocked = new Set([
      'NEPSE',
      'NRB',
      'IPO',
      'FPO',
      'AGM',
      'SGM',
      'GDP',
      'CPI',
      'NPL',
      'USD',
      'NPR',
      'SEBON',
      'RBI',
      'FED',
    ]);

    const symbols = new Set<string>();
    for (const token of matches) {
      if (blocked.has(token)) {
        continue;
      }

      symbols.add(token);
    }

    return [...symbols].slice(0, 4);
  }

  private buildMarketEffect(
    sentiment: NewsSentiment,
    impactScope: NewsImpactScope,
    affectedSectors: string[],
    affectedSymbols: string[],
  ): string {
    if (impactScope === 'MARKET' || impactScope === 'MACRO') {
      if (sentiment === 'POSITIVE') {
        return 'Likely supportive for overall market breadth and risk appetite.';
      }

      if (sentiment === 'NEGATIVE') {
        return 'Likely to pressure broader market sentiment and increase risk aversion.';
      }

      return 'Likely to create mixed market reaction until follow-up confirmation appears.';
    }

    if (impactScope === 'SECTOR') {
      const sectorLabel = affectedSectors[0] ?? 'the related';
      if (sentiment === 'POSITIVE') {
        return `Mostly positive for ${sectorLabel.toLowerCase()} sector names, with limited spillover elsewhere.`;
      }

      if (sentiment === 'NEGATIVE') {
        return `Mostly negative for ${sectorLabel.toLowerCase()} sector names; broader impact may stay contained.`;
      }

      return `Sector-specific impact for ${sectorLabel.toLowerCase()} names with mixed follow-through potential.`;
    }

    const symbolLabel = affectedSymbols[0] ?? 'the mentioned company';
    if (sentiment === 'POSITIVE') {
      return `Primarily positive for ${symbolLabel}, while broad-market impact is usually limited.`;
    }

    if (sentiment === 'NEGATIVE') {
      return `Primarily negative for ${symbolLabel}, with limited impact beyond related names.`;
    }

    return `Company-level development for ${symbolLabel} with neutral to mixed market implications.`;
  }

  private buildSummary(
    headline: string,
    tags: string[],
    impact: NewsImpactLevel,
    source: string,
    sentiment: NewsSentiment,
    impactScope: NewsImpactScope,
  ): string {
    const normalizedHeadline = this.normalizeHeadline(headline);
    const primaryTheme = tags[0] ?? 'Market Context';
    const sourceLabel = this.toSourceLabel(source);

    const impactSummary =
      impact === 'HIGH'
        ? 'This can move short-term NEPSE sentiment and trigger quick sector rotation.'
        : impact === 'MEDIUM'
          ? 'This can influence near-term positioning if follow-up headlines confirm the trend.'
          : 'This is mainly background context, but still useful for understanding overall market tone.';

    const scopeSummary =
      impactScope === 'MACRO'
        ? 'The scope is macro-level, so multiple sectors can react.'
        : impactScope === 'MARKET'
          ? 'The scope is market-wide and can influence broad sentiment.'
          : impactScope === 'SECTOR'
            ? 'The scope is sector-specific and can rotate money within related stocks.'
            : 'The scope is company-specific and usually affects selected counters first.';

    const sentimentSummary =
      sentiment === 'POSITIVE'
        ? 'Current signal leans positive.'
        : sentiment === 'NEGATIVE'
          ? 'Current signal leans negative.'
          : 'Current signal is neutral/mixed.';

    return `${normalizedHeadline}. Based on the headline from ${sourceLabel}, the main theme is ${primaryTheme.toLowerCase()}. ${impactSummary} ${scopeSummary} ${sentimentSummary} ${this.themeTakeaway(primaryTheme)}`;
  }

  private normalizeHeadline(headline: string): string {
    return headline
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[.!?]+$/, '');
  }

  private toSourceLabel(source: string): string {
    const normalized = source.trim().toLowerCase();

    if (normalized === 'sharesansar') return 'Sharesansar';
    if (normalized === 'merolagani') return 'MeroLagani';
    if (normalized === 'bizshala') return 'Bizshala';
    if (normalized === 'kathmandupost') return 'Kathmandu Post';
    if (normalized === 'myrepublica') return 'MyRepublica';
    if (normalized === 'investopaper') return 'Investopaper';
    if (normalized === 'npstocks') return 'npstocks';
    if (normalized === 'sebon') return 'SEBON';
    if (normalized === 'cdsc') return 'CDSC';
    if (normalized === 'nepse-official') return 'NEPSE Official';
    if (normalized === 'bbc-business') return 'BBC Business';
    if (normalized === 'reuters-business') return 'Reuters Business';
    if (normalized === 'cnbc-world') return 'CNBC';

    return source.charAt(0).toUpperCase() + source.slice(1);
  }

  private themeTakeaway(tag: string): string {
    if (tag === 'Monetary Policy') {
      return 'Monitor liquidity, lending costs, and banking-led momentum for confirmation.';
    }

    if (tag === 'Inflation & Commodities') {
      return 'Track input-cost pressure and inflation-sensitive sectors before sizing new entries.';
    }

    if (tag === 'Fiscal Policy') {
      return 'Budget and tax direction can affect sector earnings expectations and spending flow.';
    }

    if (tag === 'External Sector') {
      return 'Remittance and forex trends often shape domestic liquidity and import-linked earnings.';
    }

    if (tag === 'Banking & Credit') {
      return 'Credit and deposit trends are key for the banking index and broader risk appetite.';
    }

    if (tag === 'Market Structure') {
      return 'Validate this with turnover expansion and market breadth before chasing moves.';
    }

    if (tag === 'Macro Growth') {
      return 'Growth expectations can rotate capital between cyclical and defensive sectors.';
    }

    return 'Use this as context alongside price action and risk controls before making decisions.';
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

    return /(nepse|sebon|cdsc|disclosure|listing|market turnover|market capitalization|liquidity crunch|credit growth)/.test(
      lower,
    );
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
    const isoMatch = text.match(/(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
    if (isoMatch) {
      const year = Number(isoMatch[1]);
      const month = Number(isoMatch[2]);
      const day = Number(isoMatch[3]);

      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }

    const dmyMatch = text.match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})/);
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

  private normalizeIpoAlertId(ipoAlertId: string): string {
    const normalized = ipoAlertId.trim();

    if (normalized.length < 6 || normalized.length > 600) {
      throw new BadRequestException('Invalid ipoAlertId.');
    }

    return normalized;
  }

  private toIsoString(value: Date | string): string {
    if (value instanceof Date) {
      return value.toISOString();
    }

    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }

    return new Date().toISOString();
  }

  private normalizeLimit(limit?: number): number {
    const parsed = Number(limit ?? DEFAULT_LIMIT);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_LIMIT;
    }

    return Math.min(Math.floor(parsed), MAX_LIMIT);
  }

}
