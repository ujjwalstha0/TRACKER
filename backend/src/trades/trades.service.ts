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

  async create(dto: CreateTradeDto): Promise<TradeEntity> {
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

  findAll(isBuy?: boolean): Promise<TradeEntity[]> {
    return this.tradesRepository.find({
      where: typeof isBuy === 'boolean' ? { isBuy } : undefined,
      order: { id: 'DESC' },
    });
  }

  async findOne(id: number): Promise<TradeEntity> {
    const trade = await this.tradesRepository.findOne({ where: { id } });
    if (!trade) {
      throw new NotFoundException('Trade not found');
    }
    return trade;
  }

  async remove(id: number): Promise<void> {
    await this.findOne(id);
    await this.tradesRepository.delete({ id });
  }

  private computeHoldingDays(purchasedAt: string, soldAt: string): number {
    const start = new Date(purchasedAt);
    const end = new Date(soldAt);
    const ms = end.getTime() - start.getTime();
    return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
  }
}
