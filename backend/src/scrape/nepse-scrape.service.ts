import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { AnyNode } from 'domhandler';
import * as https from 'https';
import scrapeConfig from '../config/scrape.config';
import { PrismaService } from '../prisma/prisma.service';
import { IndexValueDto, PriceDto } from './scrape.types';

const FALLBACK_TODAY_PRICE_URL = 'https://www.sharesansar.com/today-share-price';
const FALLBACK_LIVE_TRADING_URL = 'https://www.sharesansar.com/live-trading';

@Injectable()
export class NepseScrapeService {
  private readonly logger = new Logger(NepseScrapeService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(scrapeConfig.KEY)
    private readonly config: ConfigType<typeof scrapeConfig>,
  ) {}

  async scrapeTodayPrices(): Promise<PriceDto[]> {
    const html = await this.fetchHtmlWithFallback(this.config.todayPriceUrl, [FALLBACK_TODAY_PRICE_URL]);
    return this.parseTodayPrices(html);
  }

  async scrapeIndices(): Promise<IndexValueDto[]> {
    const html = await this.fetchHtmlWithFallback(this.config.liveTradingUrl, [FALLBACK_LIVE_TRADING_URL]);
    return this.parseIndices(html);
  }

  private async fetchHtmlWithFallback(primaryUrl: string, fallbackUrls: string[]): Promise<string> {
    const urls = [primaryUrl, ...fallbackUrls.filter((url) => url && url !== primaryUrl)];
    let lastError: unknown = null;

    for (const url of urls) {
      try {
        return await this.fetchHtml(url);
      } catch (error) {
        lastError = error;
        this.logger.warn(`Scrape source failed: ${url}`);
      }
    }

    if (lastError instanceof Error) {
      throw lastError;
    }

    throw new Error('All scrape sources failed.');
  }

  async savePricesToDb(prices: PriceDto[]): Promise<void> {
    if (!prices.length) {
      this.logger.warn('No price rows parsed. Skipping DB update.');
      return;
    }

    const savedAt = new Date();

    for (const row of prices) {
      await this.prisma.price.upsert({
        where: { symbol: row.symbol },
        update: {
          // Keep previously known metadata/stats when the upstream feed omits them.
          company: row.company ?? undefined,
          sector: row.sector ?? undefined,
          ltp: row.ltp,
          change: row.change ?? undefined,
          changePct: row.changePct ?? undefined,
          open: row.open ?? undefined,
          high: row.high ?? undefined,
          low: row.low ?? undefined,
          volume: row.volume ?? undefined,
          turnover: row.turnover ?? undefined,
          savedAt,
        },
        create: {
          symbol: row.symbol,
          company: row.company,
          sector: row.sector,
          ltp: row.ltp,
          change: row.change,
          changePct: row.changePct,
          open: row.open,
          high: row.high,
          low: row.low,
          volume: row.volume,
          turnover: row.turnover,
        },
      });

      const open = row.open ?? row.ltp;
      const high = row.high ?? row.ltp;
      const low = row.low ?? row.ltp;
      const close = row.ltp;

      await this.prisma.priceCandle.upsert({
        where: {
          symbol_t: {
            symbol: row.symbol,
            t: savedAt,
          },
        },
        update: {
          o: open,
          h: high,
          l: low,
          c: close,
          v: row.volume,
        },
        create: {
          symbol: row.symbol,
          t: savedAt,
          o: open,
          h: high,
          l: low,
          c: close,
          v: row.volume,
        },
      });
    }
  }

  async saveIndicesToDb(indices: IndexValueDto[]): Promise<void> {
    if (!indices.length) {
      this.logger.warn('No index rows parsed. Skipping DB update.');
      return;
    }

    for (const row of indices) {
      await this.prisma.indexValue.upsert({
        where: { indexName: row.indexName },
        update: {
          value: row.value,
          change: row.change,
          changePct: row.changePct,
          savedAt: new Date(),
        },
        create: {
          indexName: row.indexName,
          value: row.value,
          change: row.change,
          changePct: row.changePct,
        },
      });
    }
  }

  private async fetchHtml(url: string): Promise<string> {
    try {
      const res = await axios.get<string>(url, {
        responseType: 'text',
        timeout: 20000,
      });

      return res.data;
    } catch (error) {
      if (!this.shouldRetryWithInsecureTls(error)) {
        throw error;
      }

      this.logger.warn(`TLS verification failed for ${url}. Retrying scrape request with insecure TLS.`);
      const retryRes = await axios.get<string>(url, {
        responseType: 'text',
        timeout: 20000,
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      });

      return retryRes.data;
    }
  }

