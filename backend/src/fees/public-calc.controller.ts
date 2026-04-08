import { Body, Controller, Post } from '@nestjs/common';
import { EntityType, InstrumentType } from '../config/nepse.config';
import { FeesService } from './fees.service';
import { FeeCalculationInput } from './fees.types';

interface PublicCalculatePayload {
  isBuy: boolean;
  price: number;
  qty: number;
  instrumentType?: InstrumentType;
  buyPrice?: number | null;
  holdingDays?: number | null;
  traderType?: EntityType;
}

interface PublicBreakdownRow {
  charge: string;
  rate: number | null;
  amount: number;
}

interface PublicCalculateResponse {
  isBuy: boolean;
  transactionValue: number;
  totalAmountToPay: number | null;
  netProceeds: number | null;
  totalCharges: number;
  totalDeductions: number;
  breakdown: PublicBreakdownRow[];
}

@Controller()
export class PublicCalcController {
  constructor(private readonly feesService: FeesService) {}

  @Post('calculate-nepse-cost')
  calculateNepseCost(@Body() payload: PublicCalculatePayload): PublicCalculateResponse {
    const safeInstrument: InstrumentType = this.resolveInstrumentType(payload.instrumentType);
    const safeTraderType: EntityType = payload.traderType === 'entity' ? 'entity' : 'individual';

    const input: FeeCalculationInput = {
      symbol: 'NEPSE',
      side: payload.isBuy ? 'buy' : 'sell',
      instrumentType: safeInstrument,
      entityType: safeTraderType,
      listingType: 'listed',
      price: payload.price,
      quantity: payload.qty,
      holdingDays: payload.isBuy ? undefined : (payload.holdingDays ?? undefined),
      buyPricePerShare: payload.isBuy ? undefined : (payload.buyPrice ?? undefined),
    };

    const breakdown = this.feesService.calculate(input);
    const brokerRate = breakdown.grossValue > 0 ? breakdown.brokerCommission / breakdown.grossValue : 0;
    const sebonRate = breakdown.grossValue > 0 ? breakdown.sebonTransactionFee / breakdown.grossValue : 0;

    const rows: PublicBreakdownRow[] = [
      { charge: 'Transaction Value', rate: null, amount: breakdown.grossValue },
      { charge: 'Broker Commission (total)', rate: brokerRate, amount: breakdown.brokerCommission },
      { charge: 'SEBON Transaction Fee', rate: sebonRate, amount: breakdown.sebonTransactionFee },
      { charge: 'DP Transfer Charge', rate: null, amount: breakdown.dpCharge },
    ];

    if (!payload.isBuy) {
      rows.push({ charge: 'CGT', rate: breakdown.cgtRate, amount: breakdown.cgtAmount });
    }

    rows.push({
      charge: payload.isBuy ? 'Total Amount to Pay' : 'Net Proceeds',
      rate: null,
      amount: payload.isBuy ? breakdown.totalBuyInCost : breakdown.netSellProceeds,
    });

    const totalDeductions = payload.isBuy
      ? breakdown.totalFeesExcludingCgt
      : breakdown.totalFeesExcludingCgt + breakdown.cgtAmount;

    return {
      isBuy: payload.isBuy,
      transactionValue: breakdown.grossValue,
      totalAmountToPay: payload.isBuy ? breakdown.totalBuyInCost : null,
      netProceeds: payload.isBuy ? null : breakdown.netSellProceeds,
      totalCharges: breakdown.totalFeesExcludingCgt,
      totalDeductions,
      breakdown: rows,
    };
  }

  private resolveInstrumentType(value: InstrumentType | undefined): InstrumentType {
    if (value === 'debenture' || value === 'other') return value;
    return 'equity';
  }
}
