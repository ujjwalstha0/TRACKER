import { EntityType, InstrumentType, ListingType } from '../config/nepse.config';

export type Side = 'buy' | 'sell';

export interface FeeCalculationInput {
  symbol: string;
  side: Side;
  instrumentType: InstrumentType;
  entityType: EntityType;
  listingType: ListingType;
  price: number;
  quantity: number;
  holdingDays?: number;
  buyPricePerShare?: number;
}

export interface FeeBreakdown {
  grossValue: number;
  brokerCommission: number;
  commissionSplit: {
    broker: number;
    nepse: number;
    sebonInside: number;
  };
  sebonTransactionFee: number;
  dpCharge: number;
  cgtRate: number;
  cgtAmount: number;
  totalFeesExcludingCgt: number;
  totalBuyInCost: number;
  netSellProceeds: number;
}
