import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExecutionDecisionDto } from './dto/create-execution-decision.dto';
import { UpdateExecutionDecisionDto } from './dto/update-execution-decision.dto';
import { ExecutionDecisionEntryDto, ExecutionDecisionOutcome } from './execution-decisions.types';

interface ExecutionDecisionRow {
  id: bigint;
  userId: bigint;
  tradeDate: Date;
  side: string;
  symbol: string;
  reason: string;
  plan: string | null;
  confidence: number;
  outcome: string;
  reviewNote: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 300;
const NEPAL_TIME_ZONE = 'Asia/Kathmandu';

@Injectable()
export class ExecutionDecisionsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: number, tradeDate?: string, limit?: number): Promise<ExecutionDecisionEntryDto[]> {
    const where = {
      userId: BigInt(userId),
      tradeDate: tradeDate ? this.parseTradeDate(tradeDate) : undefined,
    };

    const rows = (await this.prisma.executionDecision.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: this.normalizeLimit(limit),
    })) as ExecutionDecisionRow[];

    return rows.map((row) => this.toDto(row));
  }

  async create(userId: number, dto: CreateExecutionDecisionDto): Promise<ExecutionDecisionEntryDto> {
    const created = (await this.prisma.executionDecision.create({
      data: {
        userId: BigInt(userId),
        tradeDate: dto.tradeDate ? this.parseTradeDate(dto.tradeDate) : this.getNepalTradeDate(),
        side: dto.side,
        symbol: dto.symbol.trim().toUpperCase(),
        reason: dto.reason.trim(),
        plan: dto.plan?.trim() || null,
        confidence: Math.floor(dto.confidence),
        outcome: 'PENDING',
        reviewNote: null,
        reviewedAt: null,
      },
    })) as ExecutionDecisionRow;

    return this.toDto(created);
  }

  async update(
    userId: number,
    id: number,
    dto: UpdateExecutionDecisionDto,
  ): Promise<ExecutionDecisionEntryDto> {
    const existing = (await this.prisma.executionDecision.findUnique({
      where: { id: BigInt(id) },
    })) as ExecutionDecisionRow | null;

    if (!existing || Number(existing.userId) !== userId) {
      throw new NotFoundException('Decision note not found.');
    }

    const nextOutcome = dto.outcome ?? this.normalizeOutcome(existing.outcome);
    const reviewedAt =
      dto.outcome === undefined
        ? existing.reviewedAt
        : nextOutcome === 'PENDING'
          ? null
          : new Date();

    const updated = (await this.prisma.executionDecision.update({
      where: { id: BigInt(id) },
      data: {
        tradeDate: dto.tradeDate ? this.parseTradeDate(dto.tradeDate) : undefined,
        side: dto.side,
        symbol: dto.symbol?.trim().toUpperCase(),
        reason: dto.reason?.trim(),
        plan: dto.plan !== undefined ? dto.plan.trim() || null : undefined,
        confidence: dto.confidence !== undefined ? Math.floor(dto.confidence) : undefined,
        outcome: nextOutcome,
        reviewNote: dto.reviewNote !== undefined ? dto.reviewNote.trim() || null : undefined,
        reviewedAt,
      },
    })) as ExecutionDecisionRow;

    return this.toDto(updated);
  }

  async remove(userId: number, id: number): Promise<void> {
    const existing = (await this.prisma.executionDecision.findUnique({
      where: { id: BigInt(id) },
    })) as ExecutionDecisionRow | null;

    if (!existing || Number(existing.userId) !== userId) {
      throw new NotFoundException('Decision note not found.');
    }

    await this.prisma.executionDecision.delete({ where: { id: BigInt(id) } });
  }

  private toDto(row: ExecutionDecisionRow): ExecutionDecisionEntryDto {
    return {
      id: Number(row.id),
      tradeDate: row.tradeDate.toISOString().slice(0, 10),
      side: row.side === 'SELL' ? 'SELL' : 'BUY',
      symbol: row.symbol,
      reason: row.reason,
      plan: row.plan,
      confidence: row.confidence,
      outcome: this.normalizeOutcome(row.outcome),
      reviewNote: row.reviewNote,
      reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private normalizeOutcome(value: string): ExecutionDecisionOutcome {
    if (
      value === 'PENDING' ||
      value === 'CORRECT' ||
      value === 'PARTIAL' ||
      value === 'WRONG' ||
      value === 'SKIPPED'
    ) {
      return value;
    }

    return 'PENDING';
  }

  private parseTradeDate(value: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException('tradeDate must be YYYY-MM-DD');
    }

    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('Invalid tradeDate value.');
    }

    return parsed;
  }

  private normalizeLimit(limit?: number): number {
    const parsed = Number(limit ?? DEFAULT_LIMIT);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_LIMIT;
    }

    return Math.min(Math.floor(parsed), MAX_LIMIT);
  }

  private getNepalTradeDate(now = new Date()): Date {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: NEPAL_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);

    const year = Number(parts.find((part) => part.type === 'year')?.value ?? now.getUTCFullYear());
    const month = Number(parts.find((part) => part.type === 'month')?.value ?? now.getUTCMonth() + 1);
    const day = Number(parts.find((part) => part.type === 'day')?.value ?? now.getUTCDate());

    return new Date(Date.UTC(year, month - 1, day));
  }
}
