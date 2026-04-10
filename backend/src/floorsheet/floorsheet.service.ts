import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import {
  FloorsheetAlertDto,
  FloorsheetAlertSeverity,
  FloorsheetBrokerFlowDto,
  FloorsheetDeskResponse,
  FloorsheetPressureDto,
  FloorsheetPressureLabel,
  FloorsheetSymbolInsightDto,
  FloorsheetSymbolResponse,
  FloorsheetTradeDto,
} from './floorsheet.types';

const SHARESANAR_FLOORSHEET_URL = 'https://www.sharesansar.com/floorsheet';
const SOURCE = 'sharesansar';

const DEFAULT_DESK_SYMBOLS = 6;
const MIN_DESK_SYMBOLS = 3;
const MAX_DESK_SYMBOLS = 10;

const DEFAULT_ROWS = 120;
const MIN_ROWS = 30;
const MAX_ROWS = 300;

const CACHE_TTL_MS = 25 * 1000;
const TOP_BROKER_COUNT = 10;
const TOP_PRINT_COUNT = 12;

const FALLBACK_SYMBOLS = ['NABIL', 'NIFRA', 'NTC', 'CHDC', 'SHIVM', 'SANIMA', 'NICA', 'HDL'];

const SCRAPE_HTTP_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'application/json,text/javascript,*/*;q=0.01',
  'Accept-Language': 'en-US,en;q=0.9',
  'X-Requested-With': 'XMLHttpRequest',
};

interface CachedPayload<T> {
  fetchedAt: number;
  payload: T;
}

interface SharesansarFloorsheetRow {
  symbol?: unknown;
  contract_no?: unknown;
  buyer?: unknown;
  seller?: unknown;
  quantity?: unknown;
  rate?: unknown;
  amount?: unknown;
  date_?: unknown;
}

interface SharesansarFloorsheetResponse {
  recordsTotal?: unknown;
  recordsFiltered?: unknown;
  qtyTotal?: unknown;
  amtTotal?: unknown;
  data?: unknown;
}

interface ParsedFloorsheetPayload {
  recordsTotal: number;
  recordsFiltered: number;
  qtyTotal: number;
  amtTotal: number;
  trades: FloorsheetTradeDto[];
}

interface BrokerAccumulator {
  broker: string;
  boughtQty: number;
  soldQty: number;
  boughtAmount: number;
  soldAmount: number;
  tradeCount: number;
  symbols: Set<string>;
}

interface SymbolAnalysis {
  insight: FloorsheetSymbolInsightDto;
  alerts: FloorsheetAlertDto[];
  brokerFlows: FloorsheetBrokerFlowDto[];
  topPrints: FloorsheetTradeDto[];
  trades: FloorsheetTradeDto[];
}

@Injectable()
export class FloorsheetService {
  private readonly logger = new Logger(FloorsheetService.name);
  private readonly cache = new Map<string, CachedPayload<unknown>>();

  constructor(private readonly prisma: PrismaService) {}

