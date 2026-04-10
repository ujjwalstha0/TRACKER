import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { OhlcService } from '../ohlc/ohlc.service';
import { PrismaService } from '../prisma/prisma.service';
import { OhlcCandleDto } from '../ohlc/ohlc.types';
import {
  SignalCheckItem,
  SignalInputData,
  SignalInterval,
  SignalNotebookAutomationStatus,
  SignalNotebookEntryDto,
  SignalNotebookOutcome,
  SignalNotebookPayload,
  SignalNotebookSummaryDto,
  SignalMarketStructure,
  SignalPerformanceStats,
  SignalTradePlan,
  TradingSignalConfidence,
  TradingSignalKind,
  TradingSignalResult,
} from './signal.types';

const TRADING_SIGNALS = {
  BUY_HIGH: 5,
  BUY_MEDIUM: 3,
  BUY_LOW: 1,
  SELL_HIGH: 5,
  SELL_MEDIUM: 3,
  SELL_LOW: 1,
  HOLD: 0,
} as const;

const SIGNAL_INTERVAL_CANDIDATES: ReadonlyArray<{
  interval: SignalInterval;
  limit: number;
  minCandles: number;
}> = [
  { interval: '1d', limit: 320, minCandles: 70 },
  { interval: '1h', limit: 320, minCandles: 110 },
  { interval: '15m', limit: 300, minCandles: 130 },
  { interval: '5m', limit: 280, minCandles: 140 },
  { interval: '1m', limit: 240, minCandles: 160 },
];

const SIGNAL_CACHE_TTL_MS = 10_000;
const SIGNAL_BUY_QUALITY_GATE = 80;
const SIGNAL_SELL_QUALITY_GATE = 82;
const SIGNAL_MIN_QUALITY_GAP = 14;
const SIGNAL_MIN_TREND_DISTANCE_PCT = 0.0022;
const SIGNAL_WHIPSAW_WINDOW_MS = 20 * 60 * 1000;
const SIGNAL_REVERSAL_OVERRIDE_QUALITY = 88;
const SIGNAL_REVERSAL_LOCK_HOURS = 48;
const SIGNAL_REVERSAL_FORCE_QUALITY = 92;
const PERFORMANCE_CACHE_TTL_MS = 5 * 60 * 1000;
const TARGET_RISK_MULTIPLIER = 2.2;
const MIN_TARGET_RISK_MULTIPLIER = 1.35;
const MIN_STOP_DISTANCE_PCT = 0.012;
const STRUCTURE_LEVEL_TOLERANCE_PCT = 0.006;
const STRUCTURE_MAX_LEVELS = 3;
const STRUCTURE_LOOKBACK_CANDLES = 180;
const NOTEBOOK_DEFAULT_LIMIT = 45;
const NOTEBOOK_MAX_LIMIT = 140;
const NEPAL_TIME_ZONE = 'Asia/Kathmandu';
const AUTO_NOTEBOOK_LIMIT = 70;
const AUTO_NOTEBOOK_REFRESH_MS = 4 * 60 * 1000;
const LIVE_PERSIST_THROTTLE_MS = 2 * 60 * 1000;
const NEPSE_OPEN_MINUTES = 11 * 60;
const NEPSE_CLOSE_MINUTES = 15 * 60;
const NEPSE_EVALUATE_AFTER_CLOSE_MINUTES = 15 * 60 + 5;

type MarketSessionState = 'OPEN' | 'POST_CLOSE' | 'CLOSED';

interface SignalNotebookRow {
  id: bigint;
  tradeDate: Date;
  symbol: string;
  signal: string;
  confidence: string;
  entryPrice: unknown;
  stopLoss: unknown;
  targetPrice: unknown;
  riskReward: unknown;
  qualityScore: unknown;
  reasons: unknown;
  requiredChecks: unknown;
  failedChecks: unknown;
  recommendedAction: string;
  generatedAt: Date;
  evaluatedAt: Date | null;
  closePrice: unknown;
  outcome: string;
  accuracyScore: unknown;
}

interface SignalOutcome {
  outcome: SignalNotebookOutcome;
  accuracyScore: number;
}

interface SignalCandleSelection {
  interval: SignalInterval;
  candles: OhlcCandleDto[];
}

interface PerformanceCacheItem {
  fetchedAt: number;
  stats: SignalPerformanceStats;
}

