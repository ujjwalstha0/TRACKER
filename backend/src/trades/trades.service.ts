import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FeesService } from '../fees/fees.service';
import { CreateTradeDto } from './dto/create-trade.dto';
import { TradeEntity } from './trade.entity';

@Injectable()
export class TradesService {
  constructor(
    @InjectRepository(TradeEntity)
    private readonly tradesRepository: Repository<TradeEntity>,
    private readonly feesService: FeesService,
  ) {}

  async create(userId: number, dto: CreateTradeDto): Promise<TradeEntity> {
    const holdingDays = dto.purchasedAt && dto.soldAt
      ? this.computeHoldingDays(dto.purchasedAt, dto.soldAt)
      : null;

    const fee = this.feesService.calculate({
      symbol: dto.symbol,
      side: dto.isBuy ? 'buy' : 'sell',
      instrumentType: dto.instrumentType,
      entityType: dto.entityType,
      listingType: dto.listingType,
      price: dto.price,
      quantity: dto.qty,
      holdingDays: holdingDays ?? undefined,
      buyPricePerShare: dto.buyPricePerShare,
    });

    const netCostOrProceeds = dto.isBuy ? fee.totalBuyInCost : fee.netSellProceeds;

    const trade = this.tradesRepository.create({
      userId,
      symbol: dto.symbol.toUpperCase(),
      isBuy: dto.isBuy,
      price: dto.price,
      qty: dto.qty,
      broker: dto.broker,
      totalValue: fee.grossValue,
      brokerFee: fee.brokerCommission,
      sebonFee: fee.sebonTransactionFee,
      dpFee: fee.dpCharge,
      cgtRate: fee.cgtRate,
      cgtAmount: fee.cgtAmount,
      netCostOrProceeds,
      purchasedAt: dto.purchasedAt ?? null,
      soldAt: dto.soldAt ?? null,
      holdingDays,
      sector: dto.sector ?? null,
      notes: dto.notes ?? null,
    });

    return this.tradesRepository.save(trade);
  }

  findAll(userId: number, isBuy?: boolean): Promise<TradeEntity[]> {
    const where = typeof isBuy === 'boolean' ? { userId, isBuy } : { userId };

    return this.tradesRepository.find({
      where,
      order: { id: 'DESC' },
    });
  }

  async findOne(userId: number, id: number): Promise<TradeEntity> {
    const trade = await this.tradesRepository.findOne({ where: { id, userId } });
    if (!trade) {
      throw new NotFoundException('Trade not found');
    }
    return trade;
  }

  async remove(userId: number, id: number): Promise<void> {
    await this.findOne(userId, id);
    await this.tradesRepository.delete({ id, userId });
  }

  private computeHoldingDays(purchasedAt: string, soldAt: string): number {
    const start = new Date(purchasedAt);
    const end = new Date(soldAt);
    const ms = end.getTime() - start.getTime();
    return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
  }
}
