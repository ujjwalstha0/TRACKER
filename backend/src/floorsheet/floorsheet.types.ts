export type FloorsheetPressureLabel = 'ACCUMULATION' | 'DISTRIBUTION' | 'TWO_WAY';
export type FloorsheetAlertSeverity = 'HIGH' | 'MEDIUM' | 'LOW';
export type FloorsheetAlertType =
  | 'BLOCK_PRINT'
  | 'BROKER_ACCUMULATION'
  | 'BROKER_DISTRIBUTION'
  | 'BROKER_CONCENTRATION'
  | 'FLOW_CHURN';

export interface FloorsheetTradeDto {
  symbol: string;
  contractNo: string | null;
  buyerBroker: string | null;
  sellerBroker: string | null;
  quantity: number;
  rate: number;
  amount: number;
  tradedAt: string | null;
}

export interface FloorsheetBrokerFlowDto {
  broker: string;
  boughtQty: number;
  soldQty: number;
  boughtAmount: number;
  soldAmount: number;
  netQty: number;
  netAmount: number;
  tradedAmount: number;
  tradeCount: number;
  symbolCount: number;
}

export interface FloorsheetPressureDto {
  label: FloorsheetPressureLabel;
  transferScore: number;
  dominancePct: number;
  concentrationPct: number;
}

export interface FloorsheetSymbolInsightDto {
  symbol: string;
  tradeCount: number;
  quantity: number;
  amount: number;
  weightedAvgRate: number;
  avgTradeAmount: number;
  uniqueBuyers: number;
  uniqueSellers: number;
  brokerParticipation: number;
  blockTradeCount: number;
  largestPrintAmount: number;
  largestPrintQty: number;
  topBuyerBroker: string | null;
  topSellerBroker: string | null;
  topBuyerNetAmount: number;
  topSellerNetAmount: number;
  pressure: FloorsheetPressureDto;
  highlights: string[];
}

export interface FloorsheetAlertDto {
  type: FloorsheetAlertType;
  severity: FloorsheetAlertSeverity;
  title: string;
  detail: string;
  symbol: string | null;
  broker: string | null;
  value: number | null;
}

export interface FloorsheetSymbolResponse {
  asOf: string;
  source: 'sharesansar';
  symbol: string;
  filters: {
    rows: number;
    buyer: string | null;
    seller: string | null;
  };
  meta: {
    recordsTotal: number;
    recordsFiltered: number;
    qtyTotal: number;
    amtTotal: number;
  };
  insight: FloorsheetSymbolInsightDto;
  alerts: FloorsheetAlertDto[];
  topPrints: FloorsheetTradeDto[];
  brokerFlows: {
    topNetBuyers: FloorsheetBrokerFlowDto[];
    topNetSellers: FloorsheetBrokerFlowDto[];
    mostActive: FloorsheetBrokerFlowDto[];
  };
  trades: FloorsheetTradeDto[];
}

export interface FloorsheetDeskResponse {
  asOf: string;
  source: 'sharesansar';
  scannedSymbols: number;
  requestedSymbols: number;
  rowsPerSymbol: number;
  symbols: FloorsheetSymbolInsightDto[];
  alerts: FloorsheetAlertDto[];
  brokers: {
    netBuyers: FloorsheetBrokerFlowDto[];
    netSellers: FloorsheetBrokerFlowDto[];
    mostActive: FloorsheetBrokerFlowDto[];
  };
}