@Injectable()
export class SignalService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SignalService.name);
  private readonly signalCache = new Map<string, { fetchedAt: number; result: TradingSignalResult }>();
  private readonly performanceCache = new Map<string, PerformanceCacheItem>();
  private readonly stabilityCache = new Map<
    string,
    { signal: Exclude<TradingSignalKind, 'HOLD'>; qualityScore: number; at: number }
  >();
  private readonly lastLivePersistAt = new Map<string, number>();
  private autoNotebookTimer: NodeJS.Timeout | null = null;
  private autoNotebookRunning = false;

  constructor(
    private readonly ohlcService: OhlcService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    void this.runAutoNotebookCycle('startup');

    this.autoNotebookTimer = setInterval(() => {
      void this.runAutoNotebookCycle('interval');
    }, AUTO_NOTEBOOK_REFRESH_MS);
  }

  onModuleDestroy() {
    if (this.autoNotebookTimer) {
      clearInterval(this.autoNotebookTimer);
      this.autoNotebookTimer = null;
    }
  }

  async calculateSignal(symbol: string, options?: { persistNotebook?: boolean }): Promise<TradingSignalResult> {
    const shouldPersistNotebook = options?.persistNotebook ?? true;
    const normalizedSymbol = symbol.trim().toUpperCase();
    if (!normalizedSymbol) {
      throw new BadRequestException('Query param "symbol" is required.');
    }

    const now = Date.now();
    const cached = this.signalCache.get(normalizedSymbol);
    if (cached && now - cached.fetchedAt < SIGNAL_CACHE_TTL_MS) {
      if (shouldPersistNotebook) {
        await this.persistLiveDirectionalSignal(normalizedSymbol, cached.result);
      }

      return cached.result;
    }

    const selection = await this.loadBestSignalCandles(normalizedSymbol);
    const candles = selection.candles;

    if (!candles.length) {
      return this.buildNoDataSignal(
        'No candle history available for this symbol yet.',
        selection.interval,
        new Date(now).toISOString(),
      );
    }

    const closes = candles.map((candle) => candle.c);
    const highs = candles.map((candle) => candle.h);
    const lows = candles.map((candle) => candle.l);
    const volumes = candles.map((candle) => candle.v ?? 0);

    const ema8 = this.calculateEma(closes, 8);
    const ema21 = this.calculateEma(closes, 21);
    const ema20 = this.calculateEma(closes, 20);
    const ema50 = this.calculateEma(closes, 50);
    const rsi14 = this.calculateRsi(closes, 14);
    const vwap = this.calculateVwap(highs, lows, closes, volumes);
    const avgVolume20 = this.calculateSma(volumes, 20);
    const bollinger = this.calculateBollinger(closes, 20, 2);

    const currentIndex = candles.length - 1;
    const prevIndex = candles.length - 2;

    const data = this.buildSignalInput({
      close: closes[currentIndex],
      ema8: ema8[currentIndex],
      ema21: ema21[currentIndex],
      ema20: ema20[currentIndex],
      ema50: ema50[currentIndex],
      rsi14: rsi14[currentIndex],
      vwap: vwap[currentIndex],
      volume: volumes[currentIndex],
      avgVolume20: avgVolume20[currentIndex],
      bbLower: bollinger.lower[currentIndex],
      bbUpper: bollinger.upper[currentIndex],
    });

    if (!this.hasFiniteSignalInputs(data)) {
      return this.buildNoDataSignal(
        `Insufficient ${selection.interval} indicator history for reliable signal yet.`,
        selection.interval,
        new Date(now).toISOString(),
        data,
      );
    }

    const prevData =
      prevIndex >= 0
        ? this.buildSignalInput({
            close: closes[prevIndex],
            ema8: ema8[prevIndex],
            ema21: ema21[prevIndex],
            ema20: ema20[prevIndex],
            ema50: ema50[prevIndex],
            rsi14: rsi14[prevIndex],
            vwap: vwap[prevIndex],
            volume: volumes[prevIndex],
            avgVolume20: avgVolume20[prevIndex],
            bbLower: bollinger.lower[prevIndex],
            bbUpper: bollinger.upper[prevIndex],
          })
        : undefined;

    const structure = this.buildMarketStructure(
      candles,
      data.close,
      data.ema8,
      data.ema21,
    );

    const rawResult = this.calculateTradingSignal(
      data,
      prevData,
      structure,
      selection.interval,
      new Date(now).toISOString(),
    );

    const calibratedResult = await this.applyPerformanceCalibration(normalizedSymbol, rawResult);

    const stabilizedResult = this.applySignalStabilityFilter(normalizedSymbol, calibratedResult, now);
    const result = await this.applyNepseSwingGuard(normalizedSymbol, stabilizedResult);

    this.signalCache.set(normalizedSymbol, {
      fetchedAt: now,
      result,
    });

    if (shouldPersistNotebook) {
      await this.persistLiveDirectionalSignal(normalizedSymbol, result);
    }

    return result;
  }

  async generateDailyNotebook(limit?: number): Promise<SignalNotebookPayload> {
    const tradeDate = this.getNepalTradeDate();
    const universeLimit = this.normalizeNotebookLimit(limit);

    const universe = await this.prisma.price.findMany({
      where: { turnover: { not: null } },
      orderBy: [{ turnover: 'desc' }, { symbol: 'asc' }],
      take: universeLimit,
    });

    for (const row of universe) {
      try {
        const signal = await this.calculateSignal(row.symbol, { persistNotebook: false });
        await this.upsertNotebookEntry(tradeDate, row.symbol, signal);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Notebook generation skipped ${row.symbol}: ${message}`);
      }
    }

    return this.getNotebookByDate(tradeDate);
  }

  async evaluateTodayNotebookClose(): Promise<SignalNotebookPayload> {
    const tradeDate = this.getNepalTradeDate();
    const entries: SignalNotebookRow[] = await this.prisma.signalNotebookEntry.findMany({
      where: {
        tradeDate,
        evaluatedAt: null,
      },
      orderBy: { generatedAt: 'desc' },
    });

    if (!entries.length) {
      return this.getNotebookByDate(tradeDate);
    }

    const symbols = entries.map((entry: SignalNotebookRow) => entry.symbol);
    const priceRows = await this.prisma.price.findMany({
      where: {
        symbol: {
          in: symbols,
        },
      },
    });

    const latestBySymbol = new Map<string, number>();
    for (const row of priceRows) {
      latestBySymbol.set(row.symbol, this.toNumber(row.ltp));
    }

    const evaluatedAt = new Date();

    for (const entry of entries) {
      if (!this.isDirectionalSignal(entry.signal)) {
        continue;
      }

      const closePrice = latestBySymbol.get(entry.symbol);
      if (closePrice === undefined || !Number.isFinite(closePrice)) {
        continue;
      }

      const outcome = this.evaluateOutcome(
        entry.signal,
        this.toNumber(entry.entryPrice),
        this.toNumber(entry.stopLoss),
        this.toNumber(entry.targetPrice),
        closePrice,
      );

      await this.prisma.signalNotebookEntry.update({
        where: { id: entry.id },
        data: {
          evaluatedAt,
          closePrice,
          outcome: outcome.outcome,
          accuracyScore: outcome.accuracyScore,
        },
      });
    }

    return this.getNotebookByDate(tradeDate);
  }

  async getTodayNotebook(): Promise<SignalNotebookPayload> {
    const tradeDate = this.getNepalTradeDate();
    const sessionState = this.getMarketSessionState();

    if (sessionState === 'OPEN') {
      const notebook = await this.getNotebookByDate(tradeDate);
      const generatedAt = notebook.generatedAt ? Date.parse(notebook.generatedAt) : 0;
      const stale = !generatedAt || Date.now() - generatedAt > AUTO_NOTEBOOK_REFRESH_MS;

      if (stale) {
        return this.generateDailyNotebook(AUTO_NOTEBOOK_LIMIT);
      }

      return notebook;
    }

    if (sessionState === 'POST_CLOSE') {
      const notebook = await this.getNotebookByDate(tradeDate);
      if (notebook.summary.pendingCount > 0) {
        return this.evaluateTodayNotebookClose();
      }

      return notebook;
    }

    return this.getNotebookByDate(tradeDate);
  }

  private async runAutoNotebookCycle(origin: 'startup' | 'interval'): Promise<void> {
    if (this.autoNotebookRunning) {
      return;
    }

    this.autoNotebookRunning = true;

    try {
      const state = this.getMarketSessionState();

      if (state === 'OPEN') {
        await this.generateDailyNotebook(AUTO_NOTEBOOK_LIMIT);
        return;
      }

      if (state === 'POST_CLOSE') {
        await this.evaluateTodayNotebookClose();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Auto notebook cycle (${origin}) failed: ${message}`);
    } finally {
      this.autoNotebookRunning = false;
    }
  }

  private async persistLiveDirectionalSignal(symbol: string, signal: TradingSignalResult): Promise<void> {
    if (!this.isDirectionalSignal(signal.signal) || !signal.plan) {
      return;
    }

    if (this.getMarketSessionState() !== 'OPEN') {
      return;
    }

    const key = `${this.toIsoDate(this.getNepalTradeDate())}:${symbol}`;
    const now = Date.now();
    const lastPersistedAt = this.lastLivePersistAt.get(key) ?? 0;

    if (now - lastPersistedAt < LIVE_PERSIST_THROTTLE_MS) {
      return;
    }

    await this.upsertNotebookEntry(this.getNepalTradeDate(), symbol, signal);
    this.lastLivePersistAt.set(key, now);
  }

  private async upsertNotebookEntry(
    tradeDate: Date,
    symbol: string,
    signal: TradingSignalResult,
  ): Promise<void> {
    if (!this.isDirectionalSignal(signal.signal) || !signal.plan) {
      return;
    }

    await this.prisma.signalNotebookEntry.upsert({
      where: {
        tradeDate_symbol: {
          tradeDate,
          symbol,
        },
      },
      create: {
        tradeDate,
        symbol,
        signal: signal.signal,
        confidence: signal.confidence,
        entryPrice: signal.plan.entryPrice,
        stopLoss: signal.plan.stopLoss,
        targetPrice: signal.plan.targetPrice,
        riskReward: signal.plan.riskReward,
        qualityScore: signal.qualityScore,
        reasons: signal.reasons,
        requiredChecks: signal.requiredChecks
          .filter((item) => item.required)
          .map((item) => item.label),
        failedChecks: signal.failedChecks,
        recommendedAction: signal.recommendedAction,
        generatedAt: new Date(signal.generatedAt),
        evaluatedAt: null,
        closePrice: null,
        outcome: 'PENDING',
        accuracyScore: null,
      },
      update: {
        signal: signal.signal,
        confidence: signal.confidence,
        entryPrice: signal.plan.entryPrice,
        stopLoss: signal.plan.stopLoss,
        targetPrice: signal.plan.targetPrice,
        riskReward: signal.plan.riskReward,
        qualityScore: signal.qualityScore,
        reasons: signal.reasons,
        requiredChecks: signal.requiredChecks
          .filter((item) => item.required)
          .map((item) => item.label),
        failedChecks: signal.failedChecks,
        recommendedAction: signal.recommendedAction,
        generatedAt: new Date(signal.generatedAt),
      },
    });
  }

  private async loadBestSignalCandles(symbol: string): Promise<SignalCandleSelection> {
    let best: SignalCandleSelection = {
      interval: '1m',
      candles: [],
    };

    for (const candidate of SIGNAL_INTERVAL_CANDIDATES) {
      const candles = await this.ohlcService.getCandles({
        symbol,
        interval: candidate.interval,
        limit: candidate.limit,
      });

      if (candles.length > best.candles.length) {
        best = {
          interval: candidate.interval,
          candles,
        };
      }

      if (candles.length >= candidate.minCandles) {
        return {
          interval: candidate.interval,
          candles,
        };
      }
    }

    return best;
  }

  private buildNoDataSignal(
    reason: string,
    interval: SignalInterval,
    generatedAt: string,
    data?: SignalInputData,
  ): TradingSignalResult {
    return {
      signal: 'HOLD',
      confidence: 'LOW',
      buyScore: 0,
      sellScore: 0,
      strength: 0,
      reasons: [reason],
      recommendedAction: 'WAIT',
      qualityScore: 0,
      plan: null,
      requiredChecks: [],
      failedChecks: [],
      priceContext: {
        close: this.toFiniteOrZero(data?.close),
        ema8: this.toFiniteOrZero(data?.ema8),
        ema21: this.toFiniteOrZero(data?.ema21),
        ema20: this.toFiniteOrZero(data?.ema20),
        ema50: this.toFiniteOrZero(data?.ema50),
        rsi14: this.toFiniteOrZero(data?.rsi14),
        vwap: this.toFiniteOrZero(data?.vwap),
        volume: this.toFiniteOrZero(data?.volume),
        avgVolume20: this.toFiniteOrZero(data?.avgVolume20),
      },
      structure: {
        trendBias: 'RANGE',
        nearestSupport: null,
        nearestResistance: null,
        supportLevels: [],
        resistanceLevels: [],
      },
      performance: {
        sampleSize: 0,
        winRatePct: 0,
        averageAccuracyPct: 0,
        recentWinRatePct: 0,
        calibrationAdjustment: 0,
        note: 'No evaluated history yet for this symbol.',
      },
      interval,
      generatedAt,
    };
  }

  private hasFiniteSignalInputs(data: SignalInputData): boolean {
    return [data.ema8, data.ema21, data.ema20, data.ema50, data.rsi14, data.close, data.vwap].every(
      (value) => Number.isFinite(value),
    );
  }

  private calculateTradingSignal(
    data: SignalInputData,
    prevData: SignalInputData | undefined,
    structure: SignalMarketStructure,
    interval: SignalInterval,
    generatedAt: string,
  ): TradingSignalResult {
    let buyScore = 0;
    let sellScore = 0;
    const buyReasons: string[] = [];
    const sellReasons: string[] = [];
    const hasValidBands =
      Number.isFinite(data.bbLower) && Number.isFinite(data.bbUpper) && data.bbUpper > data.bbLower;
    const trendDistancePct = Math.abs(data.ema8 - data.ema21) / Math.max(data.close, 0.0001);

    const emaBull = data.ema8 > data.ema21;
    const emaBear = data.ema8 < data.ema21;

    if (emaBull) {
      buyScore += 2;
      buyReasons.push('EMA8 > EMA21');

      if (prevData ? prevData.ema8 <= prevData.ema21 : false) {
        buyScore += 1;
        buyReasons.push('Fresh bullish crossover');
      }
    }

    if (data.ema20 > data.ema50) {
      buyScore += 1;
      buyReasons.push('EMA20 > EMA50 (uptrend)');
    }

    if (data.rsi14 >= 34 && data.rsi14 <= 74) {
      buyScore += 1;
      buyReasons.push('RSI neutral-bullish');
    }

    if (data.close > data.vwap) {
      buyScore += 1;
      buyReasons.push('Price > VWAP');
    }

    if (data.avgVolume20 > 0 && data.volume > data.avgVolume20 * 1.2) {
      buyScore += 1;
      buyReasons.push('Volume confirmation');
    }

    if (hasValidBands) {
      if (data.close <= data.bbLower) {
        buyScore += 2;
        buyReasons.push('Oversold bounce');
      } else if (data.close >= data.bbUpper) {
        sellScore += 2;
        sellReasons.push('Overbought rejection');
      }
    }

    if (emaBear) {
      sellScore += 2;
      sellReasons.push('EMA8 < EMA21');

      if (prevData ? prevData.ema8 >= prevData.ema21 : false) {
        sellScore += 1;
        sellReasons.push('Fresh bearish crossover');
      }
    }

    if (data.ema20 < data.ema50) {
      sellScore += 1;
      sellReasons.push('EMA20 < EMA50 (downtrend)');
    }

    if (data.rsi14 >= 26 && data.rsi14 <= 68) {
      sellScore += 1;
      sellReasons.push('RSI neutral-bearish');
    }

    if (data.close < data.vwap) {
      sellScore += 1;
      sellReasons.push('Price < VWAP');
    }

    if (data.avgVolume20 > 0 && data.volume > data.avgVolume20 * 1.2) {
      sellScore += 1;
      sellReasons.push('Volume confirmation');
    }

    const buyChecks: SignalCheckItem[] = [
      {
        key: 'ema_fast_trend',
        label: 'EMA8 is above EMA21',
        required: true,
        passed: emaBull,
        weight: 22,
      },
      {
        key: 'ema_swing_trend',
        label: 'EMA20 is above EMA50',
        required: true,
        passed: data.ema20 >= data.ema50,
        weight: 16,
      },
      {
        key: 'rsi_buy_zone',
        label: 'RSI is in bullish zone (40-68)',
        required: true,
        passed: data.rsi14 >= 40 && data.rsi14 <= 68,
        weight: 16,
      },
      {
        key: 'price_above_vwap',
        label: 'Price is above VWAP',
        required: true,
        passed: data.close > data.vwap,
        weight: 18,
      },
      {
        key: 'price_above_ema20',
        label: 'Price is above EMA20',
        required: true,
        passed: data.close >= data.ema20,
        weight: 14,
      },
      {
        key: 'trend_distance_buy',
        label: 'EMA8/EMA21 separation confirms trend strength',
        required: true,
        passed: trendDistancePct >= SIGNAL_MIN_TREND_DISTANCE_PCT,
        weight: 12,
      },
      {
        key: 'previous_bar_alignment_buy',
        label: 'Previous bar also aligned bullish',
        required: true,
        passed: prevData ? prevData.ema8 > prevData.ema21 && prevData.close > prevData.vwap : true,
        weight: 10,
      },
      {
        key: 'volume_confirmation',
        label: 'Volume confirms with 20-period average',
        required: false,
        passed: data.avgVolume20 > 0 && data.volume >= data.avgVolume20 * 1.05,
        weight: 14,
      },
      {
        key: 'not_upper_band_exhausted',
        label: 'Price is not overextended near upper Bollinger band',
        required: false,
        passed: !hasValidBands || data.close < data.bbUpper * 0.995,
        weight: 14,
      },
    ];

    const sellChecks: SignalCheckItem[] = [
      {
        key: 'ema_fast_trend_down',
        label: 'EMA8 is below EMA21',
        required: true,
        passed: emaBear,
        weight: 22,
      },
      {
        key: 'ema_swing_trend_down',
        label: 'EMA20 is below EMA50',
        required: true,
        passed: data.ema20 <= data.ema50,
        weight: 16,
      },
      {
        key: 'rsi_sell_zone',
        label: 'RSI is in bearish zone (32-60)',
        required: true,
        passed: data.rsi14 >= 32 && data.rsi14 <= 60,
        weight: 16,
      },
      {
        key: 'price_below_vwap',
        label: 'Price is below VWAP',
        required: true,
        passed: data.close < data.vwap,
        weight: 18,
      },
      {
        key: 'price_below_ema20',
        label: 'Price is below EMA20',
        required: true,
        passed: data.close <= data.ema20,
        weight: 14,
      },
      {
        key: 'trend_distance_sell',
        label: 'EMA8/EMA21 separation confirms downtrend strength',
        required: true,
        passed: trendDistancePct >= SIGNAL_MIN_TREND_DISTANCE_PCT,
        weight: 12,
      },
      {
        key: 'previous_bar_alignment_sell',
        label: 'Previous bar also aligned bearish',
        required: true,
        passed: prevData ? prevData.ema8 < prevData.ema21 && prevData.close < prevData.vwap : true,
        weight: 10,
      },
      {
        key: 'volume_confirmation_down',
        label: 'Volume confirms with 20-period average',
        required: false,
        passed: data.avgVolume20 > 0 && data.volume >= data.avgVolume20 * 1.05,
        weight: 14,
      },
      {
        key: 'not_lower_band_exhausted',
        label: 'Price is not overextended near lower Bollinger band',
        required: false,
        passed: !hasValidBands || data.close > data.bbLower * 1.005,
        weight: 14,
      },
    ];

    const buyQuality = this.calculateQualityScore(buyChecks);
    const sellQuality = this.calculateQualityScore(sellChecks);

    const hasBuyConfluence = buyChecks
      .filter((item) => item.required)
      .every((item) => item.passed);

    const hasSellConfluence = sellChecks
      .filter((item) => item.required)
      .every((item) => item.passed);

    const qualityGapBuy = buyQuality - sellQuality;
    const qualityGapSell = sellQuality - buyQuality;

    const isStrongBuy =
      hasBuyConfluence &&
      buyScore >= TRADING_SIGNALS.BUY_MEDIUM &&
      buyScore >= sellScore + 2 &&
      buyQuality >= SIGNAL_BUY_QUALITY_GATE &&
      qualityGapBuy >= SIGNAL_MIN_QUALITY_GAP;

    const isStrongSell =
      hasSellConfluence &&
      sellScore >= TRADING_SIGNALS.SELL_MEDIUM &&
      sellScore >= buyScore + 2 &&
      sellQuality >= SIGNAL_SELL_QUALITY_GATE &&
      qualityGapSell >= SIGNAL_MIN_QUALITY_GAP;

    const signal: TradingSignalKind = isStrongBuy ? 'BUY' : isStrongSell ? 'SELL' : 'HOLD';

    const strength = buyScore > sellScore ? buyScore : sellScore;
    const selectedChecks =
      signal === 'BUY'
        ? buyChecks
        : signal === 'SELL'
          ? sellChecks
          : buyScore >= sellScore
            ? buyChecks
            : sellChecks;

    const qualityScore =
      signal === 'BUY'
        ? buyQuality
        : signal === 'SELL'
          ? sellQuality
          : Math.max(buyQuality, sellQuality);

    const confidence = this.deriveConfidence(signal, qualityScore, strength);

    const failedChecks = selectedChecks
      .filter((item) => item.required && !item.passed)
      .map((item) => item.label);

    const reasons = this.buildReasons(
      signal,
      buyReasons,
      sellReasons,
      failedChecks,
      buyQuality,
      sellQuality,
      structure,
    );

    const plan = signal === 'HOLD' ? null : this.buildTradePlan(signal, data, structure);

    return {
      signal,
      confidence,
      buyScore,
      sellScore,
      strength,
      reasons: reasons.length ? reasons.slice(0, 5) : ['No strong confluence yet.'],
      recommendedAction: this.getAction(signal, strength, qualityScore),
      qualityScore,
      plan,
      requiredChecks: selectedChecks,
      failedChecks,
      priceContext: {
        close: this.round4(data.close),
        ema8: this.round4(data.ema8),
        ema21: this.round4(data.ema21),
        ema20: this.round4(data.ema20),
        ema50: this.round4(data.ema50),
        rsi14: this.round4(data.rsi14),
        vwap: this.round4(data.vwap),
        volume: this.round4(data.volume),
        avgVolume20: this.round4(data.avgVolume20),
      },
      structure,
      performance: {
        sampleSize: 0,
        winRatePct: 0,
        averageAccuracyPct: 0,
        recentWinRatePct: 0,
        calibrationAdjustment: 0,
        note: 'Performance calibration pending history load.',
      },
      interval,
      generatedAt,
    };
  }

  private applySignalStabilityFilter(
    symbol: string,
    result: TradingSignalResult,
    now: number,
  ): TradingSignalResult {
    if (result.signal === 'HOLD') {
      return result;
    }

    const previous = this.stabilityCache.get(symbol);
    if (!previous) {
      this.stabilityCache.set(symbol, {
        signal: result.signal,
        qualityScore: result.qualityScore,
        at: now,
      });

      return result;
    }

    const flippedDirection = previous.signal !== result.signal;
    if (!flippedDirection) {
      this.stabilityCache.set(symbol, {
        signal: result.signal,
        qualityScore: result.qualityScore,
        at: now,
      });

      return result;
    }

    const withinWhipsawWindow = now - previous.at <= SIGNAL_WHIPSAW_WINDOW_MS;
    const reversalStrength = Math.abs(result.buyScore - result.sellScore);

    if (
      withinWhipsawWindow &&
      result.qualityScore < SIGNAL_REVERSAL_OVERRIDE_QUALITY &&
      reversalStrength < 4
    ) {
      return {
        ...result,
        signal: 'HOLD',
        confidence: 'LOW',
        recommendedAction: 'WAIT',
        plan: null,
        reasons: [
          `Whipsaw filter: recent ${previous.signal} bias not invalidated strongly enough yet.`,
          ...result.reasons.slice(0, 2),
        ],
        failedChecks: [...result.failedChecks, 'Stability filter blocked fast reversal'],
      };
    }

    this.stabilityCache.set(symbol, {
      signal: result.signal,
      qualityScore: result.qualityScore,
      at: now,
    });

    return result;
  }

  private async applyNepseSwingGuard(
    symbol: string,
    result: TradingSignalResult,
  ): Promise<TradingSignalResult> {
    if (result.signal === 'HOLD') {
      return result;
    }

    const latest = await this.prisma.signalNotebookEntry.findFirst({
      where: {
        symbol,
        signal: { in: ['BUY', 'SELL'] },
      },
      orderBy: { generatedAt: 'desc' },
      select: {
        signal: true,
        generatedAt: true,
      },
    });

    if (!latest) {
      return result;
    }

    const hoursSinceLastSignal = (Date.now() - latest.generatedAt.getTime()) / (1000 * 60 * 60);
    const reversalDetected = latest.signal !== result.signal;

    if (
      reversalDetected &&
      hoursSinceLastSignal < SIGNAL_REVERSAL_LOCK_HOURS &&
      result.qualityScore < SIGNAL_REVERSAL_FORCE_QUALITY
    ) {
      return {
        ...result,
        signal: 'HOLD',
        confidence: 'LOW',
        plan: null,
        recommendedAction: 'WAIT FOR NEXT SESSION CLOSE CONFIRMATION',
        reasons: [
          `Swing guard blocked rapid ${latest.signal} -> ${result.signal} reversal within ${SIGNAL_REVERSAL_LOCK_HOURS}h window.`,
          'NEPSE is treated as non-intraday swing flow, so opposite signal requires stronger confirmation.',
          ...result.reasons.slice(0, 2),
        ],
        failedChecks: [...result.failedChecks, 'NEPSE swing reversal lock'],
      };
    }

    return result;
  }

  private async applyPerformanceCalibration(
    symbol: string,
    result: TradingSignalResult,
  ): Promise<TradingSignalResult> {
    const stats = await this.getPerformanceStats(symbol);

    if (result.signal === 'HOLD') {
      return {
        ...result,
        performance: stats,
      };
    }

    const calibratedQuality = this.clamp(
      this.round2(result.qualityScore + stats.calibrationAdjustment),
      0,
      100,
    );

    const confidence = this.deriveConfidence(result.signal, calibratedQuality, result.strength);
    const minimumGate = result.signal === 'BUY' ? SIGNAL_BUY_QUALITY_GATE : SIGNAL_SELL_QUALITY_GATE;

    if (
      stats.sampleSize >= 10 &&
      stats.calibrationAdjustment < 0 &&
      calibratedQuality < minimumGate
    ) {
      return {
        ...result,
        signal: 'HOLD',
        confidence: 'LOW',
        qualityScore: calibratedQuality,
        plan: null,
        recommendedAction: 'WAIT',
        reasons: [
          `Historical calibration blocked ${result.signal}: recent prediction consistency is weak for this symbol.`,
          ...result.reasons.slice(0, 2),
        ],
        failedChecks: [...result.failedChecks, 'Performance calibration gate (symbol-level)'],
        performance: stats,
      };
    }

    return {
      ...result,
      confidence,
      qualityScore: calibratedQuality,
      recommendedAction: this.getAction(result.signal, result.strength, calibratedQuality),
      reasons: [
        ...result.reasons,
        `Model tracking: win ${stats.winRatePct.toFixed(1)}%, avg accuracy ${stats.averageAccuracyPct.toFixed(1)}% (${stats.sampleSize} evaluated).`,
      ].slice(0, 6),
      performance: stats,
    };
  }

  private async getPerformanceStats(symbol: string): Promise<SignalPerformanceStats> {
    const now = Date.now();
    const cached = this.performanceCache.get(symbol);
    if (cached && now - cached.fetchedAt < PERFORMANCE_CACHE_TTL_MS) {
      return cached.stats;
    }

    const rows: Array<{ outcome: string; accuracyScore: unknown }> = await this.prisma.signalNotebookEntry.findMany({
      where: {
        symbol,
        evaluatedAt: { not: null },
        accuracyScore: { not: null },
      },
      orderBy: { generatedAt: 'desc' },
      take: 60,
      select: {
        outcome: true,
        accuracyScore: true,
      },
    });

    const sampleSize = rows.length;
    if (!sampleSize) {
      const stats: SignalPerformanceStats = {
        sampleSize: 0,
        winRatePct: 0,
        averageAccuracyPct: 0,
        recentWinRatePct: 0,
        calibrationAdjustment: 0,
        note: 'No evaluated history yet for this symbol.',
      };

      this.performanceCache.set(symbol, { fetchedAt: now, stats });
      return stats;
    }

    const wins = rows.filter((row: { outcome: string }) => this.isWinningOutcome(row.outcome)).length;
    const winRatePct = (wins / sampleSize) * 100;

    const avgAccuracy =
      rows.reduce((sum: number, row: { accuracyScore: unknown }) => sum + this.toNumber(row.accuracyScore), 0) /
      sampleSize;

    const recentRows = rows.slice(0, Math.min(10, sampleSize));
    const recentWins = recentRows.filter((row: { outcome: string }) => this.isWinningOutcome(row.outcome)).length;
    const recentWinRatePct = recentRows.length > 0 ? (recentWins / recentRows.length) * 100 : winRatePct;

    const rawAdjustment =
      sampleSize < 8
        ? 0
        : (recentWinRatePct - 50) / 6 + (avgAccuracy - 50) / 16;
    const calibrationAdjustment = this.round2(this.clamp(rawAdjustment, -10, 8));

    const note =
      sampleSize < 8
        ? 'Calibration inactive: waiting for larger evaluated sample.'
        : calibrationAdjustment >= 2
          ? 'Historical performance supports normal aggression.'
          : calibrationAdjustment <= -2
            ? 'Historical performance weak; signal gate tightened for protection.'
            : 'Historical performance neutral; standard quality gate applied.';

    const stats: SignalPerformanceStats = {
      sampleSize,
      winRatePct: this.round2(winRatePct),
      averageAccuracyPct: this.round2(avgAccuracy),
      recentWinRatePct: this.round2(recentWinRatePct),
      calibrationAdjustment,
      note,
    };

    this.performanceCache.set(symbol, { fetchedAt: now, stats });
    return stats;
  }

  private isWinningOutcome(outcome: string): boolean {
    return outcome === 'HIT_TARGET' || outcome === 'MOVED_IN_FAVOR';
  }

  private buildMarketStructure(
    candles: OhlcCandleDto[],
    currentClose: number,
    ema8: number,
    ema21: number,
  ): SignalMarketStructure {
    const lookback = candles.slice(Math.max(0, candles.length - STRUCTURE_LOOKBACK_CANDLES));

    if (lookback.length < 12 || !Number.isFinite(currentClose) || currentClose <= 0) {
      return {
        trendBias: ema8 > ema21 ? 'BULLISH' : ema8 < ema21 ? 'BEARISH' : 'RANGE',
        nearestSupport: null,
        nearestResistance: null,
        supportLevels: [],
        resistanceLevels: [],
      };
    }

    const pivotLows: number[] = [];
    const pivotHighs: number[] = [];

    for (let i = 2; i < lookback.length - 2; i += 1) {
      const low = lookback[i].l;
      const high = lookback[i].h;

      const isPivotLow =
        low <= lookback[i - 1].l &&
        low <= lookback[i - 2].l &&
        low < lookback[i + 1].l &&
        low < lookback[i + 2].l;

      const isPivotHigh =
        high >= lookback[i - 1].h &&
        high >= lookback[i - 2].h &&
        high > lookback[i + 1].h &&
        high > lookback[i + 2].h;

      if (isPivotLow) {
        pivotLows.push(low);
      }

      if (isPivotHigh) {
        pivotHighs.push(high);
      }
    }

    const supportLevels = this.clusterStructureLevels(pivotLows, currentClose, 'support');
    const resistanceLevels = this.clusterStructureLevels(pivotHighs, currentClose, 'resistance');

    const nearestSupport = supportLevels
      .filter((level) => level.price <= currentClose)
      .sort((a, b) => b.price - a.price)[0]?.price ?? null;

    const nearestResistance = resistanceLevels
      .filter((level) => level.price >= currentClose)
      .sort((a, b) => a.price - b.price)[0]?.price ?? null;

    const trendBias = ema8 > ema21 ? 'BULLISH' : ema8 < ema21 ? 'BEARISH' : 'RANGE';

    return {
      trendBias,
      nearestSupport: nearestSupport === null ? null : this.round4(nearestSupport),
      nearestResistance: nearestResistance === null ? null : this.round4(nearestResistance),
      supportLevels,
      resistanceLevels,
    };
  }

  private clusterStructureLevels(
    levels: number[],
    currentClose: number,
    type: 'support' | 'resistance',
  ): Array<{ price: number; touches: number; distancePct: number }> {
    if (!levels.length || !Number.isFinite(currentClose) || currentClose <= 0) {
      return [];
    }

    const sorted = [...levels].sort((a, b) => a - b);
    const groups: Array<{ sum: number; count: number }> = [];

    for (const level of sorted) {
      const last = groups[groups.length - 1];
      if (!last) {
        groups.push({ sum: level, count: 1 });
        continue;
      }

      const mean = last.sum / last.count;
      const tolerance = Math.max(mean * STRUCTURE_LEVEL_TOLERANCE_PCT, currentClose * 0.0025);

      if (Math.abs(level - mean) <= tolerance) {
        last.sum += level;
        last.count += 1;
      } else {
        groups.push({ sum: level, count: 1 });
      }
    }

    const clustered = groups
      .map((group) => {
        const price = group.sum / group.count;
        return {
          price,
          touches: group.count,
          distancePct: Math.abs((price - currentClose) / currentClose) * 100,
        };
      })
      .filter((level) => (type === 'support' ? level.price <= currentClose * 1.002 : level.price >= currentClose * 0.998))
      .sort((a, b) => {
        if (type === 'support') {
          return b.price - a.price;
        }

        return a.price - b.price;
      })
      .slice(0, STRUCTURE_MAX_LEVELS)
      .map((level) => ({
        price: this.round4(level.price),
        touches: level.touches,
        distancePct: this.round2(level.distancePct),
      }));

    return clustered;
  }

  private buildReasons(
    signal: TradingSignalKind,
    buyReasons: string[],
    sellReasons: string[],
    failedChecks: string[],
    buyQuality: number,
    sellQuality: number,
    structure: SignalMarketStructure,
  ): string[] {
    const supportText =
      structure.nearestSupport !== null ? `Nearest support ${this.round4(structure.nearestSupport)}` : 'Support still forming';
    const resistanceText =
      structure.nearestResistance !== null
        ? `Nearest resistance ${this.round4(structure.nearestResistance)}`
        : 'Resistance still forming';

    if (signal === 'BUY') {
      return [
        ...buyReasons,
        `Quality score ${buyQuality.toFixed(1)}% passed minimum execution gate.`,
        `${supportText}; ${resistanceText}.`,
        'Use plan levels and only execute if risk controls are respected.',
      ];
    }

    if (signal === 'SELL') {
      return [
        ...sellReasons,
        `Quality score ${sellQuality.toFixed(1)}% passed minimum execution gate.`,
        `${supportText}; ${resistanceText}.`,
        'NEPSE cash market context: SELL means exit/reduce existing holdings, not short selling.',
      ];
    }

    if (failedChecks.length) {
      return [
        `Signal blocked: ${failedChecks.join('; ')}.`,
        `Buy quality ${buyQuality.toFixed(1)}% vs Sell quality ${sellQuality.toFixed(1)}%.`,
        'Wait for full confirmation before taking directional exposure.',
      ];
    }

    return [
      'No directional edge above quality threshold yet.',
      `Buy quality ${buyQuality.toFixed(1)}% vs Sell quality ${sellQuality.toFixed(1)}%.`,
      'Stand by for stronger trend, momentum, and VWAP alignment.',
    ];
  }

  private getAction(signal: TradingSignalKind, strength: number, qualityScore: number): string {
    if (signal === 'HOLD') return 'WAIT';

    const actions = {
      HIGH:
        signal === 'BUY'
          ? 'PLAN BUY SWING ENTRY (STAGED), REVIEW AT SESSION CLOSE'
          : 'PLAN EXIT / REDUCE HOLDINGS (STAGED), REVIEW AT SESSION CLOSE',
      MEDIUM:
        signal === 'BUY'
          ? 'WATCHLIST BUY SETUP, ENTER ONLY WITH STRICT RISK'
          : 'WATCHLIST EXIT SETUP, REDUCE RISK IF PRICE WEAKENS',
      LOW:
        signal === 'BUY'
          ? 'WAIT FOR CLEANER BUY CONFIRMATION'
          : 'WAIT FOR CLEANER EXIT CONFIRMATION',
    };

    if (qualityScore >= 80 || strength >= 5) {
      return actions.HIGH;
    }

    if (qualityScore >= 65 || strength >= 3) {
      return actions.MEDIUM;
    }

    return actions.LOW;
  }

  private deriveConfidence(
    signal: TradingSignalKind,
    qualityScore: number,
    strength: number,
  ): TradingSignalConfidence {
    if (signal === 'HOLD') return 'LOW';

    if (qualityScore >= 82 || strength >= TRADING_SIGNALS.BUY_HIGH) {
      return 'HIGH';
    }

    if (qualityScore >= 68 || strength >= TRADING_SIGNALS.BUY_MEDIUM) {
      return 'MEDIUM';
    }

    return 'LOW';
  }

  private calculateQualityScore(checks: SignalCheckItem[]): number {
    const totalWeight = checks.reduce((sum, item) => sum + item.weight, 0);
    if (totalWeight <= 0) return 0;

    const passedWeight = checks
      .filter((item) => item.passed)
      .reduce((sum, item) => sum + item.weight, 0);

    return this.round2((passedWeight / totalWeight) * 100);
  }

  private buildTradePlan(
    signal: Exclude<TradingSignalKind, 'HOLD'>,
    data: SignalInputData,
    structure: SignalMarketStructure,
  ): SignalTradePlan {
    const hasValidBands =
      Number.isFinite(data.bbLower) && Number.isFinite(data.bbUpper) && data.bbUpper > data.bbLower;

    const halfBandRange = hasValidBands
      ? Math.max((data.bbUpper - data.bbLower) / 2, data.close * 0.01)
      : data.close * 0.025;

    const minimumRisk = data.close * MIN_STOP_DISTANCE_PCT;
    const entryPrice = data.close;

    if (signal === 'BUY') {
      const baseSupport =
        structure.nearestSupport ??
        Math.min(data.ema21, data.ema20, data.vwap, entryPrice - halfBandRange * 0.75);

      const structuralStop = Math.min(
        baseSupport * (1 - 0.0035),
        data.ema21 * (1 - 0.002),
        entryPrice - halfBandRange * 0.6,
      );

      const riskPerShare = Math.max(minimumRisk, entryPrice - structuralStop);
      const stopLoss = entryPrice - riskPerShare;

      const tp1Base =
        structure.nearestResistance && structure.nearestResistance > entryPrice
          ? structure.nearestResistance
          : entryPrice + riskPerShare * MIN_TARGET_RISK_MULTIPLIER;
      const takeProfit1 = Math.max(tp1Base, entryPrice + riskPerShare * MIN_TARGET_RISK_MULTIPLIER);

      const nextResistance = structure.resistanceLevels.find((level) => level.price > takeProfit1 * 1.003)?.price;
      const tp2Base = nextResistance ?? entryPrice + riskPerShare * TARGET_RISK_MULTIPLIER;
      const takeProfit2 = Math.max(tp2Base, takeProfit1 + riskPerShare * 0.55);
      const targetPrice = takeProfit2;

      const rewardPerShare = targetPrice - entryPrice;
      const trailingStop = Math.max(stopLoss, entryPrice + (takeProfit1 - entryPrice) * 0.35);

      return {
        entryPrice: this.round4(entryPrice),
        stopLoss: this.round4(stopLoss),
        targetPrice: this.round4(targetPrice),
        takeProfit1: this.round4(takeProfit1),
        takeProfit2: this.round4(takeProfit2),
        trailingStop: this.round4(trailingStop),
        riskPerShare: this.round4(riskPerShare),
        rewardPerShare: this.round4(rewardPerShare),
        riskReward: this.round2(rewardPerShare / riskPerShare),
        expectedMovePct: this.round2((rewardPerShare / entryPrice) * 100),
        invalidation: `Invalidate BUY if price closes below ${this.round4(stopLoss)} and loses support control.`,
        primaryExitRule: `Take partial around ${this.round4(takeProfit1)} (first resistance), trail remainder toward ${this.round4(takeProfit2)}.`,
        exitRationale:
          'Targets are anchored to resistance structure. Lock gains near first resistance, then trail if momentum persists.',
      };
    }

    const baseResistance =
      structure.nearestResistance ??
      Math.max(data.ema21, data.ema20, data.vwap, entryPrice + halfBandRange * 0.75);
    const riskLine = Math.max(baseResistance * 1.0035, entryPrice + minimumRisk);
    const riskPerShare = Math.max(minimumRisk, riskLine - entryPrice);

    const support1Base =
      structure.nearestSupport && structure.nearestSupport < entryPrice
        ? structure.nearestSupport
        : entryPrice - riskPerShare * MIN_TARGET_RISK_MULTIPLIER;
    const takeProfit1 = Math.min(support1Base, entryPrice - riskPerShare * MIN_TARGET_RISK_MULTIPLIER);

    const deeperSupport = structure.supportLevels.find((level) => level.price < takeProfit1 * 0.997)?.price;
    const support2Base = deeperSupport ?? entryPrice - riskPerShare * TARGET_RISK_MULTIPLIER;
    const takeProfit2 = Math.min(support2Base, takeProfit1 - riskPerShare * 0.55);
    const targetPrice = Math.max(0.01, takeProfit2);

    const rewardPerShare = entryPrice - targetPrice;
    const trailingStop = Math.min(riskLine, entryPrice + riskPerShare * 0.45);

    return {
      entryPrice: this.round4(entryPrice),
      stopLoss: this.round4(riskLine),
      targetPrice: this.round4(targetPrice),
      takeProfit1: this.round4(takeProfit1),
      takeProfit2: this.round4(targetPrice),
      trailingStop: this.round4(trailingStop),
      riskPerShare: this.round4(riskPerShare),
      rewardPerShare: this.round4(rewardPerShare),
      riskReward: this.round2(rewardPerShare / riskPerShare),
      expectedMovePct: this.round2((rewardPerShare / entryPrice) * 100),
      invalidation: `Invalidate SELL-exit if price reclaims ${this.round4(riskLine)} and trend control returns bullish.`,
      primaryExitRule: `Reduce near ${this.round4(takeProfit1)} support, and de-risk deeper toward ${this.round4(targetPrice)} if pressure persists.`,
      exitRationale:
        'SELL in NEPSE means exit/reduce existing holdings. Support levels define staged exits rather than short entries.',
    };
  }

  private evaluateOutcome(
    signal: Exclude<TradingSignalKind, 'HOLD'>,
    entryPrice: number,
    stopLoss: number,
    targetPrice: number,
    closePrice: number,
  ): SignalOutcome {
    if (signal === 'BUY') {
      if (closePrice >= targetPrice) {
        return { outcome: 'HIT_TARGET', accuracyScore: 100 };
      }

      if (closePrice <= stopLoss) {
        return { outcome: 'HIT_STOP', accuracyScore: 0 };
      }

      if (closePrice > entryPrice) {
        return { outcome: 'MOVED_IN_FAVOR', accuracyScore: 70 };
      }

      if (closePrice < entryPrice) {
        return { outcome: 'MOVED_AGAINST', accuracyScore: 30 };
      }

      return { outcome: 'FLAT', accuracyScore: 50 };
    }

    if (closePrice <= targetPrice) {
      return { outcome: 'HIT_TARGET', accuracyScore: 100 };
    }

    if (closePrice >= stopLoss) {
      return { outcome: 'HIT_STOP', accuracyScore: 0 };
    }

    if (closePrice < entryPrice) {
      return { outcome: 'MOVED_IN_FAVOR', accuracyScore: 70 };
    }

    if (closePrice > entryPrice) {
      return { outcome: 'MOVED_AGAINST', accuracyScore: 30 };
    }

    return { outcome: 'FLAT', accuracyScore: 50 };
  }

  private async getNotebookByDate(tradeDate: Date): Promise<SignalNotebookPayload> {
    const rows: SignalNotebookRow[] = await this.prisma.signalNotebookEntry.findMany({
      where: { tradeDate },
      orderBy: [{ qualityScore: 'desc' }, { generatedAt: 'desc' }],
    });

    const entries: SignalNotebookEntryDto[] = rows
      .filter((row: SignalNotebookRow) => this.isDirectionalSignal(row.signal))
      .map((row: SignalNotebookRow) => ({
        id: Number(row.id),
        tradeDate: this.toIsoDate(row.tradeDate),
        symbol: row.symbol,
        signal: row.signal as Exclude<TradingSignalKind, 'HOLD'>,
        confidence: this.normalizeConfidence(row.confidence),
        entryPrice: this.toNumber(row.entryPrice),
        stopLoss: this.toNumber(row.stopLoss),
        targetPrice: this.toNumber(row.targetPrice),
        riskReward: this.toNumber(row.riskReward),
        qualityScore: this.toNumber(row.qualityScore),
        reasons: this.toStringArray(row.reasons),
        requiredChecks: this.toStringArray(row.requiredChecks),
        failedChecks: this.toStringArray(row.failedChecks),
        recommendedAction: row.recommendedAction,
        generatedAt: row.generatedAt.toISOString(),
        evaluatedAt: row.evaluatedAt ? row.evaluatedAt.toISOString() : null,
        closePrice: row.closePrice === null ? null : this.toNumber(row.closePrice),
        outcome: this.normalizeOutcome(row.outcome),
        accuracyScore: row.accuracyScore === null ? null : this.toNumber(row.accuracyScore),
      }));

    const summary = this.buildNotebookSummary(entries);
    const generatedAt = rows.length
      ? new Date(Math.max(...rows.map((row: SignalNotebookRow) => row.generatedAt.getTime()))).toISOString()
      : null;

    const evaluatedRows = rows.filter((row: SignalNotebookRow) => row.evaluatedAt !== null);
    const evaluatedAt = evaluatedRows.length
      ? new Date(
          Math.max(
            ...evaluatedRows.map((row: SignalNotebookRow) =>
              row.evaluatedAt ? row.evaluatedAt.getTime() : 0,
            ),
          ),
        ).toISOString()
      : null;

    return {
      tradeDate: this.toIsoDate(tradeDate),
      generatedAt,
      evaluatedAt,
      automation: this.buildAutomationStatus(),
      summary,
      entries,
    };
  }

  private buildAutomationStatus(): SignalNotebookAutomationStatus {
    const state = this.getMarketSessionState();

    if (state === 'OPEN') {
      return {
        sessionState: state,
        autoMode: true,
        nextAction: 'Auto-generate and refresh today notebook',
        note: 'Notebook entries are updated automatically during market session.',
      };
    }

    if (state === 'POST_CLOSE') {
      return {
        sessionState: state,
        autoMode: true,
        nextAction: 'Auto-evaluate pending entries against close snapshot',
        note: 'Post-close evaluation runs automatically after market close window.',
      };
    }

    return {
      sessionState: state,
      autoMode: true,
      nextAction: 'Stand by for next market session',
      note: 'Market is closed. Last generated notebook remains visible.',
    };
  }

  private buildNotebookSummary(entries: SignalNotebookEntryDto[]): SignalNotebookSummaryDto {
    const evaluated = entries.filter((entry) => entry.outcome !== 'PENDING');
    const hitTargetCount = entries.filter((entry) => entry.outcome === 'HIT_TARGET').length;
    const hitStopCount = entries.filter((entry) => entry.outcome === 'HIT_STOP').length;
    const movedInFavorCount = entries.filter((entry) => entry.outcome === 'MOVED_IN_FAVOR').length;
    const movedAgainstCount = entries.filter((entry) => entry.outcome === 'MOVED_AGAINST').length;

    const accuracyValues = evaluated
      .map((entry) => entry.accuracyScore)
      .filter((score): score is number => score !== null);

    const winLikeCount = hitTargetCount + movedInFavorCount;
    const winRatePct = evaluated.length > 0 ? (winLikeCount / evaluated.length) * 100 : 0;
    const averageAccuracyPct =
      accuracyValues.length > 0
        ? accuracyValues.reduce((sum, value) => sum + value, 0) / accuracyValues.length
        : 0;

    return {
      total: entries.length,
      buyCount: entries.filter((entry) => entry.signal === 'BUY').length,
      sellCount: entries.filter((entry) => entry.signal === 'SELL').length,
      pendingCount: entries.filter((entry) => entry.outcome === 'PENDING').length,
      evaluatedCount: evaluated.length,
      hitTargetCount,
      hitStopCount,
      movedInFavorCount,
      movedAgainstCount,
      winRatePct: this.round2(winRatePct),
      averageAccuracyPct: this.round2(averageAccuracyPct),
    };
  }

  private isDirectionalSignal(value: string): value is Exclude<TradingSignalKind, 'HOLD'> {
    return value === 'BUY' || value === 'SELL';
  }

  private normalizeConfidence(value: string): 'HIGH' | 'MEDIUM' | 'LOW' {
    if (value === 'HIGH' || value === 'MEDIUM' || value === 'LOW') {
      return value;
    }

    return 'LOW';
  }

  private normalizeOutcome(value: string): SignalNotebookOutcome {
    if (
      value === 'PENDING' ||
      value === 'HIT_TARGET' ||
      value === 'HIT_STOP' ||
      value === 'MOVED_IN_FAVOR' ||
      value === 'MOVED_AGAINST' ||
      value === 'FLAT'
    ) {
      return value;
    }

    return 'PENDING';
  }

  private normalizeNotebookLimit(limit?: number): number {
    const parsed = Number(limit ?? NOTEBOOK_DEFAULT_LIMIT);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return NOTEBOOK_DEFAULT_LIMIT;
    }

    return Math.min(Math.floor(parsed), NOTEBOOK_MAX_LIMIT);
  }

  private getNepalTradeDate(now = new Date()): Date {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: NEPAL_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);

    const year = Number(parts.find((part) => part.type === 'year')?.value ?? now.getUTCFullYear());
    const month = Number(parts.find((part) => part.type === 'month')?.value ?? now.getUTCMonth() + 1);
    const day = Number(parts.find((part) => part.type === 'day')?.value ?? now.getUTCDate());

    return new Date(Date.UTC(year, month - 1, day));
  }

  private getMarketSessionState(now = new Date()): MarketSessionState {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: NEPAL_TIME_ZONE,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);

    const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Sun';
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);

    // NEPSE primary session runs Sunday-Thursday.
    if (weekday === 'Fri' || weekday === 'Sat') {
      return 'CLOSED';
    }

    const totalMinutes = hour * 60 + minute;

    if (totalMinutes >= NEPSE_OPEN_MINUTES && totalMinutes < NEPSE_CLOSE_MINUTES) {
      return 'OPEN';
    }

    if (totalMinutes >= NEPSE_EVALUATE_AFTER_CLOSE_MINUTES) {
      return 'POST_CLOSE';
    }

    return 'CLOSED';
  }

  private toIsoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private toStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => String(item));
  }

  private toNumber(value: unknown): number {
    return Number(String(value));
  }

  private toFiniteOrZero(value: number | undefined): number {
    return Number.isFinite(value) ? Number(value) : 0;
  }

  private round2(value: number): number {
    return Number(value.toFixed(2));
  }

  private round4(value: number): number {
    return Number(value.toFixed(4));
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  private buildSignalInput(row: {
    close: number | null;
    ema8: number | null;
    ema21: number | null;
    ema20: number | null;
    ema50: number | null;
    rsi14: number | null;
    vwap: number | null;
    volume: number | null;
    avgVolume20: number | null;
    bbLower: number | null;
    bbUpper: number | null;
  }): SignalInputData {
    return {
      ema8: row.ema8 ?? Number.NaN,
      ema21: row.ema21 ?? Number.NaN,
      ema20: row.ema20 ?? Number.NaN,
      ema50: row.ema50 ?? Number.NaN,
      rsi14: row.rsi14 ?? Number.NaN,
      close: row.close ?? Number.NaN,
      vwap: row.vwap ?? Number.NaN,
      volume: row.volume ?? 0,
      avgVolume20: row.avgVolume20 ?? 0,
      bbLower: row.bbLower ?? Number.NaN,
      bbUpper: row.bbUpper ?? Number.NaN,
    };
  }

  private calculateSma(values: number[], period: number): Array<number | null> {
    const result: Array<number | null> = new Array(values.length).fill(null);
    if (values.length < period) return result;

    let rollingSum = 0;
    for (let i = 0; i < values.length; i += 1) {
      rollingSum += values[i];
      if (i >= period) {
        rollingSum -= values[i - period];
      }

      if (i >= period - 1) {
        result[i] = rollingSum / period;
      }
    }

    return result;
  }

  private calculateEma(values: number[], period: number): Array<number | null> {
    const result: Array<number | null> = new Array(values.length).fill(null);
    if (values.length < period) return result;

    const multiplier = 2 / (period + 1);
    const seed = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;

    result[period - 1] = seed;
    let previous = seed;

    for (let i = period; i < values.length; i += 1) {
      previous = (values[i] - previous) * multiplier + previous;
      result[i] = previous;
    }

    return result;
  }

  private calculateRsi(values: number[], period: number): Array<number | null> {
    const result: Array<number | null> = new Array(values.length).fill(null);
    if (values.length <= period) return result;

    let gainSum = 0;
    let lossSum = 0;

    for (let i = 1; i <= period; i += 1) {
      const delta = values[i] - values[i - 1];
      if (delta > 0) {
        gainSum += delta;
      } else {
        lossSum += Math.abs(delta);
      }
    }

    let avgGain = gainSum / period;
    let avgLoss = lossSum / period;
    result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

    for (let i = period + 1; i < values.length; i += 1) {
      const delta = values[i] - values[i - 1];
      const gain = Math.max(delta, 0);
      const loss = Math.max(-delta, 0);

      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;

      result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }

    return result;
  }

  private calculateVwap(
    highs: number[],
    lows: number[],
    closes: number[],
    volumes: number[],
  ): Array<number | null> {
    const result: Array<number | null> = new Array(closes.length).fill(null);

    let cumulativePriceVolume = 0;
    let cumulativeVolume = 0;

    for (let i = 0; i < closes.length; i += 1) {
      const volume = volumes[i] ?? 0;
      const typicalPrice = (highs[i] + lows[i] + closes[i]) / 3;

      if (volume > 0) {
        cumulativePriceVolume += typicalPrice * volume;
        cumulativeVolume += volume;
      }

      result[i] = cumulativeVolume > 0 ? cumulativePriceVolume / cumulativeVolume : null;
    }

    return result;
  }

  private calculateBollinger(values: number[], period: number, sigmaMultiplier: number): {
    upper: Array<number | null>;
    middle: Array<number | null>;
    lower: Array<number | null>;
  } {
    const upper: Array<number | null> = new Array(values.length).fill(null);
    const middle: Array<number | null> = new Array(values.length).fill(null);
    const lower: Array<number | null> = new Array(values.length).fill(null);

    if (values.length < period) {
      return { upper, middle, lower };
    }

    for (let i = period - 1; i < values.length; i += 1) {
      const window = values.slice(i - period + 1, i + 1);
      const mean = window.reduce((sum, value) => sum + value, 0) / period;
      const variance = window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period;
      const deviation = Math.sqrt(variance);

      middle[i] = mean;
      upper[i] = mean + sigmaMultiplier * deviation;
      lower[i] = mean - sigmaMultiplier * deviation;
    }

    return { upper, middle, lower };
  }
}
