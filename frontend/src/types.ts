export type InstrumentType = 'equity' | 'debenture' | 'other';
export type EntityType = 'individual' | 'entity';
export type ListingType = 'listed' | 'unlisted';

export interface FeeCalculationInput {
  symbol: string;
  side: 'buy' | 'sell';
  instrumentType: InstrumentType;
  entityType: EntityType;
  listingType: ListingType;
  price: number;
  quantity: number;
  holdingDays?: number;
  buyPricePerShare?: number;
}

export interface FeeCalculationResult {
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

export interface TradeRow {
  id: number;
  symbol: string;
  isBuy: boolean;
  price: number;
  qty: number;
  broker: string;
  totalValue: number;
  brokerFee: number;
  sebonFee: number;
  dpFee: number;
  cgtRate: number;
  cgtAmount: number;
  netCostOrProceeds: number;
  purchasedAt: string | null;
  soldAt: string | null;
  holdingDays: number | null;
  sector: string | null;
  notes: string | null;
}

export interface WatchlistItem {
  symbol: string;
  sector: string;
  buyPrice: number;
  currentPrice: number;
  quantity: number;
  listingType: ListingType;
  targetPrice: number;
  stopLoss: number;
  momentum: number;
  catalyst: string;
}

export interface NepseCostRequest {
  isBuy: boolean;
  price: number;
  qty: number;
  instrumentType: InstrumentType;
  buyPrice: number | null;
  holdingDays: number | null;
  traderType: EntityType;
}

export interface NepseCostBreakdownRow {
  charge: string;
  rate: number | null;
  amount: number;
}

export interface NepseCostResponse {
  isBuy: boolean;
  transactionValue: number;
  totalAmountToPay: number | null;
  netProceeds: number | null;
  totalCharges: number;
  totalDeductions: number;
  breakdown: NepseCostBreakdownRow[];
}
