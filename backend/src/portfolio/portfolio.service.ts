import { Injectable, NotFoundException } from '@nestjs/common';
import { FeesService } from '../fees/fees.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateHoldingDto } from './dto/create-holding.dto';
import { UpdateHoldingDto } from './dto/update-holding.dto';

interface HoldingResponse {
  id: number;
  symbol: string;
  company: string | null;
  sector: string | null;
  qty: number;
  buyPrice: number;
  targetPrice: number | null;
  stopLoss: number | null;
  notes: string | null;
  currentPrice: number | null;
  currentChangePct: number | null;
  currentValue: number | null;
  netIfSellNow: number | null;
  pnlNow: number | null;
  netIfTargetHit: number | null;
  pnlIfTargetHit: number | null;
  netIfStopLossHit: number | null;
  pnlIfStopLossHit: number | null;
  createdAt: string;
  updatedAt: string;
}

interface PortfolioSummary {
  holdingsCount: number;
  investedCost: number;
  currentValue: number;
  netIfSellNow: number;
  unrealizedPnl: number;
}

interface HoldingModelRow {
  id: bigint;
  symbol: string;
  buyPrice: unknown;
  qty: number;
  targetPrice: unknown;
  stopLoss: unknown;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface PriceSnapshotRow {
  symbol: string;
  company: string | null;
  sector: string | null;
  ltp: unknown;
  changePct: unknown;
}

@Injectable()
export class PortfolioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly feesService: FeesService,
  ) {}

  async findAll(userId: number): Promise<{ summary: PortfolioSummary; holdings: HoldingResponse[] }> {
    const rows = (await this.prisma.holding.findMany({
      where: { userId: BigInt(userId) },
      orderBy: { createdAt: 'desc' },
    })) as HoldingModelRow[];

    const symbols = [...new Set(rows.map((row) => row.symbol))];
    const prices = (symbols.length
      ? await this.prisma.price.findMany({
          where: { symbol: { in: symbols } },
        })
      : []) as PriceSnapshotRow[];

    const priceMap = new Map<string, PriceSnapshotRow>(prices.map((row) => [row.symbol, row]));

    const holdings: HoldingResponse[] = rows.map((row) => this.toHoldingResponse(row, priceMap.get(row.symbol)));

    const summaryInitial: PortfolioSummary = {
      holdingsCount: 0,
      investedCost: 0,
      currentValue: 0,
      netIfSellNow: 0,
      unrealizedPnl: 0,
    };

    const summary = holdings.reduce(
      (acc, row) => {
        const investedCost = this.buyInCost(row.buyPrice, row.qty);
        const currentValue = row.currentPrice === null ? 0 : row.currentPrice * row.qty;
        const netNow = row.netIfSellNow ?? 0;

        acc.holdingsCount += 1;
        acc.investedCost += investedCost;
        acc.currentValue += currentValue;
        acc.netIfSellNow += netNow;
        acc.unrealizedPnl += netNow - investedCost;
        return acc;
      },
      summaryInitial,
    );

    return {
      summary: {
        holdingsCount: summary.holdingsCount,
        investedCost: this.round(summary.investedCost),
        currentValue: this.round(summary.currentValue),
        netIfSellNow: this.round(summary.netIfSellNow),
        unrealizedPnl: this.round(summary.unrealizedPnl),
      },
      holdings,
    };
  }

  async create(userId: number, dto: CreateHoldingDto): Promise<HoldingResponse> {
    const created = await this.prisma.holding.create({
      data: {
        userId: BigInt(userId),
        symbol: dto.symbol.trim().toUpperCase(),
        buyPrice: dto.buyPrice,
        qty: Math.floor(dto.qty),
        targetPrice: dto.targetPrice ?? null,
        stopLoss: dto.stopLoss ?? null,
        notes: dto.notes?.trim() || null,
      },
    });

    const market = await this.prisma.price.findUnique({ where: { symbol: created.symbol } });
    return this.toHoldingResponse(created, market ?? undefined);
  }

  async update(userId: number, id: number, dto: UpdateHoldingDto): Promise<HoldingResponse> {
    const holding = await this.prisma.holding.findUnique({ where: { id: BigInt(id) } });
    if (!holding || Number(holding.userId) !== userId) {
      throw new NotFoundException('Holding not found.');
    }

    const updated = await this.prisma.holding.update({
      where: { id: BigInt(id) },
      data: {
        buyPrice: dto.buyPrice ?? undefined,
        qty: dto.qty ? Math.floor(dto.qty) : undefined,
        targetPrice: dto.targetPrice ?? undefined,
        stopLoss: dto.stopLoss ?? undefined,
        notes: dto.notes !== undefined ? dto.notes.trim() || null : undefined,
      },
    });

    const market = await this.prisma.price.findUnique({ where: { symbol: updated.symbol } });
    return this.toHoldingResponse(updated, market ?? undefined);
  }

  async remove(userId: number, id: number): Promise<void> {
    const holding = await this.prisma.holding.findUnique({ where: { id: BigInt(id) } });
    if (!holding || Number(holding.userId) !== userId) {
      throw new NotFoundException('Holding not found.');
    }

    await this.prisma.holding.delete({ where: { id: BigInt(id) } });
  }

  private toHoldingResponse(
    holding: {
      id: bigint;
      symbol: string;
      buyPrice: unknown;
      qty: number;
      targetPrice: unknown;
      stopLoss: unknown;
      notes: string | null;
      createdAt: Date;
      updatedAt: Date;
    },
    market:
      | {
          symbol: string;
          company: string | null;
          sector: string | null;
          ltp: unknown;
          changePct: unknown;
        }
      | undefined,
  ): HoldingResponse {
    const buyPrice = this.toNumber(holding.buyPrice) ?? 0;
    const qty = holding.qty;
    const currentPrice = market ? this.toNumber(market.ltp) : null;
    const targetPrice = this.toNumber(holding.targetPrice);
    const stopLoss = this.toNumber(holding.stopLoss);
    const investedCost = this.buyInCost(buyPrice, qty);

    const netIfSellNow = currentPrice === null ? null : this.netProceeds(currentPrice, qty, buyPrice, holding.createdAt);
    const pnlNow = netIfSellNow === null ? null : netIfSellNow - investedCost;

    const netIfTargetHit = targetPrice === null ? null : this.netProceeds(targetPrice, qty, buyPrice, holding.createdAt);
    const pnlIfTargetHit = netIfTargetHit === null ? null : netIfTargetHit - investedCost;

    const netIfStopLossHit = stopLoss === null ? null : this.netProceeds(stopLoss, qty, buyPrice, holding.createdAt);
    const pnlIfStopLossHit = netIfStopLossHit === null ? null : netIfStopLossHit - investedCost;

    return {
      id: Number(holding.id),
      symbol: holding.symbol,
      company: market?.company ?? null,
      sector: market?.sector ?? null,
      qty,
      buyPrice,
      targetPrice,
      stopLoss,
      notes: holding.notes,
      currentPrice,
      currentChangePct: market ? this.toNumber(market.changePct) : null,
      currentValue: currentPrice === null ? null : this.round(currentPrice * qty),
      netIfSellNow: netIfSellNow === null ? null : this.round(netIfSellNow),
      pnlNow: pnlNow === null ? null : this.round(pnlNow),
      netIfTargetHit: netIfTargetHit === null ? null : this.round(netIfTargetHit),
      pnlIfTargetHit: pnlIfTargetHit === null ? null : this.round(pnlIfTargetHit),
      netIfStopLossHit: netIfStopLossHit === null ? null : this.round(netIfStopLossHit),
      pnlIfStopLossHit: pnlIfStopLossHit === null ? null : this.round(pnlIfStopLossHit),
      createdAt: holding.createdAt.toISOString(),
      updatedAt: holding.updatedAt.toISOString(),
    };
  }

  private buyInCost(price: number, qty: number): number {
    const breakdown = this.feesService.calculate({
      symbol: 'NEPSE',
      side: 'buy',
      instrumentType: 'equity',
      entityType: 'individual',
      listingType: 'listed',
      price,
      quantity: qty,
    });

    return breakdown.totalBuyInCost;
  }

  private netProceeds(price: number, qty: number, buyPrice: number, createdAt: Date): number {
    const holdingDays = Math.max(
      0,
      Math.floor((Date.now() - createdAt.getTime()) / (24 * 60 * 60 * 1000)),
    );

    const breakdown = this.feesService.calculate({
      symbol: 'NEPSE',
      side: 'sell',
      instrumentType: 'equity',
      entityType: 'individual',
      listingType: 'listed',
      price,
      quantity: qty,
      buyPricePerShare: buyPrice,
      holdingDays,
    });

    return breakdown.netSellProceeds;
  }

  private toNumber(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const parsed = Number(String(value));
    return Number.isFinite(parsed) ? parsed : null;
  }

  private round(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}