  async getDesk(symbolCount?: number, rowsPerSymbol?: number): Promise<FloorsheetDeskResponse> {
    const requestedSymbols = this.toBoundedInt(
      symbolCount,
      DEFAULT_DESK_SYMBOLS,
      MIN_DESK_SYMBOLS,
      MAX_DESK_SYMBOLS,
    );
    const rows = this.toBoundedInt(rowsPerSymbol, DEFAULT_ROWS, MIN_ROWS, MAX_ROWS);

    const cacheKey = `desk:${requestedSymbols}:${rows}`;
    const cached = this.readCache<FloorsheetDeskResponse>(cacheKey);
    if (cached) {
      return cached;
    }

    const candidateSymbols = await this.getCandidateSymbols(requestedSymbols);

    const analysesRaw = await Promise.all(
      candidateSymbols.map(async (symbol) => {
        try {
          const payload = await this.fetchFloorsheet(symbol, rows, null, null);
          if (!payload.trades.length) {
            return null;
          }

          return this.analyzeSymbol(symbol, payload.trades);
        } catch (error) {
          this.logger.warn(`Floorsheet request failed for ${symbol}.`);
          return null;
        }
      }),
    );

    const analyses = analysesRaw.filter((entry): entry is SymbolAnalysis => entry !== null);
    const allTrades = analyses.flatMap((entry) => entry.trades);
    const aggregateFlows = this.aggregateBrokerFlows(allTrades);
    const brokerSlices = this.sliceBrokerFlows(aggregateFlows);

    const deskPayload: FloorsheetDeskResponse = {
      asOf: new Date().toISOString(),
      source: SOURCE,
      scannedSymbols: analyses.length,
      requestedSymbols,
      rowsPerSymbol: rows,
      symbols: analyses.map((entry) => entry.insight).sort((a, b) => b.amount - a.amount),
      alerts: this.buildDeskAlerts(analyses),
      brokers: brokerSlices,
    };

    this.writeCache(cacheKey, deskPayload);
    return deskPayload;
  }

  async getSymbol(
    symbol: string,
    rows?: number,
    buyer?: string,
    seller?: string,
  ): Promise<FloorsheetSymbolResponse> {
    const normalizedSymbol = this.normalizeSymbol(symbol) ?? '';
    if (!normalizedSymbol) {
      throw new Error('A valid symbol is required for floorsheet analysis.');
    }

    const normalizedRows = this.toBoundedInt(rows, DEFAULT_ROWS, MIN_ROWS, MAX_ROWS);
    const normalizedBuyer = this.normalizeBroker(buyer);
    const normalizedSeller = this.normalizeBroker(seller);

    const cacheKey = `symbol:${normalizedSymbol}:${normalizedRows}:${normalizedBuyer ?? '-'}:${normalizedSeller ?? '-'}`;
    const cached = this.readCache<FloorsheetSymbolResponse>(cacheKey);
    if (cached) {
      return cached;
    }

    const payload = await this.fetchFloorsheet(normalizedSymbol, normalizedRows, normalizedBuyer, normalizedSeller);
    const analysis = this.analyzeSymbol(normalizedSymbol, payload.trades);
    const brokerSlices = this.sliceBrokerFlows(analysis.brokerFlows);

    const response: FloorsheetSymbolResponse = {
      asOf: new Date().toISOString(),
      source: SOURCE,
      symbol: normalizedSymbol,
      filters: {
        rows: normalizedRows,
        buyer: normalizedBuyer,
        seller: normalizedSeller,
      },
      meta: {
        recordsTotal: payload.recordsTotal,
        recordsFiltered: payload.recordsFiltered,
        qtyTotal: this.round(payload.qtyTotal, 2),
        amtTotal: this.round(payload.amtTotal, 2),
      },
      insight: analysis.insight,
      alerts: analysis.alerts,
      topPrints: analysis.topPrints,
      brokerFlows: {
        topNetBuyers: brokerSlices.netBuyers,
        topNetSellers: brokerSlices.netSellers,
        mostActive: brokerSlices.mostActive,
      },
      trades: payload.trades,
    };

    this.writeCache(cacheKey, response);
    return response;
  }

