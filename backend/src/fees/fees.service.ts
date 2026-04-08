import { Injectable } from '@nestjs/common';
import { nepseConfig } from '../config/nepse.config';
import { FeeBreakdown, FeeCalculationInput } from './fees.types';

@Injectable()
export class FeesService {
  calculate(input: FeeCalculationInput): FeeBreakdown {
    const grossValue = this.round2(input.price * input.quantity);
    const brokerRate = this.resolveBrokerRate(grossValue);
    const brokerCommission = this.round2(grossValue * brokerRate);

    const commissionSplit = {
      broker: this.round2(brokerCommission * nepseConfig.commissionSplit.broker),
      nepse: this.round2(brokerCommission * nepseConfig.commissionSplit.nepse),
      sebonInside: this.round2(brokerCommission * nepseConfig.commissionSplit.sebon),
    };

    const sebonTransactionFee = this.round2(grossValue * nepseConfig.sebonFee[input.instrumentType]);
    const dpCharge = input.side === 'sell' ? nepseConfig.dpCharge : 0;

    const cgtRate = input.side === 'sell' ? this.resolveCgtRate(input) : 0;
    const realizedProfit = input.side === 'sell' && input.buyPricePerShare
      ? this.round2((input.price - input.buyPricePerShare) * input.quantity)
      : 0;
    const taxableProfit = Math.max(0, realizedProfit);
    const cgtAmount = this.round2(taxableProfit * cgtRate);

    const totalFeesExcludingCgt = this.round2(brokerCommission + sebonTransactionFee + dpCharge);

    const totalBuyInCost = this.round2(
      input.side === 'buy' ? grossValue + totalFeesExcludingCgt : 0,
    );

    const netSellProceeds = this.round2(
      input.side === 'sell' ? grossValue - totalFeesExcludingCgt - cgtAmount : 0,
    );

    return {
      grossValue,
      brokerCommission,
      commissionSplit,
      sebonTransactionFee,
      dpCharge,
      cgtRate,
      cgtAmount,
      totalFeesExcludingCgt,
      totalBuyInCost,
      netSellProceeds,
    };
  }

  private resolveBrokerRate(tradeValue: number): number {
    for (const slab of nepseConfig.brokerSlabs) {
      if (slab.max === null || tradeValue <= slab.max) {
        return slab.rate;
      }
    }
    return nepseConfig.brokerSlabs[nepseConfig.brokerSlabs.length - 1].rate;
  }

  private resolveCgtRate(input: FeeCalculationInput): number {
    if (input.entityType === 'entity') {
      return nepseConfig.cgt.entity;
    }

    if (input.listingType === 'unlisted') {
      return nepseConfig.cgt.unlistedIndividual;
    }

    if ((input.holdingDays ?? 0) > 365) {
      return nepseConfig.cgt.listedLongTerm;
    }

    return nepseConfig.cgt.listedShortTerm;
  }

  private round2(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}
