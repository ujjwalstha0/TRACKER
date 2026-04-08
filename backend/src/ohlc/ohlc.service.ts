import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OhlcCandleDto, OhlcInterval, OhlcQuery } from './ohlc.types';

const ALLOWED_INTERVALS: ReadonlySet<OhlcInterval> = new Set(['1m', '5m', '15m', '1h', '1d']);
const DEFAULT_INTERVAL: OhlcInterval = '1d';
const DEFAULT_LIMIT = 240;
const MAX_LIMIT = 1000;
const RAW_SCAN_LIMIT = 20000;

interface AggregateCandle {
  t: Date;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number | null;
}

@Injectable()
export class OhlcService {
  private readonly logger = new Logger(OhlcService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getCandles(query: OhlcQuery): Promise<OhlcCandleDto[]> {
    const symbol = query.symbol?.trim().toUpperCase();
    if (!symbol) {
      throw new BadRequestException('Query param "symbol" is required.');
    }

    const interval = this.normalizeInterval(query.interval);
    const limit = this.normalizeLimit(query.limit);

    let rows;
    try {
      rows = await this.prisma.priceCandle.findMany({
        where: { symbol },
        orderBy: { t: 'desc' },
        take: RAW_SCAN_LIMIT,
      });
    } catch (error) {
      if (this.isMissingTableError(error)) {
        this.logger.warn('prices table missing. Returning empty OHLC payload until bootstrap completes.');
        return [];
      }

      throw error;
    }

    const sortedRows = rows.reverse();
    const aggregated = this.aggregateByInterval(sortedRows, interval);
    const trimmed = aggregated.slice(Math.max(0, aggregated.length - limit));

    return trimmed.map((row) => ({
      t: row.t.toISOString(),
      o: row.o,
      h: row.h,
      l: row.l,
      c: row.c,
      v: row.v,
    }));
  }

  private aggregateByInterval(
    rows: Array<{ t: Date; o: unknown; h: unknown; l: unknown; c: unknown; v: bigint | null }>,
    interval: OhlcInterval,
  ): AggregateCandle[] {
    const buckets = new Map<string, AggregateCandle>();

    for (const row of rows) {
      const bucketTime = this.floorToInterval(row.t, interval);
      const key = bucketTime.toISOString();

      const open = this.toNumber(row.o);
      const high = this.toNumber(row.h);
      const low = this.toNumber(row.l);
      const close = this.toNumber(row.c);
      const volume = row.v === null ? null : Number(row.v);

      const existing = buckets.get(key);
      if (!existing) {
        buckets.set(key, {
          t: bucketTime,
          o: open,
          h: high,
          l: low,
          c: close,
          v: volume,
        });
        continue;
      }

      existing.h = Math.max(existing.h, high);
      existing.l = Math.min(existing.l, low);
      existing.c = close;

      if (volume !== null) {
        existing.v = (existing.v ?? 0) + volume;
      }
    }

    return [...buckets.values()].sort((a, b) => a.t.getTime() - b.t.getTime());
  }

  private floorToInterval(date: Date, interval: OhlcInterval): Date {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    const day = date.getUTCDate();
    const hour = date.getUTCHours();
    const minute = date.getUTCMinutes();

    if (interval === '1d') {
      return new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
    }

    if (interval === '1h') {
      return new Date(Date.UTC(year, month, day, hour, 0, 0, 0));
    }

    if (interval === '15m') {
      const bucketMinute = Math.floor(minute / 15) * 15;
      return new Date(Date.UTC(year, month, day, hour, bucketMinute, 0, 0));
    }

    if (interval === '5m') {
      const bucketMinute = Math.floor(minute / 5) * 5;
      return new Date(Date.UTC(year, month, day, hour, bucketMinute, 0, 0));
    }

    return new Date(Date.UTC(year, month, day, hour, minute, 0, 0));
  }

  private normalizeInterval(value?: string): OhlcInterval {
    const normalized = (value ?? DEFAULT_INTERVAL).trim().toLowerCase() as OhlcInterval;
    if (!ALLOWED_INTERVALS.has(normalized)) {
      throw new BadRequestException('Invalid interval. Allowed: 1m, 5m, 15m, 1h, 1d.');
    }

    return normalized;
  }

  private normalizeLimit(value?: number): number {
    const parsed = Number(value ?? DEFAULT_LIMIT);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new BadRequestException('Invalid limit. It must be a positive number.');
    }

    return Math.min(Math.floor(parsed), MAX_LIMIT);
  }

  private toNumber(value: unknown): number {
    return Number(String(value));
  }

  private isMissingTableError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2021'
    );
  }
}