  private analyzeSymbol(symbol: string, trades: FloorsheetTradeDto[]): SymbolAnalysis {
    if (!trades.length) {
      const emptyInsight = this.emptyInsight(symbol);
      return {
        insight: emptyInsight,
        alerts: [],
        brokerFlows: [],
        topPrints: [],
        trades,
      };
    }

    const totalQuantity = trades.reduce((sum, trade) => sum + trade.quantity, 0);
    const totalAmount = trades.reduce((sum, trade) => sum + trade.amount, 0);
    const tradeCount = trades.length;
    const avgTradeAmount = tradeCount > 0 ? totalAmount / tradeCount : 0;
    const weightedAvgRate = totalQuantity > 0 ? totalAmount / totalQuantity : 0;

    const uniqueBuyers = new Set(trades.map((trade) => trade.buyerBroker).filter((value): value is string => Boolean(value)));
    const uniqueSellers = new Set(trades.map((trade) => trade.sellerBroker).filter((value): value is string => Boolean(value)));

    const topPrints = [...trades].sort((a, b) => b.amount - a.amount).slice(0, TOP_PRINT_COUNT);
    const largestPrint = topPrints[0] ?? null;

    const qtyThreshold = Math.max(3_000, tradeCount > 0 ? (totalQuantity / tradeCount) * 2.5 : 0);
    const amountThreshold = Math.max(1_500_000, tradeCount > 0 ? avgTradeAmount * 3 : 0);
    const blockTrades = trades.filter(
      (trade) => trade.quantity >= qtyThreshold || trade.amount >= amountThreshold,
    );

    const brokerFlows = this.aggregateBrokerFlows(trades);
    const brokerSlices = this.sliceBrokerFlows(brokerFlows);

    const topBuyer = brokerSlices.netBuyers[0] ?? null;
    const topSeller = brokerSlices.netSellers[0] ?? null;
    const topBuyerShare = totalAmount > 0 && topBuyer ? (topBuyer.netAmount / totalAmount) * 100 : 0;
    const topSellerShare = totalAmount > 0 && topSeller ? (Math.abs(topSeller.netAmount) / totalAmount) * 100 : 0;

    const pressure = this.computePressure(totalAmount, brokerFlows, topBuyerShare, topSellerShare);

    const insight: FloorsheetSymbolInsightDto = {
      symbol,
      tradeCount,
      quantity: this.round(totalQuantity, 2),
      amount: this.round(totalAmount, 2),
      weightedAvgRate: this.round(weightedAvgRate, 4),
      avgTradeAmount: this.round(avgTradeAmount, 2),
      uniqueBuyers: uniqueBuyers.size,
      uniqueSellers: uniqueSellers.size,
      brokerParticipation: brokerFlows.length,
      blockTradeCount: blockTrades.length,
      largestPrintAmount: this.round(largestPrint?.amount ?? 0, 2),
      largestPrintQty: this.round(largestPrint?.quantity ?? 0, 2),
      topBuyerBroker: topBuyer?.broker ?? null,
      topSellerBroker: topSeller?.broker ?? null,
      topBuyerNetAmount: this.round(topBuyer?.netAmount ?? 0, 2),
      topSellerNetAmount: this.round(Math.abs(topSeller?.netAmount ?? 0), 2),
      pressure,
      highlights: [],
    };

    const alerts = this.buildSymbolAlerts(insight, topPrints, topBuyerShare, topSellerShare);

    const highlights = alerts.slice(0, 2).map((alert) => alert.title);
    if (!highlights.length) {
      if (pressure.label === 'ACCUMULATION') {
        highlights.push('Accumulation bias with balanced broker participation.');
      } else if (pressure.label === 'DISTRIBUTION') {
        highlights.push('Distribution pressure detected from broker inventory transfer.');
      } else {
        highlights.push('Two-way flow currently dominates this symbol.');
      }
    }

    insight.highlights = highlights;

    return {
      insight,
      alerts,
      brokerFlows,
      topPrints,
      trades,
    };
  }

