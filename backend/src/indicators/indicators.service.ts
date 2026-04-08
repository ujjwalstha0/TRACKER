import { BadRequestException, Injectable } from '@nestjs/common';
import { OhlcService } from '../ohlc/ohlc.service';
import { OhlcInterval } from '../ohlc/ohlc.types';
import { IndicatorPoint, IndicatorQuery, IndicatorResponse } from './indicators.types';

const ALLOWED_INTERVALS: ReadonlySet<OhlcInterval> = new Set(['1m', '5m', '15m', '1h', '1d']);
const DEFAULT_INTERVAL: OhlcInterval = '1d';
const DEFAULT_LIMIT = 240;

@Injectable()
export class IndicatorsService {
  constructor(private readonly ohlcService: OhlcService) {}

  async getIndicators(query: IndicatorQuery): Promise<IndicatorResponse> {
    const symbol = query.symbol?.trim().toUpperCase();
    if (!symbol) {
      throw new BadRequestException('Query param "symbol" is required.');
    }

    const interval = this.normalizeInterval(query.interval);
    const limit = this.normalizeLimit(query.limit);

    const candles = await this.ohlcService.getCandles({ symbol, interval, limit });
    const closes = candles.map((candle) => candle.c);
    const highs = candles.map((candle) => candle.h);
    const lows = candles.map((candle) => candle.l);
    const volumes = candles.map((candle) => candle.v);

    const sma20Values = this.calculateSma(closes, 20);
    const ema20Values = this.calculateEma(closes, 20);
    const rsi14Values = this.calculateRsi(closes, 14);

    const ema12 = this.calculateEma(closes, 12);
    const ema26 = this.calculateEma(closes, 26);
    const macdLineValues = closes.map((_, index) => {
      const fast = ema12[index];
      const slow = ema26[index];
      if (fast === null || slow === null) return null;
      return fast - slow;
    });
    const macdSignalValues = this.calculateEmaFromNullable(macdLineValues, 9);
    const macdHistogramValues = macdLineValues.map((value, index) => {
      const signal = macdSignalValues[index];
      if (value === null || signal === null) return null;
      return value - signal;
    });

    const { upper, middle, lower } = this.calculateBollinger(closes, 20, 2);
    const vwapValues = this.calculateVwap(highs, lows, closes, volumes);

    return {
      symbol,
      interval,
      candles,
      sma20: this.toPoints(candles.map((candle) => candle.t), sma20Values),
      ema20: this.toPoints(candles.map((candle) => candle.t), ema20Values),
      rsi14: this.toPoints(candles.map((candle) => candle.t), rsi14Values),
      macd: {
        line: this.toPoints(candles.map((candle) => candle.t), macdLineValues),
        signal: this.toPoints(candles.map((candle) => candle.t), macdSignalValues),
        histogram: this.toPoints(candles.map((candle) => candle.t), macdHistogramValues),
      },
      bollinger: {
        upper: this.toPoints(candles.map((candle) => candle.t), upper),
        middle: this.toPoints(candles.map((candle) => candle.t), middle),
        lower: this.toPoints(candles.map((candle) => candle.t), lower),
      },
      vwap: this.toPoints(candles.map((candle) => candle.t), vwapValues),
    };
  }

  private toPoints(timestamps: string[], values: Array<number | null>): IndicatorPoint[] {
    return timestamps.map((t, index) => ({
      t,
      value: values[index] ?? null,
    }));
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

  private calculateEmaFromNullable(values: Array<number | null>, period: number): Array<number | null> {
    const result: Array<number | null> = new Array(values.length).fill(null);
    const firstNonNull = values.findIndex((value) => value !== null);
    if (firstNonNull < 0 || values.length - firstNonNull < period) {
      return result;
    }

    const multiplier = 2 / (period + 1);
    const seedWindow = values.slice(firstNonNull, firstNonNull + period);
    if (seedWindow.some((value) => value === null)) {
      return result;
    }

    let previous = (seedWindow as number[]).reduce((sum, value) => sum + value, 0) / period;
    result[firstNonNull + period - 1] = previous;

    for (let i = firstNonNull + period; i < values.length; i += 1) {
      const current = values[i];
      if (current === null) {
        continue;
      }

      previous = (current - previous) * multiplier + previous;
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

  private calculateVwap(
    highs: number[],
    lows: number[],
    closes: number[],
    volumes: Array<number | null>,
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

  private normalizeInterval(value?: string): OhlcInterval {
    const normalized = (value ?? DEFAULT_INTERVAL).trim().toLowerCase() as OhlcInterval;
    if (!ALLOWED_INTERVALS.has(normalized)) {
      throw new BadRequestException('Invalid interval. Allowed: 1m, 5m, 15m, 1h, 1d.');
    }

    return normalized;
  }

  private normalizeLimit(value?: number): number {
    const parsed = Number(value ?? DEFAULT_LIMIT);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new BadRequestException('Invalid limit. It must be a positive number.');
    }

    return Math.min(Math.floor(parsed), 1000);
  }
}