  private shouldRetryWithInsecureTls(error: unknown): boolean {
    if (!axios.isAxiosError(error)) return false;

    const code = error.code?.toUpperCase();
    const message = (error.message ?? '').toLowerCase();
    return (
      code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
      code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
      code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
      code === 'CERT_HAS_EXPIRED' ||
      code === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
      message.includes('unable to verify the first certificate')
    );
  }

  private parseTodayPrices(html: string): PriceDto[] {
    const $ = cheerio.load(html);
    const table = this.findTable($, ['symbol', 'ltp']);
    if (!table) return [];

    const headers = this.extractHeaders($, table);
    const rows = this.extractRows($, table);

    const symbolIdx = this.resolveHeaderIndex(headers, ['symbol']);
    const companyIdx = this.resolveHeaderIndex(headers, ['company', 'name']);
    const sectorIdx = this.resolveHeaderIndex(headers, ['sector']);
    const ltpIdx = this.resolveHeaderIndex(headers, ['ltp', 'lasttradedprice']);
    const changeIdx = this.resolveHeaderIndex(headers, ['change']);
    const changePctIdx = this.resolveHeaderIndex(headers, ['change%', 'changepercent', '%change']);
    const openIdx = this.resolveHeaderIndex(headers, ['open']);
    const highIdx = this.resolveHeaderIndex(headers, ['high']);
    const lowIdx = this.resolveHeaderIndex(headers, ['low']);
    const volumeIdx = this.resolveHeaderIndex(headers, ['volume']);
    const turnoverIdx = this.resolveHeaderIndex(headers, ['turnover']);

    const parsed: PriceDto[] = [];

    for (const row of rows) {
      const cells = $(row).find('td').toArray();
      if (!cells.length) continue;

      const symbol = this.readCell($, cells, symbolIdx)?.toUpperCase() ?? '';
      const ltp = this.toNumber(this.readCell($, cells, ltpIdx));
      if (!symbol || ltp === null) continue;

      parsed.push({
        symbol,
        company: this.readCell($, cells, companyIdx),
        sector: this.readCell($, cells, sectorIdx),
        ltp,
        change: this.toNumber(this.readCell($, cells, changeIdx)),
        changePct: this.toNumber(this.readCell($, cells, changePctIdx)),
        open: this.toNumber(this.readCell($, cells, openIdx)),
        high: this.toNumber(this.readCell($, cells, highIdx)),
        low: this.toNumber(this.readCell($, cells, lowIdx)),
        volume: this.toBigInt(this.readCell($, cells, volumeIdx)),
        turnover: this.toNumber(this.readCell($, cells, turnoverIdx)),
      });
    }

    return parsed;
  }

  private parseIndices(html: string): IndexValueDto[] {
    const $ = cheerio.load(html);
    const table = this.findTable($, ['index', 'change']);
    if (table) {
      const parsedFromTable = this.parseIndicesFromTable($, table);
      if (parsedFromTable.length) return parsedFromTable;
    }

    return this.parseIndicesFromCards($);
  }

  private parseIndicesFromTable(
    $: cheerio.CheerioAPI,
    table: cheerio.Cheerio<AnyNode>,
  ): IndexValueDto[] {
    const headers = this.extractHeaders($, table);
    const rows = this.extractRows($, table);

    const nameIdx = this.resolveHeaderIndex(headers, ['index']);
    const valueIdx = this.resolveHeaderIndex(headers, ['value', 'indexvalue', 'last']);
    const changeIdx = this.resolveHeaderIndex(headers, ['change']);
    const changePctIdx = this.resolveHeaderIndex(headers, ['change%', 'changepercent', '%change']);

    const parsed: IndexValueDto[] = [];

    for (const row of rows) {
      const cells = $(row).find('td').toArray();
      if (!cells.length) continue;

      const indexName = this.readCell($, cells, nameIdx) ?? '';
      const value = this.toNumber(this.readCell($, cells, valueIdx));
      const change = this.toNumber(this.readCell($, cells, changeIdx));
      const changePct = this.toNumber(this.readCell($, cells, changePctIdx));

      if (!indexName || value === null || change === null || changePct === null) continue;

      parsed.push({ indexName, value, change, changePct });
    }

    return parsed;
  }