  private buildSymbolAlerts(
    insight: FloorsheetSymbolInsightDto,
    topPrints: FloorsheetTradeDto[],
    topBuyerShare: number,
    topSellerShare: number,
  ): FloorsheetAlertDto[] {
    const alerts: FloorsheetAlertDto[] = [];

    if (insight.blockTradeCount > 0 && topPrints.length) {
      const largest = topPrints[0];
      const severity: FloorsheetAlertSeverity = largest.amount >= 12_000_000 ? 'HIGH' : 'MEDIUM';

      alerts.push({
        type: 'BLOCK_PRINT',
        severity,
        title: `${insight.symbol}: block prints detected`,
        detail: `${insight.blockTradeCount} large prints. Biggest print: Rs ${this.formatIndian(largest.amount)} at ${this.round(
          largest.rate,
          2,
        )}.`,
        symbol: insight.symbol,
        broker: largest.buyerBroker ?? largest.sellerBroker,
        value: this.round(largest.amount, 2),
      });
    }

    if (topBuyerShare >= 20 && insight.topBuyerBroker) {
      alerts.push({
        type: 'BROKER_ACCUMULATION',
        severity: topBuyerShare >= 30 ? 'HIGH' : 'MEDIUM',
        title: `${insight.symbol}: broker ${insight.topBuyerBroker} accumulating`,
        detail: `Top net buyer controls ${this.round(topBuyerShare, 1)}% of symbol turnover transfer.`,
        symbol: insight.symbol,
        broker: insight.topBuyerBroker,
        value: this.round(topBuyerShare, 2),
      });
    }

    if (topSellerShare >= 20 && insight.topSellerBroker) {
      alerts.push({
        type: 'BROKER_DISTRIBUTION',
        severity: topSellerShare >= 30 ? 'HIGH' : 'MEDIUM',
        title: `${insight.symbol}: broker ${insight.topSellerBroker} distributing`,
        detail: `Top net seller drives ${this.round(topSellerShare, 1)}% of inventory transfer.`,
        symbol: insight.symbol,
        broker: insight.topSellerBroker,
        value: this.round(topSellerShare, 2),
      });
    }

    if (insight.pressure.concentrationPct >= 58) {
      alerts.push({
        type: 'BROKER_CONCENTRATION',
        severity: insight.pressure.concentrationPct >= 70 ? 'HIGH' : 'MEDIUM',
        title: `${insight.symbol}: high broker concentration`,
        detail: `Top active brokers represent ${this.round(
          insight.pressure.concentrationPct,
          1,
        )}% of matched flow.`,
        symbol: insight.symbol,
        broker: null,
        value: this.round(insight.pressure.concentrationPct, 2),
      });
    }

    if (insight.pressure.transferScore <= 18 && insight.tradeCount >= 35) {
      alerts.push({
        type: 'FLOW_CHURN',
        severity: 'LOW',
        title: `${insight.symbol}: churn-heavy tape`,
        detail: 'Low transfer score signals two-way churn rather than clear inventory migration.',
        symbol: insight.symbol,
        broker: null,
        value: this.round(insight.pressure.transferScore, 2),
      });
    }

    return alerts;
  }

  private computePressure(
    totalAmount: number,
    brokerFlows: FloorsheetBrokerFlowDto[],
    topBuyerShare: number,
    topSellerShare: number,
  ): FloorsheetPressureDto {
    if (totalAmount <= 0 || !brokerFlows.length) {
      return {
        label: 'TWO_WAY',
        transferScore: 0,
        dominancePct: 0,
        concentrationPct: 0,
      };
    }

    const sumAbsNet = brokerFlows.reduce((sum, row) => sum + Math.abs(row.netAmount), 0);
    const transferScore = (sumAbsNet / (2 * totalAmount)) * 100;
    const maxNet = brokerFlows.reduce((max, row) => Math.max(max, Math.abs(row.netAmount)), 0);
    const dominancePct = (maxNet / totalAmount) * 100;

    const topActive = [...brokerFlows]
      .sort((a, b) => b.tradedAmount - a.tradedAmount)
      .slice(0, 3)
      .reduce((sum, row) => sum + row.tradedAmount, 0);

    const concentrationPct = (topActive / (2 * totalAmount)) * 100;

    let label: FloorsheetPressureLabel = 'TWO_WAY';
    if (topBuyerShare >= 18 && topBuyerShare >= topSellerShare * 1.2) {
      label = 'ACCUMULATION';
    } else if (topSellerShare >= 18 && topSellerShare >= topBuyerShare * 1.2) {
      label = 'DISTRIBUTION';
    }

    return {
      label,
      transferScore: this.round(transferScore, 2),
      dominancePct: this.round(dominancePct, 2),
      concentrationPct: this.round(concentrationPct, 2),
    };
  }

