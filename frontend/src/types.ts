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

export interface WatchlistApiRow {
  symbol: string;
  company: string | null;
  sector: string | null;
  ltp: number;
  change: number | null;
  change_pct: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  turnover: number | null;
}

export interface IndexApiRow {
  indexName: string;
  value: number;
  change: number;
  change_pct: number;
  savedAt: string;
}

export interface MarketStatusResponse {
  isOpen: boolean;
  label: 'OPEN' | 'CLOSED';
  session: string;
  source: 'nepalstock' | 'sharesansar' | 'unknown';
  asOf: string | null;
}

export type FloorsheetPressureLabel = 'ACCUMULATION' | 'DISTRIBUTION' | 'TWO_WAY';
export type FloorsheetAlertSeverity = 'HIGH' | 'MEDIUM' | 'LOW';
export type FloorsheetAlertType =
  | 'BLOCK_PRINT'
  | 'BROKER_ACCUMULATION'
  | 'BROKER_DISTRIBUTION'
  | 'BROKER_CONCENTRATION'
  | 'FLOW_CHURN';

export interface FloorsheetTradeRow {
  symbol: string;
  contractNo: string | null;
  buyerBroker: string | null;
  sellerBroker: string | null;
  quantity: number;
  rate: number;
  amount: number;
  tradedAt: string | null;
}

