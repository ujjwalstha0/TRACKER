import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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

interface SignalDbRow {
  symbol: string;
  close: unknown;
  ema8: unknown;
  ema21: unknown;
  ema20: unknown;
  ema50: unknown;
  rsi14: unknown;
  vwap: unknown;
  bbUpper: unknown;
  bbLower: unknown;
  volume: unknown;
  avgVolume20: unknown;
}

@Injectable()
export class SignalService {
  constructor(private readonly prisma: PrismaService) {}

  async calculateSignal(symbol: string): Promise<TradingSignalResult> {
    const normalizedSymbol = symbol.trim().toUpperCase();
    if (!normalizedSymbol) {
      throw new BadRequestException('Query param "symbol" is required.');
    }

    let rows: SignalDbRow[];
    try {
      rows = (await this.prisma.$queryRawUnsafe(
        `
        SELECT
          symbol,
          c AS close,
          ema8,
          ema21,
          ema20,
          ema50,
          rsi14,
          vwap,
          "bbUpper" AS "bbUpper",
          "bbLower" AS "bbLower",
          v AS volume,
          "avgVolume20" AS "avgVolume20"
        FROM prices
        WHERE symbol = $1
        ORDER BY t DESC
        LIMIT 2
      `,
        normalizedSymbol,
      )) as SignalDbRow[];
    } catch (error) {
      if (this.isRawQuerySchemaError(error)) {
        throw new InternalServerErrorException('Signal columns are missing in prices table.');
      }

      throw error;
    }

    if (!rows.length) {
      throw new NotFoundException('No signal data found for symbol.');
    }

    const data = this.toSignalInput(rows[0]);
    const prevData = rows.length > 1 ? this.toSignalInput(rows[1]) : undefined;

    return this.calculateTradingSignal(data, prevData);
  }

  private calculateTradingSignal(data: SignalInputData, prevData?: SignalInputData): TradingSignalResult {
    let buyScore = 0;
    let sellScore = 0;
    const reasons: string[] = [];

    if (data.ema8 > data.ema21 && (prevData ? prevData.ema8 <= prevData.ema21 : false)) {
      buyScore += 3;
      reasons.push('EMA8 crossed ABOVE EMA21');
    }

    if (data.ema20 > data.ema50) {
      buyScore += 1;
      reasons.push('EMA20 > EMA50 (uptrend)');
    }

    if (data.rsi14 < 65 && data.rsi14 > 30) {
      buyScore += 1;
      reasons.push('RSI neutral-bullish');
    }

    if (data.close > data.vwap) {
      buyScore += 1;
      reasons.push('Price > VWAP');
    }

    if (data.volume > data.avgVolume20 * 1.5) {
      buyScore += 1;
      reasons.push('High volume');
    }

    if (data.close <= data.bbLower) {
      buyScore += 2;
      reasons.push('Oversold bounce');
    }

    if (data.ema8 < data.ema21 && (prevData ? prevData.ema8 >= prevData.ema21 : false)) {
      sellScore += 3;
      reasons.push('EMA8 crossed BELOW EMA21');
    }

    if (data.ema20 < data.ema50) {
      sellScore += 1;
      reasons.push('EMA20 < EMA50 (downtrend)');
    }

    if (data.rsi14 > 35 && data.rsi14 < 75) {
      sellScore += 1;
      reasons.push('RSI neutral-bearish');
    }

    if (data.close < data.vwap) {
      sellScore += 1;
      reasons.push('Price < VWAP');
    }

    if (data.volume > data.avgVolume20 * 1.5) {
      sellScore += 1;
      reasons.push('High volume');
    }

    if (data.close >= data.bbUpper) {
      sellScore += 2;
      reasons.push('Overbought rejection');
    }

    const signal: TradingSignalKind =
      buyScore > sellScore ? 'BUY' : sellScore > buyScore ? 'SELL' : 'HOLD';

    const strength = buyScore > sellScore ? buyScore : sellScore;
    const confidence =
      strength >= TRADING_SIGNALS.BUY_HIGH
        ? 'HIGH'
        : strength >= TRADING_SIGNALS.BUY_MEDIUM
          ? 'MEDIUM'
          : 'LOW';

    return {
      signal,
      confidence,
      buyScore,
      sellScore,
      strength,
      reasons: reasons.slice(0, 3),
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

  private toSignalInput(row: SignalDbRow): SignalInputData {
    return {
      ema8: this.toNumber(row.ema8),
      ema21: this.toNumber(row.ema21),
      ema20: this.toNumber(row.ema20),
      ema50: this.toNumber(row.ema50),
      rsi14: this.toNumber(row.rsi14),
      close: this.toNumber(row.close),
      vwap: this.toNumber(row.vwap),
      volume: this.toNumber(row.volume),
      avgVolume20: this.toNumber(row.avgVolume20),
      bbLower: this.toNumber(row.bbLower),
      bbUpper: this.toNumber(row.bbUpper),
    };
  }

  private toNumber(value: unknown): number {
    const parsed = Number(String(value));
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }

  private isRawQuerySchemaError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) {
      return false;
    }

    if ('code' in error && (error as { code?: string }).code === 'P2010') {
      return true;
    }

    if ('message' in error && typeof (error as { message?: string }).message === 'string') {
      const message = (error as { message: string }).message;
      return message.includes('column') || message.includes('does not exist') || message.includes('relation');
    }

    return false;
  }
}