  private buildDeskAlerts(analyses: SymbolAnalysis[]): FloorsheetAlertDto[] {
    const dedupe = new Map<string, FloorsheetAlertDto>();

    for (const analysis of analyses) {
      for (const alert of analysis.alerts) {
        const key = `${alert.type}:${alert.symbol ?? 'global'}:${alert.broker ?? '-'}:${alert.title}`;
        if (!dedupe.has(key)) {
          dedupe.set(key, alert);
        }
      }
    }

    const severityRank: Record<FloorsheetAlertSeverity, number> = {
      HIGH: 3,
      MEDIUM: 2,
      LOW: 1,
    };

    return [...dedupe.values()]
      .sort((a, b) => {
        const bySeverity = severityRank[b.severity] - severityRank[a.severity];
        if (bySeverity !== 0) return bySeverity;
        return Math.abs(b.value ?? 0) - Math.abs(a.value ?? 0);
      })
      .slice(0, 10);
  }

  private aggregateBrokerFlows(trades: FloorsheetTradeDto[]): FloorsheetBrokerFlowDto[] {
    if (!trades.length) {
      return [];
    }

    const map = new Map<string, BrokerAccumulator>();

    const ensure = (broker: string): BrokerAccumulator => {
      const existing = map.get(broker);
      if (existing) {
        return existing;
      }

      const created: BrokerAccumulator = {
        broker,
        boughtQty: 0,
        soldQty: 0,
        boughtAmount: 0,
        soldAmount: 0,
        tradeCount: 0,
        symbols: new Set<string>(),
      };

      map.set(broker, created);
      return created;
    };

    for (const trade of trades) {
      if (trade.buyerBroker) {
        const buyer = ensure(trade.buyerBroker);
        buyer.boughtQty += trade.quantity;
        buyer.boughtAmount += trade.amount;
        buyer.tradeCount += 1;
        buyer.symbols.add(trade.symbol);
      }

      if (trade.sellerBroker) {
        const seller = ensure(trade.sellerBroker);
        seller.soldQty += trade.quantity;
        seller.soldAmount += trade.amount;
        seller.tradeCount += 1;
        seller.symbols.add(trade.symbol);
      }
    }

    return [...map.values()].map((entry) => {
      const netQty = entry.boughtQty - entry.soldQty;
      const netAmount = entry.boughtAmount - entry.soldAmount;
      const tradedAmount = entry.boughtAmount + entry.soldAmount;

      return {
        broker: entry.broker,
        boughtQty: this.round(entry.boughtQty, 2),
        soldQty: this.round(entry.soldQty, 2),
        boughtAmount: this.round(entry.boughtAmount, 2),
        soldAmount: this.round(entry.soldAmount, 2),
        netQty: this.round(netQty, 2),
        netAmount: this.round(netAmount, 2),
        tradedAmount: this.round(tradedAmount, 2),
        tradeCount: entry.tradeCount,
        symbolCount: entry.symbols.size,
      };
    });
  }

  private sliceBrokerFlows(brokerFlows: FloorsheetBrokerFlowDto[]): {
    netBuyers: FloorsheetBrokerFlowDto[];
    netSellers: FloorsheetBrokerFlowDto[];
    mostActive: FloorsheetBrokerFlowDto[];
  } {
    const netBuyers = [...brokerFlows]
      .filter((row) => row.netAmount > 0)
      .sort((a, b) => b.netAmount - a.netAmount)
      .slice(0, TOP_BROKER_COUNT);

    const netSellers = [...brokerFlows]
      .filter((row) => row.netAmount < 0)
      .sort((a, b) => a.netAmount - b.netAmount)
      .slice(0, TOP_BROKER_COUNT);

    const mostActive = [...brokerFlows]
      .sort((a, b) => b.tradedAmount - a.tradedAmount)
      .slice(0, TOP_BROKER_COUNT);

    return { netBuyers, netSellers, mostActive };
  }

