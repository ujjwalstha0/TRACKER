import { OhlcCandle } from '../types';

export type IndicatorDirection = 'bullish' | 'bearish';

export interface AdxSeries {
  adx: Array<number | null>;
  plusDi: Array<number | null>;
  minusDi: Array<number | null>;
}

export interface StochRsiSeries {
  raw: Array<number | null>;
  k: Array<number | null>;
  d: Array<number | null>;
}

export interface MacdSeries {
  line: Array<number | null>;
  signal: Array<number | null>;
  histogram: Array<number | null>;
}

export interface SupertrendSeries {
  line: Array<number | null>;
  trend: Array<IndicatorDirection | null>;
}

export interface FairValueGapZone {
  direction: IndicatorDirection;
  sourceInterval: string;
  startTime: string;
  endTime: string;
  low: number;
  high: number;
  midpoint: number;
  filled: boolean;
}

export interface SweepEvent {
  direction: IndicatorDirection;
  at: string;
  level: number;
  close: number;
  penetrationPct: number;
}

export interface CisdEvent {
  direction: IndicatorDirection;
  at: string;
  breakLevel: number;
  rangeLow: number;
  rangeHigh: number;
  rangePct: number;
}

export interface CisdProjectionLevel {
  direction: IndicatorDirection;
  multiple: number;
  price: number;
  label: string;
}

export interface KeyLevel {
  id: string;
  label: string;
  price: number;
  category: 'structural' | 'session' | 'open';
  polarity: 'high' | 'low' | 'neutral';
}

export interface OpenSourceIndicatorBundle {
  atr14: Array<number | null>;
  adx14: AdxSeries;
  rsi14: Array<number | null>;
  stochRsi: StochRsiSeries;
  macd12_26_9: MacdSeries;
  supertrend: SupertrendSeries;
  relativeVolume20: Array<number | null>;
  fvgZones: FairValueGapZone[];
  mtfFvgZones: FairValueGapZone[];
  sweepEvents: SweepEvent[];
  nepseLateWeekSweeps: SweepEvent[];
  cisdEvents: CisdEvent[];
  keyLevels: KeyLevel[];
  latest: {
    atr14: number | null;
    adx14: number | null;
    plusDi: number | null;
    minusDi: number | null;
    rsi14: number | null;
    stochK: number | null;
    stochD: number | null;
    macd: number | null;
    macdSignal: number | null;
    macdHistogram: number | null;
    relativeVolume20: number | null;
    supertrendTrend: IndicatorDirection | null;
    latestLateWeekSweep: SweepEvent | null;
  };
}

