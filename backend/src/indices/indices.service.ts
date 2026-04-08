import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface IndexRow {
  indexName: string;
  value: number;
  change: number;
  change_pct: number;
  savedAt: Date;
}

@Injectable()
export class IndicesService {
  constructor(private readonly prisma: PrismaService) {}

  async getIndices(): Promise<IndexRow[]> {
    const rows = await this.prisma.indexValue.findMany({ orderBy: { indexName: 'asc' } });

    return rows.map((row) => ({
      indexName: row.indexName,
      value: this.toNumber(row.value),
      change: this.toNumber(row.change),
      change_pct: this.toNumber(row.changePct),
      savedAt: row.savedAt,
    }));
  }

  private toNumber(value: unknown): number {
    return Number(String(value));
  }
}