  private async getCandidateSymbols(limit: number): Promise<string[]> {
    try {
      const rows = await this.prisma.price.findMany({
        where: {
          ltp: {
            gt: 0,
          },
        },
        orderBy: [{ turnover: 'desc' }, { volume: 'desc' }, { symbol: 'asc' }],
        take: Math.max(limit * 2, limit),
        select: {
          symbol: true,
        },
      });

      const deduped = Array.from(
        new Set(
          rows
            .map((row) => this.normalizeSymbol(row.symbol))
            .filter((value): value is string => Boolean(value)),
        ),
      ).slice(0, limit);

      if (deduped.length) {
        return deduped;
      }
    } catch (error) {
      if (this.isMissingTableError(error)) {
        this.logger.warn('Price table missing. Falling back to static floorsheet symbol list.');
      } else {
        this.logger.warn('Unable to derive symbol universe from database. Falling back to static list.');
      }
    }

    return FALLBACK_SYMBOLS.slice(0, limit);
  }

  private isMissingTableError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2021'
    );
  }

  private async fetchFloorsheet(
    symbol: string,
    rows: number,
    buyer: string | null,
    seller: string | null,
  ): Promise<ParsedFloorsheetPayload> {
    const params: Record<string, string | number> = {
      draw: 1,
      start: 0,
      length: rows,
      company: symbol,
    };

    if (buyer) {
      params.buyer = buyer;
    }

    if (seller) {
      params.seller = seller;
    }

    const response = await axios.get<unknown>(SHARESANAR_FLOORSHEET_URL, {
      timeout: 20_000,
      params,
      headers: SCRAPE_HTTP_HEADERS,
    });

    return this.parseFloorsheetResponse(response.data, symbol);
  }

  private parseFloorsheetResponse(data: unknown, fallbackSymbol: string): ParsedFloorsheetPayload {
    let parsed: SharesansarFloorsheetResponse | null = null;

    if (typeof data === 'string') {
      try {
        parsed = JSON.parse(data) as SharesansarFloorsheetResponse;
      } catch {
        throw new Error('Unexpected floorsheet response format.');
      }
    } else if (typeof data === 'object' && data !== null) {
      parsed = data as SharesansarFloorsheetResponse;
    }

    if (!parsed) {
      throw new Error('Floorsheet source did not return a JSON payload.');
    }

    const dataRows = Array.isArray(parsed.data) ? (parsed.data as SharesansarFloorsheetRow[]) : [];
    const trades = dataRows
      .map((row) => this.normalizeTrade(row, fallbackSymbol))
      .filter((row): row is FloorsheetTradeDto => row !== null);

    return {
      recordsTotal: this.toSafeInt(parsed.recordsTotal, trades.length),
      recordsFiltered: this.toSafeInt(parsed.recordsFiltered, trades.length),
      qtyTotal: this.toNumber(parsed.qtyTotal) ?? trades.reduce((sum, trade) => sum + trade.quantity, 0),
      amtTotal: this.toNumber(parsed.amtTotal) ?? trades.reduce((sum, trade) => sum + trade.amount, 0),
      trades,
    };
  }

  private normalizeTrade(row: SharesansarFloorsheetRow, fallbackSymbol: string): FloorsheetTradeDto | null {
    const symbol = this.normalizeSymbol(this.toText(row.symbol)) ?? fallbackSymbol;
    const quantity = this.toNumber(row.quantity);
    const rate = this.toNumber(row.rate);
    const amount = this.toNumber(row.amount);

    if (quantity === null || rate === null) {
      return null;
    }

    const resolvedAmount = amount ?? quantity * rate;
    if (resolvedAmount <= 0 || quantity <= 0 || rate <= 0) {
      return null;
    }

    return {
      symbol,
      contractNo: this.toText(row.contract_no),
      buyerBroker: this.normalizeBroker(row.buyer),
      sellerBroker: this.normalizeBroker(row.seller),
      quantity: this.round(quantity, 2),
      rate: this.round(rate, 4),
      amount: this.round(resolvedAmount, 2),
      tradedAt: this.toText(row.date_),
    };
  }

  private emptyInsight(symbol: string): FloorsheetSymbolInsightDto {
    return {
      symbol,
      tradeCount: 0,
      quantity: 0,
      amount: 0,
      weightedAvgRate: 0,
      avgTradeAmount: 0,
      uniqueBuyers: 0,
      uniqueSellers: 0,
      brokerParticipation: 0,
      blockTradeCount: 0,
      largestPrintAmount: 0,
      largestPrintQty: 0,
      topBuyerBroker: null,
      topSellerBroker: null,
      topBuyerNetAmount: 0,
      topSellerNetAmount: 0,
      pressure: {
        label: 'TWO_WAY',
        transferScore: 0,
        dominancePct: 0,
        concentrationPct: 0,
      },
      highlights: ['No trades available for this symbol under current filters.'],
    };
  }

  private toBoundedInt(
    value: number | undefined,
    fallback: number,
    min: number,
    max: number,
  ): number {
    if (!Number.isFinite(value)) {
      return fallback;
    }

    return Math.max(min, Math.min(max, Math.floor(value as number)));
  }

  private readCache<T>(key: string): T | null {
    const cached = this.cache.get(key);
    if (!cached) {
      return null;
    }

    if (Date.now() - cached.fetchedAt >= CACHE_TTL_MS) {
      this.cache.delete(key);
      return null;
    }

    return cached.payload as T;
  }

  private writeCache<T>(key: string, payload: T): void {
    this.cache.set(key, {
      fetchedAt: Date.now(),
      payload,
    });
  }

  private normalizeSymbol(value: unknown): string | null {
    const text = this.toText(value);
    if (!text) return null;

    const normalized = text.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (!normalized) return null;

    if (!/^[A-Z][A-Z0-9]{1,19}$/.test(normalized)) {
      return null;
    }

    return normalized;
  }

  private normalizeBroker(value: unknown): string | null {
    const text = this.toText(value);
    if (!text) return null;

    const normalized = text.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (!normalized) return null;
    return normalized;
  }

  private toText(value: unknown): string | null {
    if (typeof value !== 'string') {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
      }

      return null;
    }

    const cleaned = value.replace(/\s+/g, ' ').trim();
    return cleaned || null;
  }

  private toNumber(value: unknown): number | null {
    if (value === null || value === undefined) return null;

    const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : null;
    if (!raw) return null;

    const negative = raw.includes('(') && raw.includes(')');
    const cleaned = raw
      .replace(/,/g, '')
      .replace(/[()]/g, '')
      .replace(/rs\.?/gi, '')
      .replace(/\s+/g, '')
      .trim();

    if (!cleaned) return null;

    const multiplier = this.extractMagnitudeMultiplier(cleaned);
    const numericText = cleaned.replace(/[A-Za-z]/g, '');
    const parsed = Number(numericText);
    if (!Number.isFinite(parsed)) return null;

    const signed = negative ? -Math.abs(parsed) : parsed;
    return signed * multiplier;
  }

  private extractMagnitudeMultiplier(value: string): number {
    const lower = value.toLowerCase();
    if (lower.includes('cr')) return 10_000_000;
    if (lower.includes('m')) return 1_000_000;
    if (lower.includes('k')) return 1_000;
    return 1;
  }

  private toSafeInt(value: unknown, fallback: number): number {
    const parsed = this.toNumber(value);
    if (parsed === null) return fallback;
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.floor(parsed));
  }

  private round(value: number, digits: number): number {
    if (!Number.isFinite(value)) return 0;
    return Number(value.toFixed(digits));
  }

  private formatIndian(value: number): string {
    return new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }
}