import { BadRequestException, Injectable } from '@nestjs/common';
import { OhlcService } from '../ohlc/ohlc.service';
import { SignalInputData, TradingSignalKind, TradingSignalResult } from './signal.types';

const TRADING_SIGNALS = {
  BUY_HIGH: 5,
  BUY_MEDIUM: 3,
  BUY_LOW: 1,
  SELL_HIGH: 5,
  SELL_MEDIUM: 3,
  SELL_LOW: 1,
  HOLD: 0,
} as const;

const SIGNAL_INTERVAL = '1m';
const SIGNAL_LIMIT = 220;

@Injectable()
export class SignalService {
  constructor(private readonly ohlcService: OhlcService) {}

  async calculateSignal(symbol: string): Promise<TradingSignalResult> {
    const normalizedSymbol = symbol.trim().toUpperCase();
    if (!normalizedSymbol) {
      throw new BadRequestException('Query param "symbol" is required.');
    }

    const candles = await this.ohlcService.getCandles({
      symbol: normalizedSymbol,
      interval: SIGNAL_INTERVAL,
      limit: SIGNAL_LIMIT,
    });

    if (!candles.length) {
      return this.buildNoDataSignal('No candle history available for this symbol yet.');
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

    return this.calculateTradingSignal(data, prevData);
  }

  private buildNoDataSignal(reason: string): TradingSignalResult {
    return {
      signal: 'HOLD',
      confidence: 'LOW',
      buyScore: 0,
      sellScore: 0,
      strength: 0,
      reasons: [reason],
      recommendedAction: 'WAIT',
    };
  }

  private calculateTradingSignal(data: SignalInputData, prevData?: SignalInputData): TradingSignalResult {
    let buyScore = 0;
    let sellScore = 0;
    const buyReasons: string[] = [];
    const sellReasons: string[] = [];
    const hasValidBands =
      Number.isFinite(data.bbLower) && Number.isFinite(data.bbUpper) && data.bbUpper > data.bbLower;

    if (data.ema8 > data.ema21 && (prevData ? prevData.ema8 <= prevData.ema21 : false)) {
      buyScore += 3;
      buyReasons.push('EMA8 crossed ABOVE EMA21');
    }

    if (data.ema20 > data.ema50) {
      buyScore += 1;
      buyReasons.push('EMA20 > EMA50 (uptrend)');
    }

    if (data.rsi14 < 65 && data.rsi14 > 30) {
      buyScore += 1;
      buyReasons.push('RSI neutral-bullish');
    }

    if (data.close > data.vwap) {
      buyScore += 1;
      buyReasons.push('Price > VWAP');
    }

    if (data.avgVolume20 > 0 && data.volume > data.avgVolume20 * 1.5) {
      buyScore += 1;
      buyReasons.push('High volume');
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

    if (data.ema8 < data.ema21 && (prevData ? prevData.ema8 >= prevData.ema21 : false)) {
      sellScore += 3;
      sellReasons.push('EMA8 crossed BELOW EMA21');
    }

    if (data.ema20 < data.ema50) {
      sellScore += 1;
      sellReasons.push('EMA20 < EMA50 (downtrend)');
    }

    if (data.rsi14 > 35 && data.rsi14 < 75) {
      sellScore += 1;
      sellReasons.push('RSI neutral-bearish');
    }

    if (data.close < data.vwap) {
      sellScore += 1;
      sellReasons.push('Price < VWAP');
    }

    if (data.avgVolume20 > 0 && data.volume > data.avgVolume20 * 1.5) {
      sellScore += 1;
      sellReasons.push('High volume');
    }

    const hasBuyConfluence =
      data.ema8 > data.ema21 &&
      data.ema20 > data.ema50 &&
      data.close > data.vwap &&
      data.rsi14 >= 40 &&
      data.rsi14 <= 65;

    const hasSellConfluence =
      data.ema8 < data.ema21 &&
      data.ema20 < data.ema50 &&
      data.close < data.vwap &&
      data.rsi14 >= 35 &&
      data.rsi14 <= 60;

    const isStrongBuy =
      hasBuyConfluence && buyScore >= TRADING_SIGNALS.BUY_HIGH && buyScore >= sellScore + 2;
    const isStrongSell =
      hasSellConfluence && sellScore >= TRADING_SIGNALS.SELL_HIGH && sellScore >= buyScore + 2;

    const signal: TradingSignalKind = isStrongBuy ? 'BUY' : isStrongSell ? 'SELL' : 'HOLD';

    const strength = buyScore > sellScore ? buyScore : sellScore;
    const confidence =
      signal === 'HOLD'
        ? 'LOW'
        : strength >= TRADING_SIGNALS.BUY_HIGH
          ? 'HIGH'
          : strength >= TRADING_SIGNALS.BUY_MEDIUM
            ? 'MEDIUM'
            : 'LOW';

    const reasons =
      signal === 'BUY'
        ? buyReasons
        : signal === 'SELL'
          ? sellReasons
          : ['All confirmation conditions are not aligned yet.'];

    return {
      signal,
      confidence,
      buyScore,
      sellScore,
      strength,
      reasons: reasons.length ? reasons.slice(0, 3) : ['No strong confluence yet.'],
      recommendedAction: this.getAction(signal, strength),
    };
  }

  private getAction(signal: TradingSignalKind, strength: number): string {
    if (signal === 'HOLD') return 'WAIT';

    const actions = {
      HIGH: signal === 'BUY' ? 'ENTER LONG' : 'EXIT SHORT',
      MEDIUM: signal === 'BUY' ? 'ADD POSITION' : 'REDUCE SIZE',
      LOW: signal === 'BUY' ? 'WATCH CLOSELY' : 'TIGHTEN STOPS',
    };

    return actions[strength >= 5 ? 'HIGH' : strength >= 3 ? 'MEDIUM' : 'LOW'] || 'MONITOR';
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
