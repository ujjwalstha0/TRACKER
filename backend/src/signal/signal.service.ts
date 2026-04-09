import { BadRequestException, Injectable } from '@nestjs/common';
import { OhlcService } from '../ohlc/ohlc.service';
import { PrismaService } from '../prisma/prisma.service';
import { OhlcCandleDto } from '../ohlc/ohlc.types';
import {
  SignalCheckItem,
  SignalInputData,
  SignalInterval,
  SignalNotebookEntryDto,
  SignalNotebookOutcome,
  SignalNotebookPayload,
  SignalNotebookSummaryDto,
  SignalTradePlan,
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
  { interval: '1m', limit: 220, minCandles: 80 },
  { interval: '5m', limit: 260, minCandles: 80 },
  { interval: '15m', limit: 260, minCandles: 80 },
  { interval: '1h', limit: 320, minCandles: 80 },
  { interval: '1d', limit: 320, minCandles: 60 },
];

const SIGNAL_CACHE_TTL_MS = 10_000;
const SIGNAL_QUALITY_GATE = 60;
const TARGET_RISK_MULTIPLIER = 2.2;
const MIN_STOP_DISTANCE_PCT = 0.012;
const NOTEBOOK_DEFAULT_LIMIT = 45;
const NOTEBOOK_MAX_LIMIT = 140;
const NEPAL_TIME_ZONE = 'Asia/Kathmandu';

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

@Injectable()
export class SignalService {
  private readonly signalCache = new Map<string, { fetchedAt: number; result: TradingSignalResult }>();

  constructor(
    private readonly ohlcService: OhlcService,
    private readonly prisma: PrismaService,
  ) {}

