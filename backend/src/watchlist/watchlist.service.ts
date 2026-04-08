import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface WatchlistRow {
  symbol: string;
  company: string | null;
  sector: string | null;
  ltp: number;
  change: number | null;
  change_pct: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  turnover: number | null;
}

@Injectable()
export class WatchlistService {
  constructor(private readonly prisma: PrismaService) {}

  async getWatchlist(): Promise<WatchlistRow[]> {
    const rows = await this.prisma.price.findMany({ orderBy: { symbol: 'asc' } });

    return rows.map((row) => ({
      symbol: row.symbol,
      company: row.company,
      sector: row.sector,
      ltp: this.toNumber(row.ltp) ?? 0,
      change: this.toNumber(row.change),
      change_pct: this.toNumber(row.changePct),
      open: this.toNumber(row.open),
      high: this.toNumber(row.high),
      low: this.toNumber(row.low),
      volume: row.volume === null ? null : Number(row.volume),
      turnover: this.toNumber(row.turnover),
    }));
  }

  private toNumber(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const parsed = Number(String(value));
    return Number.isFinite(parsed) ? parsed : null;
  }
}
