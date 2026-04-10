import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios, { AxiosRequestConfig } from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import {
  OhlcBackfillJobState,
  OhlcBackfillRequest,
  OhlcBackfillSymbolReport,
} from './ohlc.types';

const SHARESANSAR_COMPANY_LIST_URL = 'https://www.sharesansar.com/company-list';
const SHARESANSAR_COMPANY_PRICE_HISTORY_URL = 'https://www.sharesansar.com/company-price-history';
const HISTORY_PAGE_SIZE = 50;

const DEFAULT_SYMBOLS_LIMIT = 220;
const MIN_SYMBOLS_LIMIT = 20;
const MAX_SYMBOLS_LIMIT = 450;

const DEFAULT_THROTTLE_MS = 45;
const MIN_THROTTLE_MS = 0;
const MAX_THROTTLE_MS = 500;

const MAX_RECENT_REPORTS = 30;
const HISTORY_FETCH_RETRY_COUNT = 3;

const SCRAPE_HTTP_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

interface SharesansarCompanyDirectoryRow {
  id?: unknown;
  symbol?: unknown;
}

interface SharesansarHistoryRow {
  published_date?: unknown;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
  traded_quantity?: unknown;
}

interface SharesansarHistoryResponse {
  recordsTotal?: unknown;
  data?: unknown;
}

interface SharesansarSession {
  csrfToken: string;
  cookieHeader: string;
  companyDirectory: Map<string, number>;
}

interface NormalizedBackfillOptions {
  symbolsLimit: number;
  sinceDays: number | null;
  throttleMs: number;
}

interface NormalizedHistoryRow {
  t: Date;
  o: number;
  h: number;
  l: number;
  c: number;
  v: bigint | null;
  dateText: string;
}

interface CandleInsertRow {
  symbol: string;
  t: Date;
  o: number;
  h: number;
  l: number;
  c: number;
  v: bigint | null;
}

@Injectable()
export class OhlcBackfillService {
  private readonly logger = new Logger(OhlcBackfillService.name);

  private jobState: OhlcBackfillJobState = {
    jobId: null,
    status: 'IDLE',
    startedAt: null,
    finishedAt: null,
    options: {
      symbolsLimit: DEFAULT_SYMBOLS_LIMIT,
      sinceDays: null,
      throttleMs: DEFAULT_THROTTLE_MS,
    },
    progress: {
      totalSymbols: 0,
      processedSymbols: 0,
      totalFetchedRows: 0,
      totalInsertedCandles: 0,
      currentSymbol: null,
    },
    recentReports: [],
    error: null,
  };

  constructor(private readonly prisma: PrismaService) {}

  startAllSymbolsBackfill(request?: OhlcBackfillRequest): OhlcBackfillJobState {
    if (this.jobState.status === 'RUNNING') {
      return this.jobState;
    }

    const options = this.normalizeOptions(request);
    const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    this.jobState = {
      jobId,
      status: 'RUNNING',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      options,
      progress: {
        totalSymbols: 0,
        processedSymbols: 0,
        totalFetchedRows: 0,
        totalInsertedCandles: 0,
        currentSymbol: null,
      },
      recentReports: [],
      error: null,
    };

    void this.runBackfillJob(jobId, options);
    return this.jobState;
  }

  getBackfillStatus(): OhlcBackfillJobState {
    return this.jobState;
  }

  async backfillSingleSymbol(symbol: string, request?: OhlcBackfillRequest): Promise<OhlcBackfillSymbolReport> {
    const normalizedSymbol = this.normalizeSymbol(symbol);
    if (!normalizedSymbol) {
      throw new BadRequestException('A valid symbol is required.');
    }

    const options = this.normalizeOptions(request);
    const session = await this.createSharesansarSession();
    const companyId = session.companyDirectory.get(normalizedSymbol);

    if (!companyId) {
      throw new BadRequestException(`Unable to locate company id for symbol ${normalizedSymbol}.`);
    }

    return this.backfillSymbolWithSession(normalizedSymbol, companyId, session, options.sinceDays);
  }