interface MultiTimeframeCandles {
  interval: string;
  candles: OhlcCandle[];
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const NEPSE_TIME_ZONE = 'Asia/Kathmandu';

export function buildOpenSourceIndicatorBundle(params: {
  candles: OhlcCandle[];
  sourceInterval: string;
  multiTimeframeCandles?: MultiTimeframeCandles[];
}): OpenSourceIndicatorBundle {
  const { candles, sourceInterval, multiTimeframeCandles = [] } = params;

  if (!candles.length) {
    return {
      atr14: [],
      adx14: { adx: [], plusDi: [], minusDi: [] },
      rsi14: [],
      stochRsi: { raw: [], k: [], d: [] },
      macd12_26_9: { line: [], signal: [], histogram: [] },
      supertrend: { line: [], trend: [] },
      relativeVolume20: [],
      fvgZones: [],
      mtfFvgZones: [],
      sweepEvents: [],
      nepseLateWeekSweeps: [],
      cisdEvents: [],
      keyLevels: [],
      latest: {
        atr14: null,
        adx14: null,
        plusDi: null,
        minusDi: null,
        rsi14: null,
        stochK: null,
        stochD: null,
        macd: null,
        macdSignal: null,
        macdHistogram: null,
        relativeVolume20: null,
        supertrendTrend: null,
        latestLateWeekSweep: null,
      },
    };
  }

  const closes = candles.map((item) => item.c);
  const atr14 = calculateAtr(candles, 14);
  const adx14 = calculateAdx(candles, 14);
  const rsi14 = calculateRsi(closes, 14);
  const stochRsi = calculateStochRsi(closes, 14, 14, 3, 3);
  const macd12_26_9 = calculateMacd(closes, 12, 26, 9);
  const supertrend = calculateSupertrend(candles, 10, 3);
  const relativeVolume20 = calculateRelativeVolume(candles, 20);

  const fvgZones = detectFairValueGaps(candles, sourceInterval, 18, true);
  const mtfFvgZones = multiTimeframeCandles
    .flatMap((item) => detectFairValueGaps(item.candles, item.interval, 10, true))
    .slice(-20);

  const sweepEvents = detectSweepEvents(candles, 3, 14);
  const nepseLateWeekSweeps = detectNepseLateWeekSweepEvents(sweepEvents);
  const cisdEvents = detectCisdEvents(candles, 10);
  const keyLevels = deriveKeyLevels(candles);

  return {
    atr14,
    adx14,
    rsi14,
    stochRsi,
    macd12_26_9,
    supertrend,
    relativeVolume20,
    fvgZones,
    mtfFvgZones,
    sweepEvents,
    nepseLateWeekSweeps,
    cisdEvents,
    keyLevels,
    latest: {
      atr14: getLastFinite(atr14),
      adx14: getLastFinite(adx14.adx),
      plusDi: getLastFinite(adx14.plusDi),
      minusDi: getLastFinite(adx14.minusDi),
      rsi14: getLastFinite(rsi14),
      stochK: getLastFinite(stochRsi.k),
      stochD: getLastFinite(stochRsi.d),
      macd: getLastFinite(macd12_26_9.line),
      macdSignal: getLastFinite(macd12_26_9.signal),
      macdHistogram: getLastFinite(macd12_26_9.histogram),
      relativeVolume20: getLastFinite(relativeVolume20),
      supertrendTrend: getLastDirection(supertrend.trend),
      latestLateWeekSweep: nepseLateWeekSweeps[nepseLateWeekSweeps.length - 1] ?? null,
    },
  };
}

export function calculateSma(values: number[], period: number): Array<number | null> {
  const output: Array<number | null> = new Array(values.length).fill(null);
  if (values.length < period || period <= 0) {
    return output;
  }

  let rolling = 0;
  for (let i = 0; i < values.length; i += 1) {
    rolling += values[i];
    if (i >= period) {
      rolling -= values[i - period];
    }

    if (i >= period - 1) {
      output[i] = rolling / period;
    }
  }

  return output;
}

export function calculateEma(values: number[], period: number): Array<number | null> {
  const output: Array<number | null> = new Array(values.length).fill(null);
  if (values.length < period || period <= 0) {
    return output;
  }

  const multiplier = 2 / (period + 1);
  const seed = values.slice(0, period).reduce((acc, value) => acc + value, 0) / period;

  output[period - 1] = seed;
  let previous = seed;

  for (let i = period; i < values.length; i += 1) {
    previous = (values[i] - previous) * multiplier + previous;
    output[i] = previous;
  }

  return output;
}

export function calculateRsi(values: number[], period: number): Array<number | null> {
  const output: Array<number | null> = new Array(values.length).fill(null);
  if (values.length <= period || period <= 0) {
    return output;
  }

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
  output[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i += 1) {
    const delta = values[i] - values[i - 1];
    const gain = Math.max(delta, 0);
    const loss = Math.max(-delta, 0);

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    output[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return output;
}

export function calculateAtr(candles: OhlcCandle[], period: number): Array<number | null> {
  const output: Array<number | null> = new Array(candles.length).fill(null);
  if (candles.length <= period || period <= 0) {
    return output;
  }

  const trValues: number[] = new Array(candles.length).fill(0);
  for (let i = 1; i < candles.length; i += 1) {
    const current = candles[i];
    const previous = candles[i - 1];
    const highLow = current.h - current.l;
    const highClose = Math.abs(current.h - previous.c);
    const lowClose = Math.abs(current.l - previous.c);
    trValues[i] = Math.max(highLow, highClose, lowClose);
  }

  let atr = trValues.slice(1, period + 1).reduce((acc, value) => acc + value, 0) / period;
  output[period] = atr;

  for (let i = period + 1; i < candles.length; i += 1) {
    atr = (atr * (period - 1) + trValues[i]) / period;
    output[i] = atr;
  }

  return output;
}

export function calculateAdx(candles: OhlcCandle[], period: number): AdxSeries {
  const adx: Array<number | null> = new Array(candles.length).fill(null);
  const plusDi: Array<number | null> = new Array(candles.length).fill(null);
  const minusDi: Array<number | null> = new Array(candles.length).fill(null);

  if (candles.length <= period * 2 || period <= 0) {
    return { adx, plusDi, minusDi };
  }

  const tr: number[] = new Array(candles.length).fill(0);
  const plusDm: number[] = new Array(candles.length).fill(0);
  const minusDm: number[] = new Array(candles.length).fill(0);

  for (let i = 1; i < candles.length; i += 1) {
    const current = candles[i];
    const previous = candles[i - 1];

    const upMove = current.h - previous.h;
    const downMove = previous.l - current.l;

    plusDm[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDm[i] = downMove > upMove && downMove > 0 ? downMove : 0;

    const highLow = current.h - current.l;
    const highClose = Math.abs(current.h - previous.c);
    const lowClose = Math.abs(current.l - previous.c);
    tr[i] = Math.max(highLow, highClose, lowClose);
  }

  let trSmooth = tr.slice(1, period + 1).reduce((acc, value) => acc + value, 0);
  let plusSmooth = plusDm.slice(1, period + 1).reduce((acc, value) => acc + value, 0);
  let minusSmooth = minusDm.slice(1, period + 1).reduce((acc, value) => acc + value, 0);

  const dx: Array<number | null> = new Array(candles.length).fill(null);

  for (let i = period; i < candles.length; i += 1) {
    if (i > period) {
      trSmooth = trSmooth - trSmooth / period + tr[i];
      plusSmooth = plusSmooth - plusSmooth / period + plusDm[i];
      minusSmooth = minusSmooth - minusSmooth / period + minusDm[i];
    }

    if (trSmooth <= 0) {
      continue;
    }

    const plus = (plusSmooth / trSmooth) * 100;
    const minus = (minusSmooth / trSmooth) * 100;

    plusDi[i] = plus;
    minusDi[i] = minus;

    const denominator = plus + minus;
    dx[i] = denominator === 0 ? 0 : (Math.abs(plus - minus) / denominator) * 100;
  }

  const firstAdxIndex = period * 2;
  const firstWindow = dx.slice(period, firstAdxIndex).filter((value): value is number => value !== null);
  if (firstWindow.length !== period) {
    return { adx, plusDi, minusDi };
  }

  let adxRunning = firstWindow.reduce((acc, value) => acc + value, 0) / period;
  adx[firstAdxIndex - 1] = adxRunning;

  for (let i = firstAdxIndex; i < candles.length; i += 1) {
    const currentDx = dx[i];
    if (currentDx === null) {
      continue;
    }

    adxRunning = (adxRunning * (period - 1) + currentDx) / period;
    adx[i] = adxRunning;
  }

  return { adx, plusDi, minusDi };
}

export function calculateStochRsi(
  closes: number[],
  rsiPeriod: number,
  stochPeriod: number,
  smoothK: number,
  smoothD: number,
): StochRsiSeries {
  const raw: Array<number | null> = new Array(closes.length).fill(null);
  const rsi = calculateRsi(closes, rsiPeriod);

  for (let i = 0; i < closes.length; i += 1) {
    if (i < stochPeriod) {
      continue;
    }

    const currentRsi = rsi[i];
    const window = rsi.slice(i - stochPeriod + 1, i + 1).filter((value): value is number => value !== null);
    if (window.length !== stochPeriod || currentRsi === null) {
      continue;
    }

    const minValue = Math.min(...window);
    const maxValue = Math.max(...window);
    const denominator = maxValue - minValue;
    raw[i] = denominator === 0 ? 50 : ((currentRsi - minValue) / denominator) * 100;
  }

  const k = calculateSmaFromNullable(raw, smoothK);
  const d = calculateSmaFromNullable(k, smoothD);

  return { raw, k, d };
}

export function calculateMacd(
  closes: number[],
  fastPeriod: number,
  slowPeriod: number,
  signalPeriod: number,
): MacdSeries {
  const line: Array<number | null> = new Array(closes.length).fill(null);
  const signal: Array<number | null> = new Array(closes.length).fill(null);
  const histogram: Array<number | null> = new Array(closes.length).fill(null);

  if (!closes.length || fastPeriod <= 0 || slowPeriod <= 0 || signalPeriod <= 0 || fastPeriod >= slowPeriod) {
    return { line, signal, histogram };
  }

  const fast = calculateEma(closes, fastPeriod);
  const slow = calculateEma(closes, slowPeriod);

  const macdSource: number[] = [];
  const macdIndexMap: number[] = [];

  for (let i = 0; i < closes.length; i += 1) {
    if (fast[i] === null || slow[i] === null) {
      continue;
    }

    const value = (fast[i] as number) - (slow[i] as number);
    line[i] = value;
    macdSource.push(value);
    macdIndexMap.push(i);
  }

  if (macdSource.length < signalPeriod) {
    return { line, signal, histogram };
  }

  const signalSeries = calculateEma(macdSource, signalPeriod);
  for (let i = 0; i < signalSeries.length; i += 1) {
    const targetIndex = macdIndexMap[i];
    const signalValue = signalSeries[i];
    if (signalValue === null || line[targetIndex] === null) {
      continue;
    }

    signal[targetIndex] = signalValue;
    histogram[targetIndex] = (line[targetIndex] as number) - signalValue;
  }

  return { line, signal, histogram };
}

export function calculateSupertrend(candles: OhlcCandle[], period: number, multiplier: number): SupertrendSeries {
  const line: Array<number | null> = new Array(candles.length).fill(null);
  const trend: Array<IndicatorDirection | null> = new Array(candles.length).fill(null);

  if (!candles.length) {
    return { line, trend };
  }

  const atr = calculateAtr(candles, period);
  const finalUpper: Array<number | null> = new Array(candles.length).fill(null);
  const finalLower: Array<number | null> = new Array(candles.length).fill(null);

  for (let i = 0; i < candles.length; i += 1) {
    const atrValue = atr[i];
    if (atrValue === null) {
      continue;
    }

    const midpoint = (candles[i].h + candles[i].l) / 2;
    const basicUpper = midpoint + multiplier * atrValue;
    const basicLower = midpoint - multiplier * atrValue;

    if (i === 0 || finalUpper[i - 1] === null || finalLower[i - 1] === null) {
      finalUpper[i] = basicUpper;
      finalLower[i] = basicLower;
      trend[i] = 'bullish';
      line[i] = basicLower;
      continue;
    }

    const prevUpper = finalUpper[i - 1] ?? basicUpper;
    const prevLower = finalLower[i - 1] ?? basicLower;
    const prevClose = candles[i - 1].c;

    finalUpper[i] = basicUpper < prevUpper || prevClose > prevUpper ? basicUpper : prevUpper;
    finalLower[i] = basicLower > prevLower || prevClose < prevLower ? basicLower : prevLower;

    const prevTrend = trend[i - 1] ?? 'bullish';
    let currentTrend: IndicatorDirection = prevTrend;

    if (prevTrend === 'bearish' && candles[i].c > (finalUpper[i] ?? basicUpper)) {
      currentTrend = 'bullish';
    } else if (prevTrend === 'bullish' && candles[i].c < (finalLower[i] ?? basicLower)) {
      currentTrend = 'bearish';
    }

    trend[i] = currentTrend;
    line[i] = currentTrend === 'bullish' ? finalLower[i] : finalUpper[i];
  }

  return { line, trend };
}

export function calculateRelativeVolume(candles: OhlcCandle[], period: number): Array<number | null> {
  const volumes = candles.map((item) => item.v ?? 0);
  const avg = calculateSma(volumes, period);

  return volumes.map((value, index) => {
    const baseline = avg[index];
    if (baseline === null || baseline === 0) {
      return null;
    }

    return value / baseline;
  });
}

export function detectFairValueGaps(
  candles: OhlcCandle[],
  sourceInterval: string,
  maxZones: number,
  dropFilled: boolean,
): FairValueGapZone[] {
  const zones: FairValueGapZone[] = [];

  for (let i = 2; i < candles.length; i += 1) {
    const left = candles[i - 2];
    const right = candles[i];

    if (left.h < right.l) {
      const low = left.h;
      const high = right.l;
      const filled = isBullishFvgFilled(candles, i + 1, low);
      if (!dropFilled || !filled) {
        zones.push({
          direction: 'bullish',
          sourceInterval,
          startTime: left.t,
          endTime: right.t,
          low,
          high,
          midpoint: (low + high) / 2,
          filled,
        });
      }
    }

    if (left.l > right.h) {
      const low = right.h;
      const high = left.l;
      const filled = isBearishFvgFilled(candles, i + 1, high);
      if (!dropFilled || !filled) {
        zones.push({
          direction: 'bearish',
          sourceInterval,
          startTime: left.t,
          endTime: right.t,
          low,
          high,
          midpoint: (low + high) / 2,
          filled,
        });
      }
    }
  }

  return zones.slice(-maxZones);
}

export function detectSweepEvents(candles: OhlcCandle[], lookback: number, maxEvents: number): SweepEvent[] {
  const events: SweepEvent[] = [];

  for (let i = lookback * 2; i < candles.length; i += 1) {
    const window = candles.slice(i - lookback * 2, i);
    if (!window.length) {
      continue;
    }

    const priorHigh = Math.max(...window.map((item) => item.h));
    const priorLow = Math.min(...window.map((item) => item.l));
    const current = candles[i];

    if (current.h > priorHigh && current.c < priorHigh) {
      events.push({
        direction: 'bearish',
        at: current.t,
        level: priorHigh,
        close: current.c,
        penetrationPct: ((current.h - priorHigh) / priorHigh) * 100,
      });
    }

    if (current.l < priorLow && current.c > priorLow) {
      events.push({
        direction: 'bullish',
        at: current.t,
        level: priorLow,
        close: current.c,
        penetrationPct: ((priorLow - current.l) / priorLow) * 100,
      });
    }
  }

  return events.slice(-maxEvents);
}

export function detectCisdEvents(candles: OhlcCandle[], maxEvents: number): CisdEvent[] {
  const events: CisdEvent[] = [];

  for (let i = 4; i < candles.length; i += 1) {
    const bullishRun = findRunRange(candles, i, 'up');
    if (bullishRun && candles[i].c < bullishRun.low) {
      events.push({
        direction: 'bearish',
        at: candles[i].t,
        breakLevel: bullishRun.low,
        rangeLow: bullishRun.low,
        rangeHigh: bullishRun.high,
        rangePct: ((bullishRun.high - bullishRun.low) / candles[i].c) * 100,
      });
    }

    const bearishRun = findRunRange(candles, i, 'down');
    if (bearishRun && candles[i].c > bearishRun.high) {
      events.push({
        direction: 'bullish',
        at: candles[i].t,
        breakLevel: bearishRun.high,
        rangeLow: bearishRun.low,
        rangeHigh: bearishRun.high,
        rangePct: ((bearishRun.high - bearishRun.low) / candles[i].c) * 100,
      });
    }
  }

  return events.slice(-maxEvents);
}

export function detectNepseLateWeekSweepEvents(events: SweepEvent[]): SweepEvent[] {
  return events.filter((event) => {
    const date = new Date(event.at);
    const parts = getTzParts(date, NEPSE_TIME_ZONE);
    if (!parts) {
      return false;
    }

    const day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
    const isLateWeek = day === 3 || day === 4;

    return isLateWeek && event.penetrationPct >= 0.18;
  });
}

export function buildCisdProjectionLevels(
  cisdEvent: CisdEvent | null,
  multipliers: number[],
): CisdProjectionLevel[] {
  if (!cisdEvent || !multipliers.length) {
    return [];
  }

  const range = Math.max(Math.abs(cisdEvent.rangeHigh - cisdEvent.rangeLow), 0.0001);
  const sign = cisdEvent.direction === 'bullish' ? 1 : -1;

  return multipliers.map((multiple) => {
    const cleanMultiple = Number.isFinite(multiple) ? Math.abs(multiple) : 0;
    const delta = range * cleanMultiple * sign;

    return {
      direction: cisdEvent.direction,
      multiple: cleanMultiple,
      price: cisdEvent.breakLevel + delta,
      label: `CISD ${cleanMultiple.toFixed(2)}x`,
    };
  });
}

export function deriveKeyLevels(candles: OhlcCandle[]): KeyLevel[] {
  if (!candles.length) {
    return [];
  }

  const enriched = candles
    .map((candle) => {
      const parts = getTzParts(new Date(candle.t), NEPSE_TIME_ZONE);
      if (!parts) {
        return null;
      }

      const sessionKey = toSessionDayKey(parts);
      const minuteOfDay = parts.hour * 60 + parts.minute;
      const sessionDate = new Date(`${sessionKey}T00:00:00Z`);

      return {
        candle,
        parts,
        sessionKey,
        minuteOfDay,
        sessionDate,
      };
    })
    .filter((item): item is {
      candle: OhlcCandle;
      parts: ZonedParts;
      sessionKey: string;
      minuteOfDay: number;
      sessionDate: Date;
    } => item !== null);

  if (!enriched.length) {
    return [];
  }

  const sessionMap = new Map<string, { high: number; low: number }>();
  const sessionRows = new Map<string, typeof enriched>();

  for (const item of enriched) {
    const base = sessionMap.get(item.sessionKey) ?? { high: Number.NEGATIVE_INFINITY, low: Number.POSITIVE_INFINITY };
    base.high = Math.max(base.high, item.candle.h);
    base.low = Math.min(base.low, item.candle.l);
    sessionMap.set(item.sessionKey, base);

    const rows = sessionRows.get(item.sessionKey) ?? [];
    rows.push(item);
    sessionRows.set(item.sessionKey, rows);
  }

  const orderedSessions = Array.from(sessionMap.keys()).sort((a, b) => (a < b ? -1 : 1));
  const currentSession = orderedSessions[orderedSessions.length - 1];
  const previousSession = orderedSessions[orderedSessions.length - 2] ?? null;

  const levels: KeyLevel[] = [];

  if (previousSession) {
    const prior = sessionMap.get(previousSession);
    if (prior) {
      levels.push(
        {
          id: 'prev-day-high',
          label: 'Prev Day High',
          price: prior.high,
          category: 'structural',
          polarity: 'high',
        },
        {
          id: 'prev-day-low',
          label: 'Prev Day Low',
          price: prior.low,
          category: 'structural',
          polarity: 'low',
        },
      );
    }
  }

  const current = sessionMap.get(currentSession);
  if (current) {
    levels.push(
      {
        id: 'hod',
        label: 'Current Day High (HOD)',
        price: current.high,
        category: 'session',
        polarity: 'high',
      },
      {
        id: 'lod',
        label: 'Current Day Low (LOD)',
        price: current.low,
        category: 'session',
        polarity: 'low',
      },
    );
  }

  const currentRows = [...(sessionRows.get(currentSession) ?? [])].sort((a, b) => a.minuteOfDay - b.minuteOfDay);

  if (currentRows.length) {
    levels.push({
      id: 'open-nepse-day',
      label: 'NEPSE Day Open',
      price: currentRows[0].candle.o,
      category: 'open',
      polarity: 'neutral',
    });

    const openingMinute = currentRows[0].minuteOfDay;
    const openingRangeRows = currentRows.filter((row) => row.minuteOfDay <= openingMinute + 60);

    if (openingRangeRows.length >= 2) {
      levels.push(
        {
          id: 'opening-range-high',
          label: 'Opening Range High (1H)',
          price: Math.max(...openingRangeRows.map((row) => row.candle.h)),
          category: 'session',
          polarity: 'high',
        },
        {
          id: 'opening-range-low',
          label: 'Opening Range Low (1H)',
          price: Math.min(...openingRangeRows.map((row) => row.candle.l)),
          category: 'session',
          polarity: 'low',
        },
      );
    }
  }

  const latestTimestamp = new Date(candles[candles.length - 1].t).getTime();
  const fourHourRows = candles.filter((item) => new Date(item.t).getTime() >= latestTimestamp - 4 * 60 * 60 * 1000);

  if (fourHourRows.length) {
    levels.push(
      {
        id: 'h4-high',
        label: '4H High',
        price: Math.max(...fourHourRows.map((item) => item.h)),
        category: 'structural',
        polarity: 'high',
      },
      {
        id: 'h4-low',
        label: '4H Low',
        price: Math.min(...fourHourRows.map((item) => item.l)),
        category: 'structural',
        polarity: 'low',
      },
    );
  }

  const currentSessionDate = new Date(`${currentSession}T00:00:00Z`);
  const currentWeekKey = toIsoWeekKey(currentSessionDate);
  const currentMonthKey = toMonthKey(currentSessionDate);

  const weekMap = new Map<string, { high: number; low: number; latest: number }>();
  const monthMap = new Map<string, { high: number; low: number; latest: number }>();

  for (const item of enriched) {
    const weekKey = toIsoWeekKey(item.sessionDate);
    const monthKey = toMonthKey(item.sessionDate);

    const weekState = weekMap.get(weekKey) ?? {
      high: Number.NEGATIVE_INFINITY,
      low: Number.POSITIVE_INFINITY,
      latest: Number.NEGATIVE_INFINITY,
    };

    weekState.high = Math.max(weekState.high, item.candle.h);
    weekState.low = Math.min(weekState.low, item.candle.l);
    weekState.latest = Math.max(weekState.latest, item.sessionDate.getTime());
    weekMap.set(weekKey, weekState);

    const monthState = monthMap.get(monthKey) ?? {
      high: Number.NEGATIVE_INFINITY,
      low: Number.POSITIVE_INFINITY,
      latest: Number.NEGATIVE_INFINITY,
    };

    monthState.high = Math.max(monthState.high, item.candle.h);
    monthState.low = Math.min(monthState.low, item.candle.l);
    monthState.latest = Math.max(monthState.latest, item.sessionDate.getTime());
    monthMap.set(monthKey, monthState);
  }

  const previousWeek = Array.from(weekMap.entries())
    .filter(([key]) => key !== currentWeekKey)
    .sort((a, b) => b[1].latest - a[1].latest)[0];

  if (previousWeek) {
    levels.push(
      {
        id: 'prev-week-high',
        label: 'Prev Week High',
        price: previousWeek[1].high,
        category: 'structural',
        polarity: 'high',
      },
      {
        id: 'prev-week-low',
        label: 'Prev Week Low',
        price: previousWeek[1].low,
        category: 'structural',
        polarity: 'low',
      },
    );
  }

  const previousMonth = Array.from(monthMap.entries())
    .filter(([key]) => key !== currentMonthKey)
    .sort((a, b) => b[1].latest - a[1].latest)[0];

  if (previousMonth) {
    levels.push(
      {
        id: 'prev-month-high',
        label: 'Prev Month High',
        price: previousMonth[1].high,
        category: 'structural',
        polarity: 'high',
      },
      {
        id: 'prev-month-low',
        label: 'Prev Month Low',
        price: previousMonth[1].low,
        category: 'structural',
        polarity: 'low',
      },
    );
  }

  return levels;
}

function getLastFinite(values: Array<number | null>): number | null {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const value = values[i];
    if (value !== null && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function getLastDirection(values: Array<IndicatorDirection | null>): IndicatorDirection | null {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (values[i] !== null) {
      return values[i];
    }
  }

  return null;
}

function calculateSmaFromNullable(values: Array<number | null>, period: number): Array<number | null> {
  const output: Array<number | null> = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) {
    return output;
  }

  for (let i = period - 1; i < values.length; i += 1) {
    const window = values.slice(i - period + 1, i + 1);
    if (window.some((value) => value === null)) {
      continue;
    }

    const sum = (window as number[]).reduce((acc, value) => acc + value, 0);
    output[i] = sum / period;
  }

  return output;
}

function isBullishFvgFilled(candles: OhlcCandle[], startIndex: number, lowerBound: number): boolean {
  for (let i = startIndex; i < candles.length; i += 1) {
    if (candles[i].l <= lowerBound) {
      return true;
    }
  }

  return false;
}

function isBearishFvgFilled(candles: OhlcCandle[], startIndex: number, upperBound: number): boolean {
  for (let i = startIndex; i < candles.length; i += 1) {
    if (candles[i].h >= upperBound) {
      return true;
    }
  }

  return false;
}

function findRunRange(
  candles: OhlcCandle[],
  currentIndex: number,
  mode: 'up' | 'down',
): { high: number; low: number } | null {
  let runStart = currentIndex - 1;

  while (runStart > 0) {
    const current = candles[runStart].c;
    const previous = candles[runStart - 1].c;

    if (mode === 'up' && current > previous) {
      runStart -= 1;
      continue;
    }

    if (mode === 'down' && current < previous) {
      runStart -= 1;
      continue;
    }

    break;
  }

  const runLength = currentIndex - runStart;
  if (runLength < 3) {
    return null;
  }

  const segment = candles.slice(runStart, currentIndex);
  if (!segment.length) {
    return null;
  }

  return {
    high: Math.max(...segment.map((item) => item.h)),
    low: Math.min(...segment.map((item) => item.l)),
  };
}

function getTzParts(date: Date, timeZone: string): ZonedParts | null {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const partMap = new Map<string, string>();
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') {
      partMap.set(part.type, part.value);
    }
  }

  const year = Number(partMap.get('year'));
  const month = Number(partMap.get('month'));
  const day = Number(partMap.get('day'));
  const hour = Number(partMap.get('hour'));
  const minute = Number(partMap.get('minute'));

  if (![year, month, day, hour, minute].every((value) => Number.isFinite(value))) {
    return null;
  }

  return { year, month, day, hour, minute };
}

function toSessionDayKey(parts: ZonedParts): string {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function toIsoDay(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toIsoWeekKey(date: Date): string {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function toMonthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