  async calculateSignal(symbol: string): Promise<TradingSignalResult> {
    const normalizedSymbol = symbol.trim().toUpperCase();
    if (!normalizedSymbol) {
      throw new BadRequestException('Query param "symbol" is required.');
    }

    const now = Date.now();
    const cached = this.signalCache.get(normalizedSymbol);
    if (cached && now - cached.fetchedAt < SIGNAL_CACHE_TTL_MS) {
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

    const result = this.calculateTradingSignal(
      data,
      prevData,
      selection.interval,
      new Date(now).toISOString(),
    );
    this.signalCache.set(normalizedSymbol, {
      fetchedAt: now,
      result,
    });

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
      const signal = await this.calculateSignal(row.symbol);
      if (!this.isDirectionalSignal(signal.signal) || !signal.plan) {
        continue;
      }

      await this.prisma.signalNotebookEntry.upsert({
        where: {
          tradeDate_symbol: {
            tradeDate,
            symbol: row.symbol,
          },
        },
        create: {
          tradeDate,
          symbol: row.symbol,
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
          evaluatedAt: null,
          closePrice: null,
          outcome: 'PENDING',
          accuracyScore: null,
        },
      });
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
    return this.getNotebookByDate(this.getNepalTradeDate());
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
    interval: SignalInterval,
    generatedAt: string,
  ): TradingSignalResult {
    let buyScore = 0;
    let sellScore = 0;
    const buyReasons: string[] = [];
    const sellReasons: string[] = [];
    const hasValidBands =
      Number.isFinite(data.bbLower) && Number.isFinite(data.bbUpper) && data.bbUpper > data.bbLower;

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

    const isStrongBuy =
      hasBuyConfluence &&
      buyScore >= TRADING_SIGNALS.BUY_MEDIUM &&
      buyScore >= sellScore + 1 &&
      buyQuality >= SIGNAL_QUALITY_GATE;

    const isStrongSell =
      hasSellConfluence &&
      sellScore >= TRADING_SIGNALS.SELL_MEDIUM &&
      sellScore >= buyScore + 1 &&
      sellQuality >= SIGNAL_QUALITY_GATE;

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

    const confidence =
      signal === 'HOLD'
        ? 'LOW'
        : qualityScore >= 82 || strength >= TRADING_SIGNALS.BUY_HIGH
          ? 'HIGH'
          : qualityScore >= 68 || strength >= TRADING_SIGNALS.BUY_MEDIUM
            ? 'MEDIUM'
            : 'LOW';

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
    );

    const plan = signal === 'HOLD' ? null : this.buildTradePlan(signal, data);

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
      interval,
      generatedAt,
    };
  }

  private buildReasons(
    signal: TradingSignalKind,
    buyReasons: string[],
    sellReasons: string[],
    failedChecks: string[],
    buyQuality: number,
    sellQuality: number,
  ): string[] {
    if (signal === 'BUY') {
      return [
        ...buyReasons,
        `Quality score ${buyQuality.toFixed(1)}% passed minimum execution gate.`,
        'Use plan levels and only execute if risk controls are respected.',
      ];
    }

    if (signal === 'SELL') {
      return [
        ...sellReasons,
        `Quality score ${sellQuality.toFixed(1)}% passed minimum execution gate.`,
        'Use plan levels and avoid oversized countertrend entries.',
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
      HIGH: signal === 'BUY' ? 'ENTER LONG WITH FULL PLAN' : 'ENTER SHORT WITH FULL PLAN',
      MEDIUM: signal === 'BUY' ? 'ENTER LONG WITH REDUCED SIZE' : 'ENTER SHORT WITH REDUCED SIZE',
      LOW: signal === 'BUY' ? 'WATCH FOR BETTER BUY SETUP' : 'WATCH FOR BETTER SELL SETUP',
    };

    if (qualityScore >= 80 || strength >= 5) {
      return actions.HIGH;
    }

    if (qualityScore >= 65 || strength >= 3) {
      return actions.MEDIUM;
    }

    return actions.LOW;
  }

  private calculateQualityScore(checks: SignalCheckItem[]): number {
    const totalWeight = checks.reduce((sum, item) => sum + item.weight, 0);
    if (totalWeight <= 0) return 0;

    const passedWeight = checks
      .filter((item) => item.passed)
      .reduce((sum, item) => sum + item.weight, 0);

    return this.round2((passedWeight / totalWeight) * 100);
  }

  private buildTradePlan(signal: Exclude<TradingSignalKind, 'HOLD'>, data: SignalInputData): SignalTradePlan {
    const hasValidBands =
      Number.isFinite(data.bbLower) && Number.isFinite(data.bbUpper) && data.bbUpper > data.bbLower;

    const halfBandRange = hasValidBands
      ? Math.max((data.bbUpper - data.bbLower) / 2, data.close * 0.01)
      : data.close * 0.025;

    const minimumRisk = data.close * MIN_STOP_DISTANCE_PCT;

    if (signal === 'BUY') {
      const structuralStop = Math.min(
        data.ema21,
        data.ema20,
        data.vwap,
        data.close - halfBandRange * 0.75,
      );

      const riskPerShare = Math.max(minimumRisk, data.close - structuralStop);
      const stopLoss = data.close - riskPerShare;
      const rewardPerShare = riskPerShare * TARGET_RISK_MULTIPLIER;
      const targetPrice = data.close + rewardPerShare;

      return {
        entryPrice: this.round4(data.close),
        stopLoss: this.round4(stopLoss),
        targetPrice: this.round4(targetPrice),
        riskPerShare: this.round4(riskPerShare),
        rewardPerShare: this.round4(rewardPerShare),
        riskReward: this.round2(rewardPerShare / riskPerShare),
        expectedMovePct: this.round2((rewardPerShare / data.close) * 100),
        invalidation: 'Invalidate BUY if price closes below stop-loss or momentum breaks under EMA21/VWAP.',
      };
    }

    const structuralStop = Math.max(
      data.ema21,
      data.ema20,
      data.vwap,
      data.close + halfBandRange * 0.75,
    );
    const riskPerShare = Math.max(minimumRisk, structuralStop - data.close);
    const stopLoss = data.close + riskPerShare;
    const rewardPerShare = riskPerShare * TARGET_RISK_MULTIPLIER;
    const targetPrice = Math.max(0.01, data.close - rewardPerShare);

    return {
      entryPrice: this.round4(data.close),
      stopLoss: this.round4(stopLoss),
      targetPrice: this.round4(targetPrice),
      riskPerShare: this.round4(riskPerShare),
      rewardPerShare: this.round4(rewardPerShare),
      riskReward: this.round2(rewardPerShare / riskPerShare),
      expectedMovePct: this.round2((rewardPerShare / data.close) * 100),
      invalidation: 'Invalidate SELL if price closes above stop-loss or regains EMA21/VWAP control.',
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
      summary,
      entries,
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