  private async runBackfillJob(jobId: string, options: NormalizedBackfillOptions): Promise<void> {
    try {
      const session = await this.createSharesansarSession();
      const universe = await this.resolveUniverseSymbols(options.symbolsLimit, session.companyDirectory);

      if (this.jobState.jobId !== jobId) {
        return;
      }

      this.jobState.progress.totalSymbols = universe.length;

      for (const symbol of universe) {
        if (this.jobState.jobId !== jobId) {
          return;
        }

        this.jobState.progress.currentSymbol = symbol;
        const companyId = session.companyDirectory.get(symbol);

        if (!companyId) {
          this.pushRecentReport({
            symbol,
            companyId: -1,
            fetchedRows: 0,
            insertedCandles: 0,
            newestDate: null,
            oldestDate: null,
            error: 'Company id not found in directory.',
          });
          this.jobState.progress.processedSymbols += 1;
          continue;
        }

        let report: OhlcBackfillSymbolReport;
        try {
          report = await this.backfillSymbolWithSession(symbol, companyId, session, options.sinceDays);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          report = {
            symbol,
            companyId,
            fetchedRows: 0,
            insertedCandles: 0,
            newestDate: null,
            oldestDate: null,
            error: message,
          };
        }

        this.jobState.progress.totalFetchedRows += report.fetchedRows;
        this.jobState.progress.totalInsertedCandles += report.insertedCandles;
        this.jobState.progress.processedSymbols += 1;
        this.pushRecentReport(report);

        if (options.throttleMs > 0) {
          await this.sleep(options.throttleMs);
        }
      }

      this.jobState.status = 'COMPLETED';
      this.jobState.finishedAt = new Date().toISOString();
      this.jobState.progress.currentSymbol = null;
      this.jobState.error = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`OHLC backfill job failed: ${message}`);
      this.jobState.status = 'FAILED';
      this.jobState.finishedAt = new Date().toISOString();
      this.jobState.progress.currentSymbol = null;
      this.jobState.error = message;
    }
  }

  private async resolveUniverseSymbols(
    symbolsLimit: number,
    directory: Map<string, number>,
  ): Promise<string[]> {
    const symbolsFromPriceTable: string[] = [];

    try {
      const rows = await this.prisma.price.findMany({
        where: {
          ltp: {
            gt: 0,
          },
        },
        orderBy: [{ turnover: 'desc' }, { volume: 'desc' }, { symbol: 'asc' }],
        take: Math.max(symbolsLimit * 2, symbolsLimit),
        select: {
          symbol: true,
        },
      });

      for (const row of rows) {
        const normalized = this.normalizeSymbol(row.symbol);
        if (!normalized) continue;
        if (!directory.has(normalized)) continue;
        symbolsFromPriceTable.push(normalized);
      }
    } catch (error) {
      if (!this.isMissingTableError(error)) {
        this.logger.warn('Failed to fetch live symbol universe from price table, using directory fallback.');
      }
    }

    const deduped = Array.from(new Set(symbolsFromPriceTable));
    if (deduped.length) {
      return deduped.slice(0, symbolsLimit);
    }

    return Array.from(directory.keys()).slice(0, symbolsLimit);
  }

  private async createSharesansarSession(): Promise<SharesansarSession> {
    const response = await axios.get<string>(SHARESANSAR_COMPANY_LIST_URL, {
      timeout: 25_000,
      responseType: 'text',
      headers: SCRAPE_HTTP_HEADERS,
    });

    const html = response.data;
    const csrfToken = this.extractCsrfToken(html);
    const cookieHeader = this.extractCookieHeader(response.headers['set-cookie']);
    const companyDirectory = this.extractCompanyDirectory(html);

    if (!csrfToken) {
      throw new Error('Unable to extract CSRF token from Sharesansar company list page.');
    }

    if (!cookieHeader) {
      throw new Error('Unable to extract session cookies from Sharesansar response.');
    }

    if (!companyDirectory.size) {
      throw new Error('Unable to parse company directory from Sharesansar payload.');
    }

    return {
      csrfToken,
      cookieHeader,
      companyDirectory,
    };
  }

  private async backfillSymbolWithSession(
    symbol: string,
    companyId: number,
    session: SharesansarSession,
    sinceDays: number | null,
  ): Promise<OhlcBackfillSymbolReport> {
    const sinceDate =
      sinceDays !== null
        ? new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000)
        : null;

    let start = 0;
    let draw = 1;
    let fetchedRows = 0;
    let shouldStop = false;

    const candles: CandleInsertRow[] = [];
    let newestDate: string | null = null;
    let oldestDate: string | null = null;

    while (!shouldStop) {
      const page = await this.fetchHistoryPage(session, companyId, start, draw);
      const rows = page.rows;

      if (!rows.length) {
        break;
      }

      fetchedRows += rows.length;

      let encounteredOlderRows = false;

      for (const row of rows) {
        const parsed = this.normalizeHistoryRow(row);
        if (!parsed) continue;

        if (sinceDate && parsed.t.getTime() < sinceDate.getTime()) {
          encounteredOlderRows = true;
          continue;
        }

        if (!newestDate) {
          newestDate = parsed.dateText;
        }
        oldestDate = parsed.dateText;

        candles.push({
          symbol,
          t: parsed.t,
          o: parsed.o,
          h: parsed.h,
          l: parsed.l,
          c: parsed.c,
          v: parsed.v,
        });
      }

      start += rows.length;
      draw += 1;

      if (encounteredOlderRows) {
        shouldStop = true;
      }

      if (start >= page.recordsTotal) {
        shouldStop = true;
      }
    }

    const insertedCandles = await this.persistCandles(candles);

    return {
      symbol,
      companyId,
      fetchedRows,
      insertedCandles,
      newestDate,
      oldestDate,
      error: null,
    };
  }

  private async fetchHistoryPage(
    session: SharesansarSession,
    companyId: number,
    start: number,
    draw: number,
  ): Promise<{ rows: SharesansarHistoryRow[]; recordsTotal: number }> {
    const body = new URLSearchParams({
      company: String(companyId),
      draw: String(draw),
      start: String(start),
      length: String(HISTORY_PAGE_SIZE),
    });

    const requestConfig: AxiosRequestConfig = {
      timeout: 25_000,
      headers: {
        ...SCRAPE_HTTP_HEADERS,
        'X-CSRF-Token': session.csrfToken,
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Referer: SHARESANSAR_COMPANY_LIST_URL,
        Cookie: session.cookieHeader,
        Accept: 'application/json,text/javascript,*/*;q=0.01',
      },
    };

    let lastError: unknown = null;

    for (let attempt = 1; attempt <= HISTORY_FETCH_RETRY_COUNT; attempt += 1) {
      try {
        const response = await axios.post<unknown>(
          SHARESANSAR_COMPANY_PRICE_HISTORY_URL,
          body.toString(),
          requestConfig,
        );

        return this.parseHistoryResponse(response.data);
      } catch (error) {
        lastError = error;
        if (attempt < HISTORY_FETCH_RETRY_COUNT) {
          await this.sleep(250 * attempt);
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Failed to fetch company history page.');
  }

  private parseHistoryResponse(data: unknown): { rows: SharesansarHistoryRow[]; recordsTotal: number } {
    let parsed: SharesansarHistoryResponse | null = null;

    if (typeof data === 'string') {
      try {
        parsed = JSON.parse(data) as SharesansarHistoryResponse;
      } catch {
        throw new Error('Company history response is not valid JSON.');
      }
    } else if (typeof data === 'object' && data !== null) {
      parsed = data as SharesansarHistoryResponse;
    }

    if (!parsed) {
      throw new Error('Company history endpoint returned an empty payload.');
    }

    const rows = Array.isArray(parsed.data) ? (parsed.data as SharesansarHistoryRow[]) : [];
    const recordsTotal = this.toSafeInt(parsed.recordsTotal, rows.length);

    return {
      rows,
      recordsTotal,
    };
  }

  private normalizeHistoryRow(row: SharesansarHistoryRow): NormalizedHistoryRow | null {
    const dateText = this.toText(row.published_date);
    if (!dateText || !/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
      return null;
    }

    const o = this.toNumber(row.open);
    const h = this.toNumber(row.high);
    const l = this.toNumber(row.low);
    const c = this.toNumber(row.close);

    if (o === null || h === null || l === null || c === null) {
      return null;
    }

    if (o <= 0 || h <= 0 || l <= 0 || c <= 0) {
      return null;
    }

    const volumeRaw = this.toNumber(row.traded_quantity);
    const volume = volumeRaw && volumeRaw > 0 ? BigInt(Math.round(volumeRaw)) : null;

    return {
      t: new Date(`${dateText}T00:00:00.000Z`),
      o: this.round4(o),
      h: this.round4(h),
      l: this.round4(l),
      c: this.round4(c),
      v: volume,
      dateText,
    };
  }

  private async persistCandles(candles: CandleInsertRow[]): Promise<number> {
    if (!candles.length) {
      return 0;
    }

    const chunkSize = 500;
    let inserted = 0;

    for (let i = 0; i < candles.length; i += chunkSize) {
      const chunk = candles.slice(i, i + chunkSize);
      const result = await this.prisma.priceCandle.createMany({
        data: chunk,
        skipDuplicates: true,
      });
      inserted += result.count;
    }

    return inserted;
  }

  private normalizeOptions(request?: OhlcBackfillRequest): NormalizedBackfillOptions {
    const symbolsLimit = this.toBoundedInt(
      request?.symbolsLimit,
      DEFAULT_SYMBOLS_LIMIT,
      MIN_SYMBOLS_LIMIT,
      MAX_SYMBOLS_LIMIT,
    );

    const throttleMs = this.toBoundedInt(
      request?.throttleMs,
      DEFAULT_THROTTLE_MS,
      MIN_THROTTLE_MS,
      MAX_THROTTLE_MS,
    );

    let sinceDays: number | null = null;
    if (request?.sinceDays !== undefined && request?.sinceDays !== null) {
      const parsed = Number(request.sinceDays);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new BadRequestException('sinceDays must be a positive number.');
      }

      sinceDays = Math.floor(parsed);
    }

    return {
      symbolsLimit,
      sinceDays,
      throttleMs,
    };
  }

  private extractCsrfToken(html: string): string {
    return html.match(/meta\s+name="_token"\s+content="([^"]+)"/i)?.[1] ?? '';
  }

  private extractCookieHeader(setCookieHeader: unknown): string {
    if (!Array.isArray(setCookieHeader)) {
      return '';
    }

    return setCookieHeader
      .filter((cookie): cookie is string => typeof cookie === 'string' && cookie.length > 0)
      .map((cookie) => cookie.split(';')[0])
      .join('; ');
  }

  private extractCompanyDirectory(html: string): Map<string, number> {
    const directory = new Map<string, number>();
    const jsonMatch = html.match(/var\s+cmpjson\s*=\s*(\[[\s\S]*?\]);/i)?.[1];
    if (!jsonMatch) {
      return directory;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonMatch);
    } catch {
      return directory;
    }

    if (!Array.isArray(parsed)) {
      return directory;
    }

    for (const row of parsed) {
      if (!row || typeof row !== 'object') {
        continue;
      }

      const item = row as SharesansarCompanyDirectoryRow;
      const symbol = this.normalizeSymbol(item.symbol);
      const id = this.toSafeInt(item.id, -1);

      if (!symbol || id <= 0) {
        continue;
      }

      directory.set(symbol, id);
    }

    return directory;
  }

  private pushRecentReport(report: OhlcBackfillSymbolReport): void {
    this.jobState.recentReports.unshift(report);
    if (this.jobState.recentReports.length > MAX_RECENT_REPORTS) {
      this.jobState.recentReports = this.jobState.recentReports.slice(0, MAX_RECENT_REPORTS);
    }
  }

  private normalizeSymbol(value: unknown): string | null {
    const text = this.toText(value);
    if (!text) return null;

    const normalized = text.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (!normalized) return null;

    if (!/^[A-Z][A-Z0-9]{1,19}$/.test(normalized)) {
      return null;
    }

    return normalized;
  }

  private toText(value: unknown): string | null {
    if (typeof value !== 'string') {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
      }

      return null;
    }

    const cleaned = value.replace(/\s+/g, ' ').trim();
    return cleaned || null;
  }

  private toNumber(value: unknown): number | null {
    if (value === null || value === undefined) return null;

    const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : null;
    if (!raw) return null;

    const negative = raw.includes('(') && raw.includes(')');
    const cleaned = raw
      .replace(/,/g, '')
      .replace(/[()]/g, '')
      .replace(/rs\.?/gi, '')
      .replace(/\s+/g, '')
      .trim();

    if (!cleaned) return null;

    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed)) return null;

    return negative ? -Math.abs(parsed) : parsed;
  }

  private toSafeInt(value: unknown, fallback: number): number {
    const numeric = this.toNumber(value);
    if (numeric === null) return fallback;
    if (!Number.isFinite(numeric)) return fallback;
    return Math.floor(numeric);
  }

  private toBoundedInt(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }

    return Math.max(min, Math.min(max, Math.floor(parsed)));
  }

  private round4(value: number): number {
    return Number(value.toFixed(4));
  }

  private isMissingTableError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2021'
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