  private parseIndicesFromCards($: cheerio.CheerioAPI): IndexValueDto[] {
    const cards = $('.mu-list').toArray();
    if (!cards.length) return [];

    const parsed: IndexValueDto[] = [];

    for (const card of cards) {
      const cardEl = $(card);
      const indexName = cardEl.find('h4').first().text().trim();
      if (!indexName) continue;

      const value = this.toNumber(cardEl.find('.mu-value').first().text());
      const rawPct = this.toNumber(cardEl.find('.mu-percent').first().text());
      if (value === null || rawPct === null) continue;

      const changePct = this.applyDirectionalSign(cardEl.find('.mu-percent').first(), rawPct);
      const change = this.estimateChangeFromPercent(value, changePct);

      parsed.push({ indexName, value, change, changePct });
    }

    return parsed;
  }

  private applyDirectionalSign(element: cheerio.Cheerio<AnyNode>, value: number): number {
    const classNames = (element.attr('class') ?? '').toLowerCase();
    const iconClasses = (element.find('i').attr('class') ?? '').toLowerCase();

    if (classNames.includes('text-red') || iconClasses.includes('caret-down')) {
      return -Math.abs(value);
    }

    if (classNames.includes('text-green') || iconClasses.includes('caret-up')) {
      return Math.abs(value);
    }

    return value;
  }

  private estimateChangeFromPercent(value: number, changePct: number): number {
    const ratio = changePct / 100;
    if (ratio === 0 || ratio <= -1) return 0;

    const previous = value / (1 + ratio);
    const change = value - previous;
    return Number(change.toFixed(4));
  }

  private findTable($: cheerio.CheerioAPI, requiredHeaderFragments: string[]): cheerio.Cheerio<AnyNode> | null {
    for (const table of $('table').toArray()) {
      const headers = this.extractHeaders($, $(table));
      const normalized = headers.map((h) => this.normalize(h));
      const hasAll = requiredHeaderFragments.every((fragment) =>
        normalized.some((header) => header.includes(this.normalize(fragment))),
      );

      if (hasAll) {
        return $(table);
      }
    }

    return null;
  }

  private extractHeaders($: cheerio.CheerioAPI, table: cheerio.Cheerio<AnyNode>): string[] {
    const fromHead = table
      .find('thead th')
      .toArray()
      .map((cell) => $(cell).text().trim())
      .filter(Boolean);

    if (fromHead.length) return fromHead;

    return table
      .find('tr')
      .first()
      .find('th,td')
      .toArray()
      .map((cell) => $(cell).text().trim())
      .filter(Boolean);
  }

  private extractRows($: cheerio.CheerioAPI, table: cheerio.Cheerio<AnyNode>): AnyNode[] {
    const bodyRows = table.find('tbody tr').toArray();
    if (bodyRows.length) return bodyRows;

    return table.find('tr').slice(1).toArray();
  }

  private resolveHeaderIndex(headers: string[], candidates: string[]): number {
    const normalized = headers.map((h) => this.normalize(h));
    for (const candidate of candidates) {
      const matchIdx = normalized.findIndex((header) => header.includes(this.normalize(candidate)));
      if (matchIdx >= 0) return matchIdx;
    }

    return -1;
  }

  private readCell($: cheerio.CheerioAPI, cells: AnyNode[], index: number): string | null {
    if (index < 0 || index >= cells.length) return null;
    const value = $(cells[index]).text().replace(/\s+/g, ' ').trim();
    return value || null;
  }

  private normalize(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private toNumber(value: string | null): number | null {
    if (!value) return null;

    const text = value.trim();
    const negative = text.startsWith('(') && text.endsWith(')');
    const cleaned = text
      .replace(/,/g, '')
      .replace(/%/g, '')
      .replace(/rs\.?/gi, '')
      .replace(/[()]/g, '')
      .trim();

    if (!cleaned) return null;

    const multiplier = this.extractMagnitudeMultiplier(cleaned);
    const numberOnly = cleaned.replace(/[a-z]/gi, '');
    const parsed = Number(numberOnly);
    if (!Number.isFinite(parsed)) return null;

    const signed = negative ? -Math.abs(parsed) : parsed;
    return Number((signed * multiplier).toFixed(4));
  }

  private toBigInt(value: string | null): bigint | null {
    const asNumber = this.toNumber(value);
    if (asNumber === null) return null;
    return BigInt(Math.round(asNumber));
  }

  private extractMagnitudeMultiplier(value: string): number {
    const lower = value.toLowerCase();
    if (lower.includes('cr')) return 10_000_000;
    if (lower.includes('m')) return 1_000_000;
    if (lower.includes('k')) return 1_000;
    return 1;
  }
}
