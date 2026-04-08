import { Injectable, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(IndicesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getIndices(): Promise<IndexRow[]> {
    let rows;
    try {
      rows = await this.prisma.indexValue.findMany({ orderBy: { indexName: 'asc' } });
    } catch (error) {
      if (this.isMissingTableError(error)) {
        this.logger.warn('IndexValue table missing. Returning empty indices until bootstrap completes.');
        return [];
      }

      throw error;
    }

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

  private isMissingTableError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2021'
    );
  }
}