export interface FloorsheetBrokerFlowRow {
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

export interface FloorsheetPressure {
  label: FloorsheetPressureLabel;
  transferScore: number;
  dominancePct: number;
  concentrationPct: number;
}

export interface FloorsheetSymbolInsight {
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
  pressure: FloorsheetPressure;
  highlights: string[];
}

export interface FloorsheetAlert {
  type: FloorsheetAlertType;
  severity: FloorsheetAlertSeverity;
  title: string;
  detail: string;
  symbol: string | null;
  broker: string | null;
  value: number | null;
}

export interface FloorsheetDeskResponse {
  asOf: string;
  source: 'sharesansar';
  scannedSymbols: number;
  requestedSymbols: number;
  rowsPerSymbol: number;
  symbols: FloorsheetSymbolInsight[];
  alerts: FloorsheetAlert[];
  brokers: {
    netBuyers: FloorsheetBrokerFlowRow[];
    netSellers: FloorsheetBrokerFlowRow[];
    mostActive: FloorsheetBrokerFlowRow[];
  };
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
  insight: FloorsheetSymbolInsight;
  alerts: FloorsheetAlert[];
  topPrints: FloorsheetTradeRow[];
  brokerFlows: {
    topNetBuyers: FloorsheetBrokerFlowRow[];
    topNetSellers: FloorsheetBrokerFlowRow[];
    mostActive: FloorsheetBrokerFlowRow[];
  };
  trades: FloorsheetTradeRow[];
}

export interface OhlcCandle {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number | null;
}

export interface OhlcBackfillRequest {
  symbolsLimit?: number;
  sinceDays?: number;
  throttleMs?: number;
}

export interface OhlcBackfillSymbolReport {
  symbol: string;
  companyId: number;
  fetchedRows: number;
  insertedCandles: number;
  newestDate: string | null;
  oldestDate: string | null;
  error: string | null;
}

export type OhlcBackfillJobStatus = 'IDLE' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface OhlcBackfillJobState {
  jobId: string | null;
  status: OhlcBackfillJobStatus;
  startedAt: string | null;
  finishedAt: string | null;
  options: {
    symbolsLimit: number;
    sinceDays: number | null;
    throttleMs: number;
  };
  progress: {
    totalSymbols: number;
    processedSymbols: number;
    totalFetchedRows: number;
    totalInsertedCandles: number;
    currentSymbol: string | null;
  };
  recentReports: OhlcBackfillSymbolReport[];
  error: string | null;
}

export interface IndicatorPoint {
  t: string;
  value: number | null;
}

export interface IndicatorsResponse {
  symbol: string;
  interval: '1m' | '5m' | '15m' | '1h' | '1d';
  candles: OhlcCandle[];
  sma20: IndicatorPoint[];
  ema20: IndicatorPoint[];
  rsi14: IndicatorPoint[];
  macd: {
    line: IndicatorPoint[];
    signal: IndicatorPoint[];
    histogram: IndicatorPoint[];
  };
  bollinger: {
    upper: IndicatorPoint[];
    middle: IndicatorPoint[];
    lower: IndicatorPoint[];
  };
  vwap: IndicatorPoint[];
}

export interface AuthUser {
  id: number;
  email: string;
  displayName: string | null;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface OtpDispatchResponse {
  message: string;
  cooldownSeconds: number;
  expiresInMinutes: number;
}

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

export type TradingSignalKind = 'BUY' | 'SELL' | 'HOLD';
export type TradingSignalConfidence = 'HIGH' | 'MEDIUM' | 'LOW';
export type SignalInterval = '1m' | '5m' | '15m' | '1h' | '1d';
export type SignalNotebookSessionState = 'OPEN' | 'POST_CLOSE' | 'CLOSED';
export type SignalNotebookOutcome =
  | 'PENDING'
  | 'HIT_TARGET'
  | 'HIT_STOP'
  | 'MOVED_IN_FAVOR'
  | 'MOVED_AGAINST'
  | 'FLAT';

export interface SignalNotebookAutomationStatus {
  sessionState: SignalNotebookSessionState;
  autoMode: boolean;
  nextAction: string;
  note: string;
}

export interface SignalCheckItem {
  key: string;
  label: string;
  required: boolean;
  passed: boolean;
  weight: number;
}

export interface SignalTradePlan {
  entryPrice: number;
  stopLoss: number;
  targetPrice: number;
  takeProfit1: number;
  takeProfit2: number;
  trailingStop: number;
  riskPerShare: number;
  rewardPerShare: number;
  riskReward: number;
  expectedMovePct: number;
  invalidation: string;
  primaryExitRule: string;
  exitRationale: string;
}

export interface SignalStructureLevel {
  price: number;
  touches: number;
  distancePct: number;
}

export interface SignalMarketStructure {
  trendBias: 'BULLISH' | 'BEARISH' | 'RANGE';
  nearestSupport: number | null;
  nearestResistance: number | null;
  supportLevels: SignalStructureLevel[];
  resistanceLevels: SignalStructureLevel[];
}

export interface SignalPerformanceStats {
  sampleSize: number;
  winRatePct: number;
  averageAccuracyPct: number;
  recentWinRatePct: number;
  calibrationAdjustment: number;
  note: string;
}

export interface SignalPriceContext {
  close: number;
  ema8: number;
  ema21: number;
  ema20: number;
  ema50: number;
  rsi14: number;
  vwap: number;
  volume: number;
  avgVolume20: number;
}

export interface TradingSignalResponse {
  signal: TradingSignalKind;
  confidence: TradingSignalConfidence;
  buyScore: number;
  sellScore: number;
  strength: number;
  reasons: string[];
  recommendedAction: string;
  qualityScore: number;
  plan: SignalTradePlan | null;
  requiredChecks: SignalCheckItem[];
  failedChecks: string[];
  priceContext: SignalPriceContext;
  structure: SignalMarketStructure;
  performance: SignalPerformanceStats;
  interval: SignalInterval;
  generatedAt: string;
}

export interface SignalNotebookEntry {
  id: number;
  tradeDate: string;
  symbol: string;
  signal: Exclude<TradingSignalKind, 'HOLD'>;
  confidence: TradingSignalConfidence;
  entryPrice: number;
  stopLoss: number;
  targetPrice: number;
  riskReward: number;
  qualityScore: number;
  reasons: string[];
  requiredChecks: string[];
  failedChecks: string[];
  recommendedAction: string;
  generatedAt: string;
  evaluatedAt: string | null;
  closePrice: number | null;
  outcome: SignalNotebookOutcome;
  accuracyScore: number | null;
}

export interface SignalNotebookSummary {
  total: number;
  buyCount: number;
  sellCount: number;
  pendingCount: number;
  evaluatedCount: number;
  hitTargetCount: number;
  hitStopCount: number;
  movedInFavorCount: number;
  movedAgainstCount: number;
  winRatePct: number;
  averageAccuracyPct: number;
}

export interface SignalNotebookResponse {
  tradeDate: string;
  generatedAt: string | null;
  evaluatedAt: string | null;
  automation: SignalNotebookAutomationStatus;
  summary: SignalNotebookSummary;
  entries: SignalNotebookEntry[];
}

export type NewsImpactLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface EconomicNewsItem {
  headline: string;
  url: string;
  source: string;
  publishedDate: string | null;
  impact: NewsImpactLevel;
  relevanceScore: number;
  tags: string[];
}

export interface EconomicNewsResponse {
  asOf: string;
  source: string;
  count: number;
  items: EconomicNewsItem[];
}

export type ExecutionDecisionSide = 'BUY' | 'SELL';
export type ExecutionDecisionOutcome = 'PENDING' | 'CORRECT' | 'PARTIAL' | 'WRONG' | 'SKIPPED';

export interface ExecutionDecisionEntry {
  id: number;
  tradeDate: string;
  side: ExecutionDecisionSide;
  symbol: string;
  reason: string;
  plan: string | null;
  confidence: number;
  outcome: ExecutionDecisionOutcome;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateExecutionDecisionPayload {
  side: ExecutionDecisionSide;
  symbol: string;
  reason: string;
  plan?: string;
  confidence: number;
  tradeDate?: string;
}

export interface UpdateExecutionDecisionPayload {
  side?: ExecutionDecisionSide;
  symbol?: string;
  reason?: string;
  plan?: string;
  confidence?: number;
  outcome?: ExecutionDecisionOutcome;
  reviewNote?: string;
  tradeDate?: string;
}

export interface HoldingRow {
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

export interface PortfolioResponse {
  summary: {
    holdingsCount: number;
    investedCost: number;
    currentValue: number;
    netIfSellNow: number;
    unrealizedPnl: number;
  };
  holdings: HoldingRow[];
}

export interface CreateHoldingPayload {
  symbol: string;
  buyPrice: number;
  qty: number;
  targetPrice?: number;
  stopLoss?: number;
  notes?: string;
}
