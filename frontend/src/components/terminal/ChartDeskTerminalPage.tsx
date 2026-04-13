import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ApexAxisChartSeries, ApexOptions } from 'apexcharts';
import ReactApexChart from 'react-apexcharts';
import { useNavigate, useParams } from 'react-router-dom';
import {
  backfillOhlcSymbol,
  fetchIndicators,
  fetchOhlcBackfillStatus,
  fetchSignal,
  fetchWatchlist,
  startOhlcBackfill,
} from '../../lib/api';
import {
  CisdProjectionLevel,
  FairValueGapZone,
  IndicatorDirection,
  KeyLevel,
  OpenSourceIndicatorBundle,
  SweepEvent,
  buildCisdProjectionLevels,
  buildOpenSourceIndicatorBundle,
  calculateEma,
  calculateMacd,
} from '../../lib/open-source-indicators';
import { confidenceBadgeClass, signalBadgeClass } from '../../lib/signal-ui';
import {
  IndicatorsResponse,
  OhlcCandle,
  OhlcBackfillJobState,
  TradingSignalResponse,
  WatchlistApiRow,
} from '../../types';

const INTERVALS = ['1m', '5m', '15m', '1h', '1d'] as const;
type Interval = (typeof INTERVALS)[number];

const CHART_REFRESH_INTERVAL_MS = 60_000;
const SIGNAL_REFRESH_INTERVAL_MS = 60_000;
const BACKFILL_STATUS_REFRESH_MS = 4_500;

const TOOL_ITEMS = ['Cursor', 'Crosshair', 'Trendline', 'Fib', 'Brush', 'Long', 'Short', 'Text'] as const;

const STRATEGY_PACKS = [
  {
    id: 'sweep-cisd-fvg-keylevels',
    name: 'Sweep, CISD, MTF FVG and Key Levels',
    category: 'liquidity',
    source: 'Open-source logic inspired by public Pine workflows',
    objective: 'Track sweeps, delivery shifts, and imbalances with structural levels.',
  },
  {
    id: 'quantum-risk',
    name: 'QuantumEdge Risk and Trade Manager',
    category: 'risk',
    source: 'Open-source risk scripting patterns',
    objective: 'Use ATR stop distance, position size discipline, and tiered take-profit planning.',
  },
  {
    id: 'supertrend-mtf',
    name: 'MTF Supertrend Confluence',
    category: 'trend',
    source: 'Open-source supertrend stack',
    objective: 'Align local momentum with higher timeframe direction before taking entries.',
  },
  {
    id: 'trend-volume',
    name: 'Trend Trader Pro (EMA + MACD + RVOL)',
    category: 'momentum',
    source: 'Open-source trend and participation systems',
    objective: 'Require momentum and relative-volume sponsorship before execution.',
  },
] as const;

const ALERT_SETTING_PRESETS = [
  {
    id: 'scalping',
    label: 'Scalping',
    macdFast: 8,
    macdSlow: 21,
    macdSignal: 5,
    rsiOverbought: 80,
    rsiOversold: 20,
  },
  {
    id: 'swing',
    label: 'Swing',
    macdFast: 12,
    macdSlow: 26,
    macdSignal: 9,
    rsiOverbought: 70,
    rsiOversold: 30,
  },
  {
    id: 'conservative',
    label: 'Conservative',
    macdFast: 15,
    macdSlow: 35,
    macdSignal: 9,
    rsiOverbought: 65,
    rsiOversold: 35,
  },
] as const;

type StrategyPackId = (typeof STRATEGY_PACKS)[number]['id'];
type StrategyPackCategory = 'all' | (typeof STRATEGY_PACKS)[number]['category'];
type AlertSettingPresetId = (typeof ALERT_SETTING_PRESETS)[number]['id'];
type ToolItem = (typeof TOOL_ITEMS)[number];
type StrategyPackStatus = 'LONG' | 'SHORT' | 'WAIT';

interface StrategyPackReading {
  status: StrategyPackStatus;
  score: number;
  summary: string;
  checks: string[];
}

interface TradeIdeaCard {
  title: string;
  mode: 'LONG' | 'SHORT' | 'NEUTRAL';
  setup: string;
  entry: string;
  invalidation: string;
  target: string;
}

interface AlertFeedItem {
  id: string;
  type: 'SWEEP' | 'CISD' | 'FVG' | 'KEY_LEVEL' | 'CONFLUENCE' | 'MACD' | 'RSI';
  message: string;
  at: string;
}

interface BacktestTradeResult {
  at: string;
  entry: number;
  stop: number;
  target: number;
  exit: number;
  barsHeld: number;
  outcome: 'TARGET' | 'STOP' | 'TIMEOUT';
  rMultiple: number;
}

interface BacktestSummary {
  trades: number;
  wins: number;
  losses: number;
  timeouts: number;
  winRatePct: number;
  avgR: number;
  expectancyR: number;
  totalR: number;
  bestR: number;
  worstR: number;
  maxDrawdownR: number;
}

interface BacktestResult {
  summary: BacktestSummary;
  trades: BacktestTradeResult[];
}

function resolveHigherTimeframes(interval: Interval): Interval[] {
  if (interval === '1m') return ['15m', '1h'];
  if (interval === '5m') return ['15m', '1h'];
  if (interval === '15m') return ['1h', '1d'];
  if (interval === '1h') return ['1d'];
  return ['1d'];
}

function toChartLineFromSeries(
  candles: OhlcCandle[],
  values: Array<number | null>,
): Array<{ x: number; y: number | null }> {
  return candles.map((row, index) => ({
    x: new Date(row.t).getTime(),
    y: values[index] ?? null,
  }));
}

function latestFinite(values: Array<number | null>): number | null {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const value = values[i];
    if (value !== null && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function keyLevelColor(level: KeyLevel): string {
  if (level.category === 'open') return '#f59e0b';
  if (level.polarity === 'high') return '#ef4444';
  if (level.polarity === 'low') return '#22c55e';
  return '#a1a1aa';
}

function fvgColor(zone: FairValueGapZone): string {
  return zone.direction === 'bullish' ? '#22c55e' : '#ef4444';
}

function sweepColor(event: SweepEvent): string {
  return event.direction === 'bullish' ? '#22c55e' : '#ef4444';
}

function nepseStatusLabel(status: StrategyPackStatus): string {
  return status === 'SHORT' ? 'DE-RISK' : status;
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function safeFixed(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return '-';
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '-';
  return parsed.toFixed(digits);
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  return `${value.toFixed(2)}%`;
}

function readStoredValue(key: string, fallback: string): string {
  if (typeof window === 'undefined') {
    return fallback;
  }

  const raw = window.localStorage.getItem(key);
  return raw && raw.trim() ? raw : fallback;
}

function parsePositiveInt(value: string): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return Math.floor(parsed);
}

function parseBoundedNumber(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return clamp(parsed, min, max);
}

function actionabilityClass(label: 'EXECUTABLE' | 'WATCH' | 'BLOCKED'): string {
  if (label === 'EXECUTABLE') return 'border-terminal-green/70 bg-terminal-green/15 text-terminal-green';
  if (label === 'WATCH') return 'border-terminal-amber/70 bg-terminal-amber/15 text-terminal-amber';
  return 'border-terminal-red/70 bg-terminal-red/15 text-terminal-red';
}

function backfillStatusClass(status: string): string {
  if (status === 'RUNNING') return 'border-cyan-300/70 bg-cyan-500/15 text-cyan-100';
  if (status === 'COMPLETED') return 'border-terminal-green/70 bg-terminal-green/15 text-terminal-green';
  if (status === 'FAILED') return 'border-terminal-red/70 bg-terminal-red/15 text-terminal-red';
  return 'border-zinc-700 bg-zinc-900/70 text-zinc-300';
}

function parseProjectionMultipliers(raw: string): number[] {
  const parsed = raw
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item > 0)
    .map((item) => Number(item.toFixed(4)));

  if (!parsed.length) {
    return [0.5, 1, 1.5, 2];
  }

  return Array.from(new Set(parsed)).sort((a, b) => a - b);
}

function isNepseLateWeek(isoDate: string): boolean {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kathmandu',
    weekday: 'short',
  });

  const day = formatter.format(new Date(isoDate));
  return day === 'Wed' || day === 'Thu';
}

function triggerBrowserNotification(title: string, body: string): void {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return;
  }

  if (Notification.permission === 'granted') {
    new Notification(title, { body });
    return;
  }

  if (Notification.permission === 'default') {
    void Notification.requestPermission().then((permission) => {
      if (permission === 'granted') {
        new Notification(title, { body });
      }
    });
  }
}

function calculateMaxDrawdown(rCurve: number[]): number {
  let peak = 0;
  let trough = 0;
  let maxDrawdown = 0;

  for (const value of rCurve) {
    if (value > peak) {
      peak = value;
      trough = value;
      continue;
    }

    if (value < trough) {
      trough = value;
      maxDrawdown = Math.min(maxDrawdown, trough - peak);
    }
  }

  return Math.abs(maxDrawdown);
}

function runNepseLongOnlyBacktest(params: {
  candles: OhlcCandle[];
  bundle: OpenSourceIndicatorBundle;
  packId: StrategyPackId;
  lookaheadBars: number;
  cooldownBars: number;
}): BacktestResult {
  const { candles, bundle, packId, lookaheadBars, cooldownBars } = params;

  if (candles.length < 80) {
    return {
      summary: {
        trades: 0,
        wins: 0,
        losses: 0,
        timeouts: 0,
        winRatePct: 0,
        avgR: 0,
        expectancyR: 0,
        totalR: 0,
        bestR: 0,
        worstR: 0,
        maxDrawdownR: 0,
      },
      trades: [],
    };
  }

  const ema8 = calculateEma(candles.map((item) => item.c), 8);
  const ema21 = calculateEma(candles.map((item) => item.c), 21);
  const trades: BacktestTradeResult[] = [];
  let lastEntryIndex = -999;

  for (let i = 55; i < candles.length - lookaheadBars - 2; i += 1) {
    if (i - lastEntryIndex < cooldownBars) {
      continue;
    }

    const adx = bundle.adx14.adx[i] ?? 0;
    const rvol = bundle.relativeVolume20[i] ?? 0;
    const rsi14 = bundle.rsi14[i] ?? 50;
    const stochK = bundle.stochRsi.k[i] ?? 50;
    const stochD = bundle.stochRsi.d[i] ?? 50;
    const macdLine = bundle.macd12_26_9.line[i] ?? 0;
    const macdSignal = bundle.macd12_26_9.signal[i] ?? 0;
    const macdHistogram = bundle.macd12_26_9.histogram[i] ?? 0;
    const trend = bundle.supertrend.trend[i];
    const supertrendLine = bundle.supertrend.line[i] ?? candles[i].c;
    const atr = bundle.atr14[i] ?? candles[i].c * 0.012;

    const hasBullSweep = bundle.sweepEvents.some((event) => event.at === candles[i].t && event.direction === 'bullish');
    const hasBullCisd = bundle.cisdEvents.some((event) => event.at === candles[i].t && event.direction === 'bullish');
    const hasLateWeekSweep = bundle.nepseLateWeekSweeps.some(
      (event) => event.at === candles[i].t && event.direction === 'bullish',
    );

    let longSignal = false;

    if (packId === 'sweep-cisd-fvg-keylevels') {
      longSignal =
        (hasBullSweep || hasBullCisd || hasLateWeekSweep) &&
        trend === 'bullish' &&
        rvol >= 0.9 &&
        macdLine >= macdSignal &&
        rsi14 >= 45;
    } else if (packId === 'quantum-risk') {
      longSignal =
        adx >= 18 &&
        rvol >= 1 &&
        stochK > stochD &&
        candles[i].c >= supertrendLine &&
        rsi14 >= 42 &&
        rsi14 <= 78 &&
        macdLine >= macdSignal;
    } else if (packId === 'supertrend-mtf') {
      longSignal = trend === 'bullish' && adx >= 20 && candles[i].c >= supertrendLine && macdLine >= macdSignal;
    } else {
      longSignal =
        ema8[i] !== null &&
        ema21[i] !== null &&
        ema8[i]! > ema21[i]! &&
        adx >= 20 &&
        rvol >= 1.15 &&
        stochK > stochD &&
        rsi14 >= 50 &&
        macdHistogram >= 0;
    }

    if (!longSignal) {
      continue;
    }

    const entryIndex = i + 1;
    const entry = candles[entryIndex].o;
    const stopDistance = Math.max(atr, entry * 0.008);
    const targetDistance = Math.max(atr * 2, entry * 0.016);
    const stop = entry - stopDistance;
    const target = entry + targetDistance;

    let outcome: BacktestTradeResult['outcome'] = 'TIMEOUT';
    let exit = candles[entryIndex + lookaheadBars].c;
    let barsHeld = lookaheadBars;

    for (let j = entryIndex + 1; j <= entryIndex + lookaheadBars && j < candles.length; j += 1) {
      const row = candles[j];

      if (row.l <= stop && row.h >= target) {
        outcome = 'STOP';
        exit = stop;
        barsHeld = j - entryIndex;
        break;
      }

      if (row.h >= target) {
        outcome = 'TARGET';
        exit = target;
        barsHeld = j - entryIndex;
        break;
      }

      if (row.l <= stop) {
        outcome = 'STOP';
        exit = stop;
        barsHeld = j - entryIndex;
        break;
      }

      if (j === entryIndex + lookaheadBars || j === candles.length - 1) {
        outcome = 'TIMEOUT';
        exit = row.c;
        barsHeld = j - entryIndex;
      }
    }

    const riskPerShare = Math.max(entry - stop, 0.0001);
    const rMultiple = (exit - entry) / riskPerShare;

    trades.push({
      at: candles[entryIndex].t,
      entry,
      stop,
      target,
      exit,
      barsHeld,
      outcome,
      rMultiple,
    });

    lastEntryIndex = entryIndex;
  }

  const wins = trades.filter((trade) => trade.rMultiple > 0).length;
  const losses = trades.filter((trade) => trade.rMultiple < 0).length;
  const timeouts = trades.filter((trade) => trade.outcome === 'TIMEOUT').length;
  const totalR = trades.reduce((sum, trade) => sum + trade.rMultiple, 0);
  const avgR = trades.length ? totalR / trades.length : 0;

  const positive = trades.filter((trade) => trade.rMultiple > 0).map((trade) => trade.rMultiple);
  const negative = trades.filter((trade) => trade.rMultiple < 0).map((trade) => Math.abs(trade.rMultiple));

  const avgWin = positive.length ? positive.reduce((sum, value) => sum + value, 0) / positive.length : 0;
  const avgLoss = negative.length ? negative.reduce((sum, value) => sum + value, 0) / negative.length : 0;
  const winRate = trades.length ? wins / trades.length : 0;
  const lossRate = trades.length ? losses / trades.length : 0;
  const expectancyR = avgWin * winRate - avgLoss * lossRate;

  let runningR = 0;
  const curve: number[] = [];
  for (const trade of trades) {
    runningR += trade.rMultiple;
    curve.push(runningR);
  }

  const summary: BacktestSummary = {
    trades: trades.length,
    wins,
    losses,
    timeouts,
    winRatePct: trades.length ? winRate * 100 : 0,
    avgR,
    expectancyR,
    totalR,
    bestR: trades.length ? Math.max(...trades.map((trade) => trade.rMultiple)) : 0,
    worstR: trades.length ? Math.min(...trades.map((trade) => trade.rMultiple)) : 0,
    maxDrawdownR: calculateMaxDrawdown(curve),
  };

  return {
    summary,
    trades,
  };
}

export function ChartDeskTerminalPage() {
  const { symbol: symbolParam } = useParams<{ symbol?: string }>();
  const navigate = useNavigate();

  const [watchlist, setWatchlist] = useState<WatchlistApiRow[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState(symbolParam?.toUpperCase() ?? '');
  const [interval, setInterval] = useState<Interval>('1d');
  const [showSma20, setShowSma20] = useState(false);
  const [showEma20, setShowEma20] = useState(true);
  const [showBollinger, setShowBollinger] = useState(true);
  const [showVwap, setShowVwap] = useState(false);
  const [showStructure, setShowStructure] = useState(true);
  const [showSupertrend, setShowSupertrend] = useState(true);
  const [showKeyLevels, setShowKeyLevels] = useState(true);
  const [showFvg, setShowFvg] = useState(true);
  const [showMtfFvg, setShowMtfFvg] = useState(true);
  const [showSweeps, setShowSweeps] = useState(true);
  const [payload, setPayload] = useState<IndicatorsResponse | null>(null);
  const [mtfContext, setMtfContext] = useState<Array<{ interval: Interval; candles: OhlcCandle[] }>>([]);
  const [signal, setSignal] = useState<TradingSignalResponse | null>(null);
  const [activeDataInterval, setActiveDataInterval] = useState<Interval>('1d');
  const [activeTool, setActiveTool] = useState<ToolItem>('Cursor');
  const [packCategory, setPackCategory] = useState<StrategyPackCategory>('all');
  const [strategyPack, setStrategyPack] = useState<StrategyPackId>('sweep-cisd-fvg-keylevels');
  const [historyHint, setHistoryHint] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [minQuality, setMinQuality] = useState(() => readStoredValue('chartdesk.minQuality', '82'));
  const [minRiskReward, setMinRiskReward] = useState(() => readStoredValue('chartdesk.minRR', '1.8'));
  const [minSampleSize, setMinSampleSize] = useState(() => readStoredValue('chartdesk.minSample', '10'));
  const [backfillState, setBackfillState] = useState<OhlcBackfillJobState | null>(null);
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [symbolBackfillBusy, setSymbolBackfillBusy] = useState(false);
  const [backfillFeedback, setBackfillFeedback] = useState('');
  const [backfillError, setBackfillError] = useState('');
  const [backfillSymbolsLimit, setBackfillSymbolsLimit] = useState(() =>
    readStoredValue('chartdesk.backfillSymbolsLimit', '220'),
  );
  const [backfillSinceDays, setBackfillSinceDays] = useState(() =>
    readStoredValue('chartdesk.backfillSinceDays', ''),
  );
  const [projectionMultipliersRaw, setProjectionMultipliersRaw] = useState(() =>
    readStoredValue('chartdesk.cisdProjectionMultipliers', '0.5,1,1.5,2'),
  );
  const [showCisdProjection, setShowCisdProjection] = useState(true);
  const [alertsEnabled, setAlertsEnabled] = useState(true);
  const [alertOnSweep, setAlertOnSweep] = useState(true);
  const [alertOnCisd, setAlertOnCisd] = useState(true);
  const [alertOnFvgTouch, setAlertOnFvgTouch] = useState(true);
  const [alertOnKeyLevels, setAlertOnKeyLevels] = useState(true);
  const [alertOnConfluence, setAlertOnConfluence] = useState(true);
  const [alertOnMacdCross, setAlertOnMacdCross] = useState(true);
  const [alertOnRsiZones, setAlertOnRsiZones] = useState(true);
  const [macdFastPeriodRaw, setMacdFastPeriodRaw] = useState(() => readStoredValue('chartdesk.alertMacdFast', '12'));
  const [macdSlowPeriodRaw, setMacdSlowPeriodRaw] = useState(() => readStoredValue('chartdesk.alertMacdSlow', '26'));
  const [macdSignalPeriodRaw, setMacdSignalPeriodRaw] = useState(() => readStoredValue('chartdesk.alertMacdSignal', '9'));
  const [rsiOverboughtRaw, setRsiOverboughtRaw] = useState(() => readStoredValue('chartdesk.alertRsiOverbought', '70'));
  const [rsiOversoldRaw, setRsiOversoldRaw] = useState(() => readStoredValue('chartdesk.alertRsiOversold', '30'));
  const [alertFeed, setAlertFeed] = useState<AlertFeedItem[]>([]);
  const [backtestLookahead, setBacktestLookahead] = useState(() => readStoredValue('chartdesk.backtestLookahead', '12'));
  const [backtestCooldownBars, setBacktestCooldownBars] = useState(() => readStoredValue('chartdesk.backtestCooldown', '7'));
  const lastAlertRef = useRef<{
    sweepId: string;
    cisdId: string;
    fvgTouchId: string;
    keyBreakId: string;
    confluenceBucket: string;
    macdCrossId: string;
    rsiZoneId: string;
  }>({
    sweepId: '',
    cisdId: '',
    fvgTouchId: '',
    keyBreakId: '',
    confluenceBucket: '',
    macdCrossId: '',
    rsiZoneId: '',
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('chartdesk.minQuality', minQuality);
    window.localStorage.setItem('chartdesk.minRR', minRiskReward);
    window.localStorage.setItem('chartdesk.minSample', minSampleSize);
  }, [minQuality, minRiskReward, minSampleSize]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('chartdesk.backfillSymbolsLimit', backfillSymbolsLimit);
    window.localStorage.setItem('chartdesk.backfillSinceDays', backfillSinceDays);
  }, [backfillSinceDays, backfillSymbolsLimit]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('chartdesk.cisdProjectionMultipliers', projectionMultipliersRaw);
  }, [projectionMultipliersRaw]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('chartdesk.backtestLookahead', backtestLookahead);
    window.localStorage.setItem('chartdesk.backtestCooldown', backtestCooldownBars);
  }, [backtestCooldownBars, backtestLookahead]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('chartdesk.alertMacdFast', macdFastPeriodRaw);
    window.localStorage.setItem('chartdesk.alertMacdSlow', macdSlowPeriodRaw);
    window.localStorage.setItem('chartdesk.alertMacdSignal', macdSignalPeriodRaw);
    window.localStorage.setItem('chartdesk.alertRsiOverbought', rsiOverboughtRaw);
    window.localStorage.setItem('chartdesk.alertRsiOversold', rsiOversoldRaw);
  }, [macdFastPeriodRaw, macdSignalPeriodRaw, macdSlowPeriodRaw, rsiOverboughtRaw, rsiOversoldRaw]);

  useEffect(() => {
    fetchWatchlist()
      .then((rows) => {
        setWatchlist(rows);

        if (selectedSymbol) return;

        const fallback = symbolParam?.toUpperCase() || rows[0]?.symbol;
        if (!fallback) return;

        setSelectedSymbol(fallback);
        navigate(`/chart-desk/${fallback}`, { replace: true });
      })
      .catch(() => setWatchlist([]));
  }, [navigate, selectedSymbol, symbolParam]);

  useEffect(() => {
    if (!symbolParam) return;
    const normalized = symbolParam.toUpperCase();
    if (normalized !== selectedSymbol) {
      setSelectedSymbol(normalized);
    }
  }, [selectedSymbol, symbolParam]);

  const loadData = useCallback(async () => {
    if (!selectedSymbol) return;

    setLoading(true);

    try {
      const requested = await fetchIndicators(selectedSymbol, interval, 320);
      let best = requested;
      let bestInterval: Interval = interval;
      let hint = '';

      if (requested.candles.length < 50) {
        const fallbackOrder = INTERVALS.filter((item) => item !== interval);
        for (const candidate of fallbackOrder) {
          const candidateLimit = candidate === '1m' ? 1000 : 400;
          const candidateResponse = await fetchIndicators(selectedSymbol, candidate, candidateLimit);

          if (candidateResponse.candles.length > best.candles.length) {
            best = candidateResponse;
            bestInterval = candidate;
          }

          if (best.candles.length >= 90) {
            break;
          }
        }

        if (best.candles.length === 0) {
          hint = 'No historical candles available yet. Wait for data collection to continue.';
        } else if (bestInterval !== interval) {
          hint = `Limited ${interval} history. Showing ${bestInterval} data (${best.candles.length} candles).`;
        } else if (best.candles.length < 40) {
          hint = `History is still warming up (${best.candles.length} candles). Signals may stay HOLD until more data arrives.`;
        }
      }

      const higherIntervals = resolveHigherTimeframes(bestInterval).filter(
        (value, index, items) => items.indexOf(value) === index && value !== bestInterval,
      );

      const mtfResponses = await Promise.all(
        higherIntervals.map(async (frame) => {
          try {
            const context = await fetchIndicators(selectedSymbol, frame, frame === '1d' ? 420 : 620);
            return {
              interval: frame,
              candles: context.candles,
            };
          } catch {
            return null;
          }
        }),
      );

      setMtfContext(
        mtfResponses.filter(
          (item): item is { interval: Interval; candles: OhlcCandle[] } => item !== null && item.candles.length > 0,
        ),
      );

      setPayload(best);
      setActiveDataInterval(bestInterval);
      setHistoryHint(hint);
      setError('');
    } catch (requestError) {
      setPayload(null);
      setMtfContext([]);
      setActiveDataInterval(interval);
      setHistoryHint('');
      setError(requestError instanceof Error ? requestError.message : 'Unable to load chart feed.');
    } finally {
      setLoading(false);
    }
  }, [interval, selectedSymbol]);

  const loadBackfillStatus = useCallback(async () => {
    try {
      const status = await fetchOhlcBackfillStatus();
      setBackfillState(status);
    } catch {
      // Keep chart interactions responsive even if status polling fails.
    }
  }, []);

  const buildBackfillRequest = useCallback(() => {
    const request: {
      symbolsLimit?: number;
      sinceDays?: number;
      throttleMs?: number;
    } = {
      throttleMs: 45,
    };

    const symbolsLimit = parsePositiveInt(backfillSymbolsLimit);
    const sinceDays = parsePositiveInt(backfillSinceDays);

    if (symbolsLimit) {
      request.symbolsLimit = symbolsLimit;
    }

    if (sinceDays) {
      request.sinceDays = sinceDays;
    }

    return request;
  }, [backfillSinceDays, backfillSymbolsLimit]);

  const startAllBackfill = useCallback(async () => {
    setBackfillBusy(true);
    setBackfillError('');
    setBackfillFeedback('');

    try {
      const request = buildBackfillRequest();
      const status = await startOhlcBackfill(request);
      setBackfillState(status);
      setBackfillFeedback(
        status.status === 'RUNNING'
          ? 'Historical bootstrap started. Chart quality improves as candles are imported.'
          : `Backfill state: ${status.status}`,
      );
    } catch (requestError) {
      setBackfillError(requestError instanceof Error ? requestError.message : 'Failed to start OHLC backfill.');
    } finally {
      setBackfillBusy(false);
    }
  }, [buildBackfillRequest]);

  const backfillSelectedSymbol = useCallback(async () => {
    if (!selectedSymbol) return;

    setSymbolBackfillBusy(true);
    setBackfillError('');
    setBackfillFeedback('');

    try {
      const report = await backfillOhlcSymbol(selectedSymbol, {
        sinceDays: parsePositiveInt(backfillSinceDays),
        throttleMs: 0,
      });

      if (report.error) {
        setBackfillError(report.error);
      } else {
        setBackfillFeedback(
          `${report.symbol}: imported ${report.insertedCandles} candles from ${report.fetchedRows} rows.`,
        );
      }

      await loadData();
      try {
        const refreshedSignal = await fetchSignal(selectedSymbol);
        setSignal(refreshedSignal);
      } catch {
        // Leave previous signal payload in place if refresh fails.
      }
      await loadBackfillStatus();
    } catch (requestError) {
      setBackfillError(
        requestError instanceof Error ? requestError.message : 'Failed to backfill selected symbol history.',
      );
    } finally {
      setSymbolBackfillBusy(false);
    }
  }, [backfillSinceDays, loadBackfillStatus, loadData, selectedSymbol]);

  useEffect(() => {
    void loadData();

    const timer = window.setInterval(() => {
      void loadData();
    }, CHART_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [loadData]);

  useEffect(() => {
    void loadBackfillStatus();
  }, [loadBackfillStatus]);

  useEffect(() => {
    if (backfillState?.status !== 'RUNNING') {
      return;
    }

    const timer = window.setInterval(() => {
      void loadBackfillStatus();
    }, BACKFILL_STATUS_REFRESH_MS);

    return () => window.clearInterval(timer);
  }, [backfillState?.status, loadBackfillStatus]);

  useEffect(() => {
    if (backfillState?.status === 'COMPLETED') {
      void loadData();
    }
  }, [backfillState?.status, loadData]);

  useEffect(() => {
    if (!selectedSymbol) {
      setSignal(null);
      return;
    }

    let active = true;

    const loadSignal = async () => {
      try {
        const response = await fetchSignal(selectedSymbol);
        if (!active) return;
        setSignal(response);
      } catch {
        if (!active) return;
        setSignal(null);
      }
    };

    void loadSignal();

    const timer = window.setInterval(() => {
      void loadSignal();
    }, SIGNAL_REFRESH_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [selectedSymbol]);

  const openSourceBundle = useMemo<OpenSourceIndicatorBundle | null>(() => {
    if (!payload?.candles.length) {
      return null;
    }

    return buildOpenSourceIndicatorBundle({
      candles: payload.candles,
      sourceInterval: activeDataInterval,
      multiTimeframeCandles: mtfContext,
    });
  }, [activeDataInterval, mtfContext, payload?.candles]);

  const cisdProjectionMultipliers = useMemo(
    () => parseProjectionMultipliers(projectionMultipliersRaw),
    [projectionMultipliersRaw],
  );

  const latestCisd = useMemo(() => {
    if (!openSourceBundle) {
      return null;
    }

    return openSourceBundle.cisdEvents[openSourceBundle.cisdEvents.length - 1] ?? null;
  }, [openSourceBundle]);

  const cisdProjectionLevels = useMemo<CisdProjectionLevel[]>(() => {
    return buildCisdProjectionLevels(latestCisd, cisdProjectionMultipliers);
  }, [cisdProjectionMultipliers, latestCisd]);

  const latestNepseLateWeekSweep = useMemo(() => {
    if (!openSourceBundle) {
      return null;
    }

    return openSourceBundle.latest.latestLateWeekSweep;
  }, [openSourceBundle]);

  const parsedMacdFastPeriod = Math.max(2, Math.min(50, parsePositiveInt(macdFastPeriodRaw) ?? 12));
  const parsedMacdSlowPeriod = Math.max(
    parsedMacdFastPeriod + 1,
    Math.min(120, parsePositiveInt(macdSlowPeriodRaw) ?? 26),
  );
  const parsedMacdSignalPeriod = Math.max(2, Math.min(50, parsePositiveInt(macdSignalPeriodRaw) ?? 9));

  const parsedRsiOverbought = parseBoundedNumber(rsiOverboughtRaw, 70, 50, 95);
  const parsedRsiOversold = parseBoundedNumber(rsiOversoldRaw, 30, 5, 50);
  const rsiOversoldThreshold = Math.min(parsedRsiOversold, parsedRsiOverbought - 5);
  const rsiOverboughtThreshold = Math.max(parsedRsiOverbought, rsiOversoldThreshold + 5);

  const customMacdSeries = useMemo(() => {
    if (!payload?.candles.length) {
      return { line: [] as Array<number | null>, signal: [] as Array<number | null>, histogram: [] as Array<number | null> };
    }

    return calculateMacd(
      payload.candles.map((item) => item.c),
      parsedMacdFastPeriod,
      parsedMacdSlowPeriod,
      parsedMacdSignalPeriod,
    );
  }, [parsedMacdFastPeriod, parsedMacdSignalPeriod, parsedMacdSlowPeriod, payload?.candles]);

  const activeAlertPreset = useMemo<AlertSettingPresetId | null>(() => {
    const matchedPreset = ALERT_SETTING_PRESETS.find(
      (preset) =>
        preset.macdFast === parsedMacdFastPeriod &&
        preset.macdSlow === parsedMacdSlowPeriod &&
        preset.macdSignal === parsedMacdSignalPeriod &&
        preset.rsiOverbought === rsiOverboughtThreshold &&
        preset.rsiOversold === rsiOversoldThreshold,
    );

    return matchedPreset?.id ?? null;
  }, [parsedMacdFastPeriod, parsedMacdSignalPeriod, parsedMacdSlowPeriod, rsiOverboughtThreshold, rsiOversoldThreshold]);

  const applyAlertSettingPreset = useCallback((presetId: AlertSettingPresetId) => {
    const preset = ALERT_SETTING_PRESETS.find((item) => item.id === presetId);
    if (!preset) {
      return;
    }

    setMacdFastPeriodRaw(String(preset.macdFast));
    setMacdSlowPeriodRaw(String(preset.macdSlow));
    setMacdSignalPeriodRaw(String(preset.macdSignal));
    setRsiOverboughtRaw(String(preset.rsiOverbought));
    setRsiOversoldRaw(String(preset.rsiOversold));
  }, []);

  const parsedBacktestLookahead = Math.max(4, Math.min(40, parsePositiveInt(backtestLookahead) ?? 12));
  const parsedBacktestCooldown = Math.max(1, Math.min(20, parsePositiveInt(backtestCooldownBars) ?? 7));

  const backtestResult = useMemo<BacktestResult | null>(() => {
    if (!payload?.candles.length || !openSourceBundle) {
      return null;
    }

    return runNepseLongOnlyBacktest({
      candles: payload.candles,
      bundle: openSourceBundle,
      packId: strategyPack,
      lookaheadBars: parsedBacktestLookahead,
      cooldownBars: parsedBacktestCooldown,
    });
  }, [openSourceBundle, parsedBacktestCooldown, parsedBacktestLookahead, payload?.candles, strategyPack]);

  const availablePacks = useMemo(() => {
    if (packCategory === 'all') {
      return STRATEGY_PACKS;
    }

    return STRATEGY_PACKS.filter((item) => item.category === packCategory);
  }, [packCategory]);

  useEffect(() => {
    if (!availablePacks.some((item) => item.id === strategyPack)) {
      setStrategyPack(availablePacks[0]?.id ?? 'sweep-cisd-fvg-keylevels');
    }
  }, [availablePacks, strategyPack]);

  const priceSeries = useMemo(() => {
    if (!payload) return [] as ApexAxisChartSeries;

    const series: ApexAxisChartSeries = [
      {
        name: `${payload.symbol} Candles`,
        type: 'candlestick',
        data: payload.candles.map((row) => ({
          x: new Date(row.t).getTime(),
          y: [row.o, row.h, row.l, row.c],
        })),
      },
    ];

    if (showSma20) {
      series.push({
        name: 'SMA20',
        type: 'line',
        data: payload.sma20.map((point) => ({
          x: new Date(point.t).getTime(),
          y: point.value,
        })),
      });
    }

    if (showEma20) {
      series.push({
        name: 'EMA20',
        type: 'line',
        data: payload.ema20.map((point) => ({
          x: new Date(point.t).getTime(),
          y: point.value,
        })),
      });
    }

    if (showBollinger) {
      series.push(
        {
          name: 'Bollinger Upper',
          type: 'line',
          data: payload.bollinger.upper.map((point) => ({
            x: new Date(point.t).getTime(),
            y: point.value,
          })),
        },
        {
          name: 'Bollinger Lower',
          type: 'line',
          data: payload.bollinger.lower.map((point) => ({
            x: new Date(point.t).getTime(),
            y: point.value,
          })),
        },
      );
    }

    if (showVwap) {
      series.push({
        name: 'VWAP',
        type: 'line',
        data: payload.vwap.map((point) => ({
          x: new Date(point.t).getTime(),
          y: point.value,
        })),
      });
    }

    if (showSupertrend && openSourceBundle) {
      series.push({
        name: 'Supertrend',
        type: 'line',
        data: toChartLineFromSeries(payload.candles, openSourceBundle.supertrend.line),
      });
    }

    return series;
  }, [openSourceBundle, payload, showBollinger, showEma20, showSma20, showSupertrend, showVwap]);

  const volumeSeries = useMemo<ApexAxisChartSeries>(() => {
    if (!payload) return [];

    return [
      {
        name: 'Volume',
        type: 'bar',
        data: payload.candles.map((row) => ({
          x: new Date(row.t).getTime(),
          y: row.v ?? 0,
        })),
      },
    ];
  }, [payload]);

  const chartOptions = useMemo<ApexOptions>(() => {
    const structureAnnotations =
      showStructure && signal
        ? [
            ...signal.structure.supportLevels.slice(0, 3).map((level, index) => ({
              y: level.price,
              borderColor: '#22c55e',
              strokeDashArray: 4,
              label: {
                text: `S${index + 1} ${safeFixed(level.price, 2)} (${level.touches}x)`,
                style: {
                  background: '#052e16',
                  color: '#86efac',
                  fontSize: '10px',
                },
              },
            })),
            ...signal.structure.resistanceLevels.slice(0, 3).map((level, index) => ({
              y: level.price,
              borderColor: '#ef4444',
              strokeDashArray: 4,
              label: {
                text: `R${index + 1} ${safeFixed(level.price, 2)} (${level.touches}x)`,
                style: {
                  background: '#450a0a',
                  color: '#fca5a5',
                  fontSize: '10px',
                },
              },
            })),
          ]
        : [];

    const keyLevelAnnotations =
      showKeyLevels && openSourceBundle
        ? openSourceBundle.keyLevels.slice(0, 16).map((level) => ({
            y: level.price,
            borderColor: keyLevelColor(level),
            strokeDashArray: level.category === 'open' ? 2 : 5,
            label: {
              text: `${level.label} ${safeFixed(level.price, 2)}`,
              style: {
                background: '#09090b',
                color: '#d4d4d8',
                fontSize: '10px',
              },
            },
          }))
        : [];

    const fvgAnnotations =
      openSourceBundle && (showFvg || showMtfFvg)
        ? [
            ...(showFvg
              ? openSourceBundle.fvgZones.slice(-4).map((zone) => ({
                  y: zone.midpoint,
                  borderColor: fvgColor(zone),
                  strokeDashArray: 1,
                  label: {
                    text: `FVG ${zone.direction === 'bullish' ? 'BULL' : 'BEAR'} ${safeFixed(zone.midpoint, 2)}`,
                    style: {
                      background: '#0b0f14',
                      color: '#a1a1aa',
                      fontSize: '10px',
                    },
                  },
                }))
              : []),
            ...(showMtfFvg
              ? openSourceBundle.mtfFvgZones.slice(-6).map((zone) => ({
                  y: zone.midpoint,
                  borderColor: fvgColor(zone),
                  strokeDashArray: 7,
                  label: {
                    text: `${zone.sourceInterval} FVG ${safeFixed(zone.midpoint, 2)}`,
                    style: {
                      background: '#111827',
                      color: '#9ca3af',
                      fontSize: '10px',
                    },
                  },
                }))
              : []),
          ]
        : [];

    const sweepPoints =
      showSweeps && openSourceBundle
        ? openSourceBundle.sweepEvents.slice(-8).map((event) => ({
            x: new Date(event.at).getTime(),
            y: event.level,
            marker: {
              size: 5,
              fillColor: sweepColor(event),
              strokeColor: '#020617',
            },
            label: {
              borderColor: sweepColor(event),
              style: {
                background: '#09090b',
                color: '#e4e4e7',
                fontSize: '10px',
              },
              text: event.direction === 'bullish' ? 'Sweep Up' : 'Sweep Down',
            },
          }))
        : [];

    const lateWeekSweepPoints =
      showSweeps && openSourceBundle
        ? openSourceBundle.nepseLateWeekSweeps.slice(-4).map((event) => ({
            x: new Date(event.at).getTime(),
            y: event.level,
            marker: {
              size: 7,
              fillColor: '#facc15',
              strokeColor: '#78350f',
            },
            label: {
              borderColor: '#facc15',
              style: {
                background: '#422006',
                color: '#fef08a',
                fontSize: '10px',
              },
              text: 'NEPSE Late-Week Sweep',
            },
          }))
        : [];

    const cisdProjectionAnnotations =
      showCisdProjection && cisdProjectionLevels.length
        ? cisdProjectionLevels.map((projection) => ({
            y: projection.price,
            borderColor: projection.direction === 'bullish' ? '#4ade80' : '#fb7185',
            strokeDashArray: 9,
            label: {
              text: `${projection.label} ${safeFixed(projection.price, 2)}`,
              style: {
                background: '#101827',
                color: '#d1d5db',
                fontSize: '10px',
              },
            },
          }))
        : [];

    return {
      chart: {
        type: 'candlestick',
        toolbar: {
          show: true,
          tools: {
            pan: true,
            zoom: true,
            zoomin: true,
            zoomout: true,
            reset: true,
          },
        },
        animations: { enabled: false },
        background: 'transparent',
        foreColor: '#d4d4d8',
      },
      dataLabels: {
        enabled: false,
      },
      stroke: {
        width: 2,
        curve: 'straight',
      },
      colors: ['#94a3b8', '#f59e0b', '#34d399', '#a1a1aa', '#a1a1aa', '#22d3ee', '#fbbf24'],
      annotations: {
        yaxis: [...structureAnnotations, ...keyLevelAnnotations, ...fvgAnnotations, ...cisdProjectionAnnotations],
        points: [...sweepPoints, ...lateWeekSweepPoints],
      },
      grid: {
        borderColor: '#2f2f35',
        strokeDashArray: 3,
      },
      xaxis: {
        type: 'datetime',
        labels: {
          datetimeUTC: false,
          style: { colors: '#a1a1aa' },
        },
      },
      yaxis: {
        labels: {
          formatter: (value) => safeFixed(value, 2),
          style: { colors: '#a1a1aa' },
        },
        tooltip: {
          enabled: true,
        },
      },
      legend: {
        show: true,
        position: 'top',
        horizontalAlign: 'left',
        labels: { colors: '#d4d4d8' },
      },
      plotOptions: {
        candlestick: {
          colors: {
            upward: '#22c55e',
            downward: '#ef4444',
          },
          wick: {
            useFillColor: true,
          },
        },
      },
      tooltip: {
        theme: 'dark',
      },
    };
  }, [cisdProjectionLevels, openSourceBundle, showCisdProjection, showFvg, showKeyLevels, showMtfFvg, showStructure, showSweeps, signal]);

  const volumeOptions = useMemo<ApexOptions>(() => {
    return {
      chart: {
        type: 'bar',
        animations: { enabled: false },
        toolbar: { show: false },
        background: 'transparent',
        foreColor: '#a1a1aa',
      },
      dataLabels: {
        enabled: false,
      },
      plotOptions: {
        bar: {
          columnWidth: '72%',
        },
      },
      colors: ['#52525b'],
      grid: {
        borderColor: '#26262b',
        strokeDashArray: 2,
      },
      xaxis: {
        type: 'datetime',
        labels: {
          datetimeUTC: false,
          style: { colors: '#71717a' },
        },
      },
      yaxis: {
        labels: {
          style: { colors: '#71717a' },
        },
      },
      tooltip: {
        theme: 'dark',
      },
    };
  }, []);

  const adxSeries = useMemo<ApexAxisChartSeries>(() => {
    if (!payload || !openSourceBundle) return [];

    return [
      {
        name: 'ADX 14',
        type: 'line',
        data: toChartLineFromSeries(payload.candles, openSourceBundle.adx14.adx),
      },
      {
        name: '+DI',
        type: 'line',
        data: toChartLineFromSeries(payload.candles, openSourceBundle.adx14.plusDi),
      },
      {
        name: '-DI',
        type: 'line',
        data: toChartLineFromSeries(payload.candles, openSourceBundle.adx14.minusDi),
      },
    ];
  }, [openSourceBundle, payload]);

  const adxOptions = useMemo<ApexOptions>(() => {
    return {
      chart: {
        type: 'line',
        animations: { enabled: false },
        toolbar: { show: false },
        background: 'transparent',
      },
      stroke: {
        width: 2,
        curve: 'smooth',
      },
      colors: ['#f59e0b', '#22c55e', '#ef4444'],
      dataLabels: { enabled: false },
      xaxis: {
        type: 'datetime',
        labels: {
          datetimeUTC: false,
          style: { colors: '#71717a' },
        },
      },
      yaxis: {
        min: 0,
        max: 100,
        labels: {
          style: { colors: '#71717a' },
        },
      },
      annotations: {
        yaxis: [
          {
            y: 20,
            borderColor: '#52525b',
            strokeDashArray: 3,
          },
        ],
      },
      legend: {
        position: 'top',
        horizontalAlign: 'left',
        labels: { colors: '#a1a1aa' },
      },
      grid: {
        borderColor: '#27272a',
        strokeDashArray: 2,
      },
      tooltip: { theme: 'dark' },
    };
  }, []);

  const stochSeries = useMemo<ApexAxisChartSeries>(() => {
    if (!payload || !openSourceBundle) return [];

    return [
      {
        name: '%K',
        type: 'line',
        data: toChartLineFromSeries(payload.candles, openSourceBundle.stochRsi.k),
      },
      {
        name: '%D',
        type: 'line',
        data: toChartLineFromSeries(payload.candles, openSourceBundle.stochRsi.d),
      },
      {
        name: 'RVOL',
        type: 'line',
        yAxisIndex: 1,
        data: toChartLineFromSeries(payload.candles, openSourceBundle.relativeVolume20),
      },
    ];
  }, [openSourceBundle, payload]);

  const stochOptions = useMemo<ApexOptions>(() => {
    return {
      chart: {
        type: 'line',
        animations: { enabled: false },
        toolbar: { show: false },
        background: 'transparent',
      },
      stroke: {
        width: [2, 2, 1.5],
        curve: 'smooth',
      },
      colors: ['#38bdf8', '#f97316', '#a78bfa'],
      dataLabels: { enabled: false },
      xaxis: {
        type: 'datetime',
        labels: {
          datetimeUTC: false,
          style: { colors: '#71717a' },
        },
      },
      yaxis: [
        {
          min: 0,
          max: 100,
          labels: {
            style: { colors: '#71717a' },
          },
        },
        {
          opposite: true,
          min: 0,
          max: 3,
          labels: {
            style: { colors: '#71717a' },
            formatter: (value) => safeFixed(value, 2),
          },
        },
      ],
      annotations: {
        yaxis: [
          {
            y: 80,
            borderColor: '#52525b',
            strokeDashArray: 3,
          },
          {
            y: 20,
            borderColor: '#52525b',
            strokeDashArray: 3,
          },
        ],
      },
      legend: {
        position: 'top',
        horizontalAlign: 'left',
        labels: { colors: '#a1a1aa' },
      },
      grid: {
        borderColor: '#27272a',
        strokeDashArray: 2,
      },
      tooltip: { theme: 'dark' },
    };
  }, []);

  const rsiSeries = useMemo<ApexAxisChartSeries>(() => {
    if (!payload || !openSourceBundle) return [];

    return [
      {
        name: 'RSI 14',
        type: 'line',
        data: toChartLineFromSeries(payload.candles, openSourceBundle.rsi14),
      },
    ];
  }, [openSourceBundle, payload]);

  const rsiOptions = useMemo<ApexOptions>(() => {
    return {
      chart: {
        type: 'line',
        animations: { enabled: false },
        toolbar: { show: false },
        background: 'transparent',
      },
      stroke: {
        width: 2,
        curve: 'smooth',
      },
      colors: ['#fb7185'],
      dataLabels: { enabled: false },
      xaxis: {
        type: 'datetime',
        labels: {
          datetimeUTC: false,
          style: { colors: '#71717a' },
        },
      },
      yaxis: {
        min: 0,
        max: 100,
        labels: {
          style: { colors: '#71717a' },
        },
      },
      annotations: {
        yaxis: [
          {
            y: rsiOverboughtThreshold,
            borderColor: '#52525b',
            strokeDashArray: 3,
          },
          {
            y: rsiOversoldThreshold,
            borderColor: '#52525b',
            strokeDashArray: 3,
          },
          {
            y: 50,
            borderColor: '#3f3f46',
            strokeDashArray: 2,
          },
        ],
      },
      legend: {
        position: 'top',
        horizontalAlign: 'left',
        labels: { colors: '#a1a1aa' },
      },
      grid: {
        borderColor: '#27272a',
        strokeDashArray: 2,
      },
      tooltip: { theme: 'dark' },
    };
  }, [rsiOverboughtThreshold, rsiOversoldThreshold]);

  const macdSeries = useMemo<ApexAxisChartSeries>(() => {
    if (!payload) return [];

    return [
      {
        name: `MACD (${parsedMacdFastPeriod},${parsedMacdSlowPeriod})`,
        type: 'line',
        data: toChartLineFromSeries(payload.candles, customMacdSeries.line),
      },
      {
        name: `Signal (${parsedMacdSignalPeriod})`,
        type: 'line',
        data: toChartLineFromSeries(payload.candles, customMacdSeries.signal),
      },
      {
        name: 'Histogram',
        type: 'bar',
        data: toChartLineFromSeries(payload.candles, customMacdSeries.histogram),
      },
    ];
  }, [customMacdSeries.histogram, customMacdSeries.line, customMacdSeries.signal, parsedMacdFastPeriod, parsedMacdSignalPeriod, parsedMacdSlowPeriod, payload]);

  const macdOptions = useMemo<ApexOptions>(() => {
    return {
      chart: {
        type: 'line',
        animations: { enabled: false },
        toolbar: { show: false },
        background: 'transparent',
      },
      stroke: {
        width: [2, 2, 0],
        curve: 'smooth',
      },
      plotOptions: {
        bar: {
          columnWidth: '72%',
        },
      },
      colors: ['#14b8a6', '#f59e0b', '#64748b'],
      dataLabels: { enabled: false },
      xaxis: {
        type: 'datetime',
        labels: {
          datetimeUTC: false,
          style: { colors: '#71717a' },
        },
      },
      yaxis: {
        labels: {
          style: { colors: '#71717a' },
          formatter: (value) => safeFixed(value, 3),
        },
      },
      annotations: {
        yaxis: [
          {
            y: 0,
            borderColor: '#52525b',
            strokeDashArray: 2,
          },
        ],
      },
      legend: {
        position: 'top',
        horizontalAlign: 'left',
        labels: { colors: '#a1a1aa' },
      },
      grid: {
        borderColor: '#27272a',
        strokeDashArray: 2,
      },
      tooltip: { theme: 'dark' },
    };
  }, []);

  const lastCandle = payload?.candles[payload.candles.length - 1] ?? null;
  const selectedMeta = useMemo(
    () => watchlist.find((row) => row.symbol === selectedSymbol) ?? null,
    [selectedSymbol, watchlist],
  );
  const backfillProgressPct = useMemo(() => {
    if (!backfillState || backfillState.progress.totalSymbols <= 0) {
      return 0;
    }

    const ratio = backfillState.progress.processedSymbols / backfillState.progress.totalSymbols;
    return Math.max(0, Math.min(100, Math.round(ratio * 100)));
  }, [backfillState]);

  const latestBackfillReport = backfillState?.recentReports[0] ?? null;

  const actionability = useMemo(() => {
    const minQualityValue = Number(minQuality);
    const minRiskRewardValue = Number(minRiskReward);
    const minSampleValue = Number(minSampleSize);

    if (!signal || !signal.plan || signal.signal === 'HOLD') {
      return {
        label: 'BLOCKED' as const,
        score: 0,
        reasons: ['No directional setup passed the base engine gate.'],
      };
    }

    const reasons: string[] = [];
    let score = 100;

    if (Number.isFinite(minQualityValue) && signal.qualityScore < minQualityValue) {
      reasons.push(`Quality ${signal.qualityScore.toFixed(1)}% is below your ${minQualityValue.toFixed(1)}% rule.`);
      score -= 32;
    }

    if (Number.isFinite(minRiskRewardValue) && signal.plan.riskReward < minRiskRewardValue) {
      reasons.push(`R:R ${signal.plan.riskReward.toFixed(2)} is below your ${minRiskRewardValue.toFixed(2)} rule.`);
      score -= 26;
    }

    const missingRequired = signal.requiredChecks.filter((item) => item.required && !item.passed);
    if (missingRequired.length) {
      reasons.push(`${missingRequired.length} required checks are still failing.`);
      score -= Math.min(28, missingRequired.length * 8);
    }

    if (
      Number.isFinite(minSampleValue) &&
      signal.performance.sampleSize < minSampleValue &&
      signal.performance.sampleSize > 0
    ) {
      reasons.push(
        `Prediction sample size ${signal.performance.sampleSize} is below your minimum ${Math.floor(minSampleValue)}.`,
      );
      score -= 12;
    }

    if (signal.signal === 'BUY' && signal.structure.nearestResistance !== null) {
      const resistanceDistancePct =
        ((signal.structure.nearestResistance - signal.plan.entryPrice) / signal.plan.entryPrice) * 100;
      if (resistanceDistancePct < 1.2) {
        reasons.push('Nearest resistance is too close to entry for a clean upside push.');
        score -= 14;
      }
    }

    if (signal.signal === 'SELL' && signal.structure.nearestSupport !== null) {
      const supportDistancePct =
        ((signal.plan.entryPrice - signal.structure.nearestSupport) / signal.plan.entryPrice) * 100;
      if (supportDistancePct < 1.0) {
        reasons.push('Nearest support is close; downside for exit may be limited unless pressure expands.');
        score -= 10;
      }
    }

    const normalizedScore = Math.max(0, Math.round(score));

    if (normalizedScore >= 78 && reasons.length === 0) {
      return {
        label: 'EXECUTABLE' as const,
        score: normalizedScore,
        reasons: ['All your personal rules are satisfied. Setup is actionable with discipline.'],
      };
    }

    if (normalizedScore >= 58) {
      return {
        label: 'WATCH' as const,
        score: normalizedScore,
        reasons: reasons.length ? reasons : ['Setup is close but not fully aligned with your profile.'],
      };
    }

    return {
      label: 'BLOCKED' as const,
      score: normalizedScore,
      reasons: reasons.length ? reasons : ['Setup does not pass your personal execution framework.'],
    };
  }, [minQuality, minRiskReward, minSampleSize, signal]);

  const mtfTrendVotes = useMemo(() => {
    return mtfContext
      .map((context) => {
        const closes = context.candles.map((item) => item.c);
        const ema20 = calculateEma(closes, 20);
        const latestClose = closes[closes.length - 1];
        const latestEma = latestFinite(ema20);

        if (!Number.isFinite(latestClose) || latestEma === null) {
          return null;
        }

        return {
          interval: context.interval,
          direction: latestClose >= latestEma ? ('bullish' as const) : ('bearish' as const),
        };
      })
      .filter((item): item is { interval: Interval; direction: IndicatorDirection } => item !== null);
  }, [mtfContext]);

  const strategyReadings = useMemo<Record<StrategyPackId, StrategyPackReading>>(() => {
    const base: Record<StrategyPackId, StrategyPackReading> = {
      'sweep-cisd-fvg-keylevels': {
        status: 'WAIT',
        score: 42,
        summary: 'Waiting for a valid liquidity event.',
        checks: ['Need recent sweep or CISD break before acting.'],
      },
      'quantum-risk': {
        status: 'WAIT',
        score: 40,
        summary: 'Risk guard active. Setup not cleared yet.',
        checks: ['Need stronger quality and risk/reward profile.'],
      },
      'supertrend-mtf': {
        status: 'WAIT',
        score: 38,
        summary: 'MTF alignment not yet decisive.',
        checks: ['Need local and higher-timeframe trend agreement.'],
      },
      'trend-volume': {
        status: 'WAIT',
        score: 41,
        summary: 'Volume confirmation is still weak.',
        checks: ['Need ADX and RVOL confirmation before trend entries.'],
      },
    };

    if (!openSourceBundle || !payload?.candles.length) {
      return base;
    }

    const latest = payload.candles[payload.candles.length - 1];
    const latestAdx = openSourceBundle.latest.adx14 ?? 0;
    const latestRvol = openSourceBundle.latest.relativeVolume20 ?? 0;
    const latestRsi = openSourceBundle.latest.rsi14 ?? 50;
    const latestStochK = openSourceBundle.latest.stochK ?? 50;
    const latestStochD = openSourceBundle.latest.stochD ?? 50;
    const latestMacd = openSourceBundle.latest.macd ?? 0;
    const latestMacdSignal = openSourceBundle.latest.macdSignal ?? 0;
    const latestMacdHistogram = openSourceBundle.latest.macdHistogram ?? 0;
    const ema8Value = signal?.priceContext.ema8 ?? null;
    const ema21Value = signal?.priceContext.ema21 ?? null;

    const bullishFvgCount = openSourceBundle.fvgZones.filter((item) => item.direction === 'bullish').length;
    const bearishFvgCount = openSourceBundle.fvgZones.filter((item) => item.direction === 'bearish').length;
    const bullishMtfFvgCount = openSourceBundle.mtfFvgZones.filter((item) => item.direction === 'bullish').length;
    const bearishMtfFvgCount = openSourceBundle.mtfFvgZones.filter((item) => item.direction === 'bearish').length;

    const latestSweep = openSourceBundle.sweepEvents[openSourceBundle.sweepEvents.length - 1] ?? null;
    const latestLateWeekSweep = openSourceBundle.latest.latestLateWeekSweep;
    const latestCisd = openSourceBundle.cisdEvents[openSourceBundle.cisdEvents.length - 1] ?? null;
    const nearestKeyLevelDistance = openSourceBundle.keyLevels.length
      ? Math.min(...openSourceBundle.keyLevels.map((level) => Math.abs((latest.c - level.price) / latest.c) * 100))
      : null;

    const modelDirection: IndicatorDirection | null =
      signal?.signal === 'BUY' ? 'bullish' : signal?.signal === 'SELL' ? 'bearish' : null;

    const liquidityLong =
      (latestSweep?.direction === 'bullish' ? 20 : 0) +
      (latestLateWeekSweep?.direction === 'bullish' ? 12 : 0) +
      (latestCisd?.direction === 'bullish' ? 18 : 0) +
      (bullishFvgCount > bearishFvgCount ? 14 : 0) +
      (bullishMtfFvgCount > bearishMtfFvgCount ? 10 : 0) +
      (modelDirection === 'bullish' ? 8 : 0) +
      (nearestKeyLevelDistance !== null && nearestKeyLevelDistance <= 0.8 ? 6 : 0);

    const liquidityShort =
      (latestSweep?.direction === 'bearish' ? 20 : 0) +
      (latestLateWeekSweep?.direction === 'bearish' ? 12 : 0) +
      (latestCisd?.direction === 'bearish' ? 18 : 0) +
      (bearishFvgCount > bullishFvgCount ? 14 : 0) +
      (bearishMtfFvgCount > bullishMtfFvgCount ? 10 : 0) +
      (modelDirection === 'bearish' ? 8 : 0) +
      (nearestKeyLevelDistance !== null && nearestKeyLevelDistance <= 0.8 ? 6 : 0);

    const liquidityStatus: StrategyPackStatus =
      Math.abs(liquidityLong - liquidityShort) < 8 ? 'WAIT' : liquidityLong > liquidityShort ? 'LONG' : 'SHORT';

    base['sweep-cisd-fvg-keylevels'] = {
      status: liquidityStatus,
      score: clamp(44 + Math.max(liquidityLong, liquidityShort), 0, 100),
      summary:
        liquidityStatus === 'WAIT'
          ? 'NEPSE liquidity map is mixed. Wait for cleaner sweep + delivery confirmation.'
          : liquidityStatus === 'LONG'
            ? 'Bullish sweep/CISD pressure is leading while NEPSE key levels remain supportive.'
            : 'Bearish sweep/CISD pressure is leading; use this as de-risk context in cash market.',
      checks: [
        `Current sweep: ${latestSweep ? latestSweep.direction.toUpperCase() : 'none'}`,
        `Late-week sweep (Wed/Thu NPT): ${latestLateWeekSweep ? latestLateWeekSweep.direction.toUpperCase() : 'none'}`,
        `Current CISD: ${latestCisd ? latestCisd.direction.toUpperCase() : 'none'}`,
        `Open FVG balance (local/MTF): ${bullishFvgCount + bullishMtfFvgCount} bull vs ${bearishFvgCount + bearishMtfFvgCount} bear`,
      ],
    };

    const riskReward = signal?.plan?.riskReward ?? 0;
    const quality = signal?.qualityScore ?? 0;
    const sample = signal?.performance.sampleSize ?? 0;

    const riskScore =
      35 +
      (riskReward >= 2.2 ? 26 : riskReward >= 1.8 ? 17 : riskReward >= 1.5 ? 10 : 0) +
      (quality >= 85 ? 24 : quality >= 75 ? 14 : quality >= 65 ? 8 : 0) +
      (sample >= 20 ? 10 : sample >= 10 ? 5 : 0) +
      (actionability.label === 'EXECUTABLE' ? 10 : actionability.label === 'WATCH' ? 5 : 0) +
      (latestRsi >= 45 && latestRsi <= 70 ? 5 : 0) +
      (latestMacd >= latestMacdSignal ? 4 : 0);

    const riskStatus: StrategyPackStatus =
      signal?.signal === 'BUY'
        ? riskScore >= 72
          ? 'LONG'
          : 'WAIT'
        : signal?.signal === 'SELL'
          ? riskScore >= 72
            ? 'SHORT'
            : 'WAIT'
          : 'WAIT';

    base['quantum-risk'] = {
      status: riskStatus,
      score: clamp(riskScore, 0, 100),
      summary:
        riskStatus === 'WAIT'
          ? 'Position sizing guard says wait until quality and R:R improve.'
          : 'Risk profile clears: setup can be managed with tiered targets and trailing stop.',
      checks: [
        `R:R ${riskReward.toFixed(2)} (target >= 1.80)`,
        `Quality ${quality.toFixed(1)} and sample ${sample}`,
        `RSI14 ${safeFixed(latestRsi, 1)} with MACD ${safeFixed(latestMacd, 3)} / Signal ${safeFixed(latestMacdSignal, 3)}`,
        `Actionability ${actionability.label} (${actionability.score}/100)`,
      ],
    };

    const bullishVotes = mtfTrendVotes.filter((item) => item.direction === 'bullish').length;
    const bearishVotes = mtfTrendVotes.filter((item) => item.direction === 'bearish').length;
    const localTrend = openSourceBundle.latest.supertrendTrend;

    const mtfLongScore =
      (localTrend === 'bullish' ? 28 : 0) +
      bullishVotes * 18 +
      (latestAdx >= 20 ? 12 : 0) +
      (modelDirection === 'bullish' ? 10 : 0);

    const mtfShortScore =
      (localTrend === 'bearish' ? 28 : 0) +
      bearishVotes * 18 +
      (latestAdx >= 20 ? 12 : 0) +
      (modelDirection === 'bearish' ? 10 : 0);

    const mtfStatus: StrategyPackStatus =
      Math.abs(mtfLongScore - mtfShortScore) < 10 ? 'WAIT' : mtfLongScore > mtfShortScore ? 'LONG' : 'SHORT';

    base['supertrend-mtf'] = {
      status: mtfStatus,
      score: clamp(30 + Math.max(mtfLongScore, mtfShortScore), 0, 100),
      summary:
        mtfStatus === 'WAIT'
          ? 'Trend map is split across timeframes. Better to wait for alignment.'
          : mtfStatus === 'LONG'
            ? 'Local supertrend and higher-timeframe trend stack support upside continuation.'
            : 'Local supertrend and higher-timeframe trend stack support downside continuation.',
      checks: [
        `Local supertrend: ${localTrend ? localTrend.toUpperCase() : 'unknown'}`,
        `MTF votes: ${bullishVotes} bull vs ${bearishVotes} bear`,
        `ADX ${safeFixed(latestAdx, 1)} (trend gate >= 20)`,
      ],
    };

    const momentumLongScore =
      (latestAdx >= 20 ? 22 : 0) +
      (latestRvol >= 1.2 ? 20 : latestRvol >= 1 ? 10 : 0) +
      (latestStochK > latestStochD ? 14 : 0) +
      (latestRsi >= 50 ? 10 : 0) +
      (latestMacd >= latestMacdSignal ? 10 : 0) +
      (signal?.signal === 'BUY' ? 18 : 0) +
      (ema8Value !== null && ema21Value !== null && ema8Value > ema21Value ? 10 : 0);

    const momentumShortScore =
      (latestAdx >= 20 ? 22 : 0) +
      (latestRvol >= 1.2 ? 20 : latestRvol >= 1 ? 10 : 0) +
      (latestStochK < latestStochD ? 14 : 0) +
      (latestRsi <= 50 ? 10 : 0) +
      (latestMacd < latestMacdSignal ? 10 : 0) +
      (signal?.signal === 'SELL' ? 18 : 0) +
      (ema8Value !== null && ema21Value !== null && ema8Value < ema21Value ? 10 : 0);

    const momentumStatus: StrategyPackStatus =
      Math.abs(momentumLongScore - momentumShortScore) < 8
        ? 'WAIT'
        : momentumLongScore > momentumShortScore
          ? 'LONG'
          : 'SHORT';

    base['trend-volume'] = {
      status: momentumStatus,
      score: clamp(28 + Math.max(momentumLongScore, momentumShortScore), 0, 100),
      summary:
        momentumStatus === 'WAIT'
          ? 'Momentum participation is incomplete. Let RVOL and ADX confirm first.'
          : momentumStatus === 'LONG'
            ? 'Trend and volume are aligned for bullish continuation.'
            : 'Trend and volume are aligned for bearish continuation.',
      checks: [
        `ADX ${safeFixed(latestAdx, 1)} / RVOL ${safeFixed(latestRvol, 2)}`,
        `RSI14 ${safeFixed(latestRsi, 1)} / MACD Hist ${safeFixed(latestMacdHistogram, 3)}`,
        `Stoch RSI K/D ${safeFixed(latestStochK, 1)} / ${safeFixed(latestStochD, 1)}`,
        `EMA8 vs EMA21: ${ema8Value !== null && ema21Value !== null ? (ema8Value > ema21Value ? 'bullish' : 'bearish') : 'unknown'}`,
      ],
    };

    return base;
  }, [actionability.label, actionability.score, mtfContext, mtfTrendVotes, openSourceBundle, payload?.candles.length, signal]);

  const selectedPack = useMemo(
    () => STRATEGY_PACKS.find((item) => item.id === strategyPack) ?? STRATEGY_PACKS[0],
    [strategyPack],
  );

  const confluence = useMemo(() => {
    const packReading = strategyReadings[strategyPack];
    const quality = signal?.qualityScore ?? 50;
    const modelScore = signal ? clamp(quality, 0, 100) : 40;
    const packScore = packReading?.score ?? 40;
    const actionabilityScore = actionability.score;
    const adxScore = openSourceBundle?.latest.adx14 ? clamp((openSourceBundle.latest.adx14 / 40) * 100, 0, 100) : 40;
    const rvolScore = openSourceBundle?.latest.relativeVolume20
      ? clamp(openSourceBundle.latest.relativeVolume20 * 55, 0, 100)
      : 45;
    const rsiScore =
      openSourceBundle?.latest.rsi14 !== null && openSourceBundle?.latest.rsi14 !== undefined
        ? clamp(100 - Math.abs(openSourceBundle.latest.rsi14 - 55) * 2.3, 0, 100)
        : 50;
    const macdScore =
      openSourceBundle?.latest.macd !== null &&
      openSourceBundle?.latest.macd !== undefined &&
      openSourceBundle?.latest.macdSignal !== null &&
      openSourceBundle?.latest.macdSignal !== undefined
        ? openSourceBundle.latest.macd >= openSourceBundle.latest.macdSignal
          ? 62
          : 42
        : 50;

    const composite = Math.round(
      modelScore * 0.33 +
        packScore * 0.29 +
        actionabilityScore * 0.16 +
        adxScore * 0.08 +
        rvolScore * 0.07 +
        rsiScore * 0.04 +
        macdScore * 0.03,
    );

    const directionalVotes: number[] = [];
    if (signal?.signal === 'BUY') directionalVotes.push(1);
    if (signal?.signal === 'SELL') directionalVotes.push(-1);
    if (packReading.status === 'LONG') directionalVotes.push(1);
    if (packReading.status === 'SHORT') directionalVotes.push(-1);

    directionalVotes.push(
      openSourceBundle?.latest.supertrendTrend === 'bullish'
        ? 1
        : openSourceBundle?.latest.supertrendTrend === 'bearish'
          ? -1
          : 0,
    );

    directionalVotes.push(
      openSourceBundle?.latest.macd !== null &&
        openSourceBundle?.latest.macd !== undefined &&
        openSourceBundle?.latest.macdSignal !== null &&
        openSourceBundle?.latest.macdSignal !== undefined
        ? openSourceBundle.latest.macd >= openSourceBundle.latest.macdSignal
          ? 1
          : -1
        : 0,
    );

    directionalVotes.push(...mtfTrendVotes.map((item) => (item.direction === 'bullish' ? 1 : -1)));

    const directionalAverage = average(directionalVotes);
    const bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' =
      directionalAverage > 0.2 ? 'BULLISH' : directionalAverage < -0.2 ? 'BEARISH' : 'NEUTRAL';

    const stance =
      composite >= 82
        ? 'High conviction setup environment'
        : composite >= 68
          ? 'Selective setup environment'
          : composite >= 52
            ? 'Mixed environment, lower size'
            : 'Defensive environment, wait mode';

    return {
      score: clamp(composite, 0, 100),
      bias,
      stance,
      driver: packReading.summary,
      checks: packReading.checks,
    };
  }, [actionability.score, mtfTrendVotes, openSourceBundle?.latest.adx14, openSourceBundle?.latest.macd, openSourceBundle?.latest.macdSignal, openSourceBundle?.latest.relativeVolume20, openSourceBundle?.latest.rsi14, openSourceBundle?.latest.supertrendTrend, signal, strategyPack, strategyReadings]);

  const tradeIdeas = useMemo<TradeIdeaCard[]>(() => {
    if (!payload?.candles.length || !openSourceBundle) {
      return [];
    }

    const close = payload.candles[payload.candles.length - 1].c;
    const atr = openSourceBundle.latest.atr14 ?? close * 0.012;
    const nearestSupport = signal?.structure.nearestSupport ?? close - atr * 1.1;
    const nearestResistance = signal?.structure.nearestResistance ?? close + atr * 1.1;
    const bullishTarget = signal?.plan?.takeProfit1 ?? close + atr * 1.8;
    const bearishTarget = signal?.plan?.takeProfit1 ?? close - atr * 1.8;
    const tightStopLong = signal?.plan?.stopLoss ?? close - atr * 1.1;
    const tightStopShort = signal?.plan?.stopLoss ?? close + atr * 1.1;

    const cards: TradeIdeaCard[] = [
      {
        title: 'Primary Setup',
        mode: confluence.bias === 'BULLISH' ? 'LONG' : confluence.bias === 'BEARISH' ? 'SHORT' : 'NEUTRAL',
        setup:
          confluence.bias === 'BULLISH'
            ? 'Buy only on pullback inside active bullish FVG or above key session low.'
            : confluence.bias === 'BEARISH'
              ? 'Cash-market de-risk setup: trim exposure on rejection near resistance/FVG.'
              : 'No clean directional edge. Wait for sweep + CISD confirmation.',
        entry:
          confluence.bias === 'BULLISH'
            ? `Entry zone: ${safeFixed(nearestSupport, 2)} to ${safeFixed(close, 2)}`
            : confluence.bias === 'BEARISH'
              ? `De-risk zone: ${safeFixed(close, 2)} to ${safeFixed(nearestResistance, 2)}`
              : `Entry zone: wait for break beyond ${safeFixed(nearestResistance, 2)} or below ${safeFixed(nearestSupport, 2)}`,
        invalidation:
          confluence.bias === 'BULLISH'
            ? `Invalidation below ${safeFixed(tightStopLong, 2)}`
            : confluence.bias === 'BEARISH'
              ? `Invalidation above ${safeFixed(tightStopShort, 2)}`
              : 'Invalidation: trade only after confluence score > 68 and actionable status is not BLOCKED.',
        target:
          confluence.bias === 'BULLISH'
            ? `First target ${safeFixed(bullishTarget, 2)}`
            : confluence.bias === 'BEARISH'
              ? `First target ${safeFixed(bearishTarget, 2)}`
              : `Reference targets ${safeFixed(nearestSupport, 2)} / ${safeFixed(nearestResistance, 2)}`,
      },
      {
        title: 'Risk Layering Plan',
        mode: 'NEUTRAL',
        setup: 'Use staged execution: 40% initial, 30% confirmation, 30% continuation.',
        entry: `Only if R:R >= ${safeFixed(Number(minRiskReward), 2)} and quality >= ${safeFixed(Number(minQuality), 1)}%.`,
        invalidation: `Cut size when ADX < 20, RVOL < 1.00, RSI14 < 45, or MACD drops below signal. Current ADX ${safeFixed(openSourceBundle.latest.adx14, 1)}, RVOL ${safeFixed(openSourceBundle.latest.relativeVolume20, 2)}, RSI ${safeFixed(openSourceBundle.latest.rsi14, 1)}.`,
        target: 'Take partial at TP1, trail with supertrend line and key session levels.',
      },
      {
        title: 'Execution Checklist Idea',
        mode: 'NEUTRAL',
        setup: selectedPack.objective,
        entry: `Active pack status: ${nepseStatusLabel(strategyReadings[strategyPack].status)} (${strategyReadings[strategyPack].score}/100).`,
        invalidation: strategyReadings[strategyPack].checks[0] ?? 'No additional invalidation check.',
        target: strategyReadings[strategyPack].checks[1] ?? 'Monitor structure and volume confirmation.',
      },
    ];

    return cards;
  }, [confluence.bias, minQuality, minRiskReward, openSourceBundle, payload?.candles, selectedPack.objective, signal, strategyPack, strategyReadings]);

  const emitAlert = useCallback(
    (item: AlertFeedItem) => {
      setAlertFeed((prev) => [item, ...prev.filter((entry) => entry.id !== item.id)].slice(0, 30));
      triggerBrowserNotification(`NEPSE Alert: ${item.type}`, item.message);
    },
    [setAlertFeed],
  );

  useEffect(() => {
    if (!alertsEnabled || !openSourceBundle || !payload?.candles.length) {
      return;
    }

    const latestCandle = payload.candles[payload.candles.length - 1];
    const previousCandle = payload.candles[payload.candles.length - 2] ?? null;
    const latestIndex = payload.candles.length - 1;
    const previousIndex = latestIndex - 1;

    if (alertOnSweep) {
      const latestSweep = openSourceBundle.sweepEvents[openSourceBundle.sweepEvents.length - 1] ?? null;
      if (latestSweep) {
        const sweepId = `${latestSweep.at}-${latestSweep.direction}-${safeFixed(latestSweep.level, 4)}`;
        if (!lastAlertRef.current.sweepId) {
          lastAlertRef.current.sweepId = sweepId;
        } else if (lastAlertRef.current.sweepId !== sweepId) {
          lastAlertRef.current.sweepId = sweepId;
          emitAlert({
            id: `SWEEP-${sweepId}`,
            type: 'SWEEP',
            at: latestSweep.at,
            message: `${latestSweep.direction.toUpperCase()} sweep near ${safeFixed(latestSweep.level, 2)} on ${selectedSymbol}.`,
          });
        }
      }
    }

    if (alertOnCisd) {
      const cisd = openSourceBundle.cisdEvents[openSourceBundle.cisdEvents.length - 1] ?? null;
      if (cisd) {
        const cisdId = `${cisd.at}-${cisd.direction}-${safeFixed(cisd.breakLevel, 4)}`;
        if (!lastAlertRef.current.cisdId) {
          lastAlertRef.current.cisdId = cisdId;
        } else if (lastAlertRef.current.cisdId !== cisdId) {
          lastAlertRef.current.cisdId = cisdId;
          emitAlert({
            id: `CISD-${cisdId}`,
            type: 'CISD',
            at: cisd.at,
            message: `${cisd.direction.toUpperCase()} CISD break at ${safeFixed(cisd.breakLevel, 2)} with ${safeFixed(cisd.rangePct, 2)}% structure range.`,
          });
        }
      }
    }

    if (alertOnFvgTouch && previousCandle) {
      const recentZones = [...openSourceBundle.fvgZones.slice(-5), ...openSourceBundle.mtfFvgZones.slice(-5)];
      const touchedZone = recentZones.find(
        (zone) =>
          latestCandle.c >= zone.low &&
          latestCandle.c <= zone.high &&
          (previousCandle.c < zone.low || previousCandle.c > zone.high),
      );

      if (touchedZone) {
        const fvgId = `${latestCandle.t}-${touchedZone.sourceInterval}-${touchedZone.direction}-${safeFixed(touchedZone.midpoint, 4)}`;
        if (!lastAlertRef.current.fvgTouchId) {
          lastAlertRef.current.fvgTouchId = fvgId;
        } else if (lastAlertRef.current.fvgTouchId !== fvgId) {
          lastAlertRef.current.fvgTouchId = fvgId;
          emitAlert({
            id: `FVG-${fvgId}`,
            type: 'FVG',
            at: latestCandle.t,
            message: `${selectedSymbol} touched ${touchedZone.sourceInterval} ${touchedZone.direction.toUpperCase()} FVG around ${safeFixed(touchedZone.midpoint, 2)}.`,
          });
        }
      }
    }

    if (alertOnKeyLevels && previousCandle) {
      const brokenLevel = openSourceBundle.keyLevels.find(
        (level) =>
          (previousCandle.c < level.price && latestCandle.c > level.price) ||
          (previousCandle.c > level.price && latestCandle.c < level.price),
      );

      if (brokenLevel) {
        const direction = latestCandle.c > brokenLevel.price ? 'above' : 'below';
        const keyBreakId = `${latestCandle.t}-${brokenLevel.id}-${direction}`;
        if (!lastAlertRef.current.keyBreakId) {
          lastAlertRef.current.keyBreakId = keyBreakId;
        } else if (lastAlertRef.current.keyBreakId !== keyBreakId) {
          lastAlertRef.current.keyBreakId = keyBreakId;
          emitAlert({
            id: `KEY-${keyBreakId}`,
            type: 'KEY_LEVEL',
            at: latestCandle.t,
            message: `${selectedSymbol} crossed ${direction} ${brokenLevel.label} (${safeFixed(brokenLevel.price, 2)}).`,
          });
        }
      }
    }

    if (alertOnConfluence) {
      const bucket = confluence.score >= 82 ? 'HIGH' : confluence.score >= 68 ? 'MID' : 'LOW';
      if (!lastAlertRef.current.confluenceBucket) {
        lastAlertRef.current.confluenceBucket = bucket;
      } else if (lastAlertRef.current.confluenceBucket !== bucket) {
        lastAlertRef.current.confluenceBucket = bucket;
        if (bucket !== 'LOW') {
          emitAlert({
            id: `CONF-${latestCandle.t}-${bucket}`,
            type: 'CONFLUENCE',
            at: latestCandle.t,
            message: `Confluence moved to ${bucket} (${confluence.score}/100) with ${confluence.bias} bias for ${selectedSymbol}.`,
          });
        }
      }
    }

    if (alertOnMacdCross && previousIndex >= 0) {
      const prevMacd = customMacdSeries.line[previousIndex];
      const prevSignal = customMacdSeries.signal[previousIndex];
      const currentMacd = customMacdSeries.line[latestIndex];
      const currentSignal = customMacdSeries.signal[latestIndex];

      if (prevMacd !== null && prevSignal !== null && currentMacd !== null && currentSignal !== null) {
        const prevDelta = prevMacd - prevSignal;
        const currentDelta = currentMacd - currentSignal;
        const crossDirection =
          prevDelta <= 0 && currentDelta > 0
            ? 'bullish'
            : prevDelta >= 0 && currentDelta < 0
              ? 'bearish'
              : null;

        if (crossDirection) {
          const macdCrossId = `${latestCandle.t}-${crossDirection}-${parsedMacdFastPeriod}-${parsedMacdSlowPeriod}-${parsedMacdSignalPeriod}`;
          if (!lastAlertRef.current.macdCrossId) {
            lastAlertRef.current.macdCrossId = macdCrossId;
          } else if (lastAlertRef.current.macdCrossId !== macdCrossId) {
            lastAlertRef.current.macdCrossId = macdCrossId;
            emitAlert({
              id: `MACD-${macdCrossId}`,
              type: 'MACD',
              at: latestCandle.t,
              message: `${selectedSymbol} MACD ${crossDirection.toUpperCase()} crossover (${safeFixed(currentMacd, 3)} vs ${safeFixed(currentSignal, 3)}) with ${parsedMacdFastPeriod}/${parsedMacdSlowPeriod}/${parsedMacdSignalPeriod}.`,
            });
          }
        }
      }
    }

    if (alertOnRsiZones && previousIndex >= 0) {
      const prevRsi = openSourceBundle.rsi14[previousIndex];
      const currentRsi = openSourceBundle.rsi14[latestIndex];

      if (prevRsi !== null && currentRsi !== null) {
        const zone =
          prevRsi < rsiOverboughtThreshold && currentRsi >= rsiOverboughtThreshold
            ? 'OVERBOUGHT'
            : prevRsi > rsiOversoldThreshold && currentRsi <= rsiOversoldThreshold
              ? 'OVERSOLD'
              : null;

        if (zone) {
          const rsiZoneId = `${latestCandle.t}-${zone}-${safeFixed(rsiOversoldThreshold, 1)}-${safeFixed(rsiOverboughtThreshold, 1)}`;
          if (!lastAlertRef.current.rsiZoneId) {
            lastAlertRef.current.rsiZoneId = rsiZoneId;
          } else if (lastAlertRef.current.rsiZoneId !== rsiZoneId) {
            lastAlertRef.current.rsiZoneId = rsiZoneId;
            emitAlert({
              id: `RSI-${rsiZoneId}`,
              type: 'RSI',
              at: latestCandle.t,
              message: `${selectedSymbol} RSI entered ${zone} zone at ${safeFixed(currentRsi, 1)} (bands ${safeFixed(rsiOversoldThreshold, 1)}/${safeFixed(rsiOverboughtThreshold, 1)}).`,
            });
          }
        }
      }
    }
  }, [
    alertOnCisd,
    alertOnConfluence,
    alertOnFvgTouch,
    alertOnKeyLevels,
    alertOnMacdCross,
    alertOnRsiZones,
    alertOnSweep,
    alertsEnabled,
    confluence.bias,
    confluence.score,
    customMacdSeries.line,
    customMacdSeries.signal,
    emitAlert,
    openSourceBundle,
    parsedMacdFastPeriod,
    parsedMacdSignalPeriod,
    parsedMacdSlowPeriod,
    payload?.candles,
    rsiOverboughtThreshold,
    rsiOversoldThreshold,
    selectedSymbol,
  ]);

  const changeSymbol = (symbol: string) => {
    setSelectedSymbol(symbol);
    navigate(`/chart-desk/${symbol}`);
  };

  return (
    <section className="space-y-5">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Technical Workspace</p>
        <h1 className="text-2xl font-semibold text-white">Chart Desk</h1>
      </header>

      <section className="terminal-card space-y-4 p-5">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Professional Signal Engine</p>
        {signal ? (
          <>
            {signal.signal === 'SELL' ? (
              <p className="text-xs text-terminal-amber">SELL means reduce/exit existing holdings in NEPSE cash market. No short-selling assumption is used.</p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-lg border px-4 py-2 text-xl font-bold uppercase tracking-wide ${signalBadgeClass(signal.signal)}`}>
                {signal.signal}
              </span>
              <span className={`rounded-lg border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${confidenceBadgeClass(signal.confidence)}`}>
                {signal.confidence}
              </span>
              <span className="rounded-lg border border-zinc-700 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-zinc-200">
                {signal.structure.trendBias}
              </span>
              <span className="rounded-lg border border-zinc-700 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-zinc-300">
                {signal.interval}
              </span>
            </div>

            <p className="text-sm text-zinc-200">Recommended action: {signal.recommendedAction}</p>

            <div className="grid gap-3 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 lg:grid-cols-[1.15fr_0.85fr]">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">Personal Rule Profile (Self-Help)</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  <label className="text-[11px] text-zinc-400">
                    Min Quality %
                    <input
                      type="number"
                      value={minQuality}
                      onChange={(event) => setMinQuality(event.target.value)}
                      className="terminal-input mt-1 font-mono"
                    />
                  </label>
                  <label className="text-[11px] text-zinc-400">
                    Min R:R
                    <input
                      type="number"
                      value={minRiskReward}
                      onChange={(event) => setMinRiskReward(event.target.value)}
                      className="terminal-input mt-1 font-mono"
                    />
                  </label>
                  <label className="text-[11px] text-zinc-400">
                    Min Sample Size
                    <input
                      type="number"
                      value={minSampleSize}
                      onChange={(event) => setMinSampleSize(event.target.value)}
                      className="terminal-input mt-1 font-mono"
                    />
                  </label>
                </div>
              </div>

              <div className="rounded-lg border border-zinc-800 bg-black/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] uppercase tracking-wide text-zinc-500">Actionability</p>
                  <span className={`rounded-md border px-2 py-1 text-[10px] font-semibold tracking-wide ${actionabilityClass(actionability.label)}`}>
                    {actionability.label}
                  </span>
                </div>
                <p className="mt-2 font-mono text-2xl text-white">{actionability.score}/100</p>
                <ul className="mt-2 space-y-1 text-xs text-zinc-400">
                  {actionability.reasons.slice(0, 2).map((reason, index) => (
                    <li key={`rule-reason-${index}`}>• {reason}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">Quality</p>
                <p className="mt-1 font-mono text-lg text-cyan-200">{signal.qualityScore.toFixed(1)}%</p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">Buy Pressure</p>
                <p className="mt-1 font-mono text-lg text-terminal-green">{signal.buyScore}</p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">Sell Pressure</p>
                <p className="mt-1 font-mono text-lg text-terminal-red">{signal.sellScore}</p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">Model Sample</p>
                <p className="mt-1 font-mono text-lg text-zinc-100">{signal.performance.sampleSize}</p>
              </div>
            </div>

            {signal.plan ? (
              <>
                <div className="grid gap-2 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 md:grid-cols-2 xl:grid-cols-7">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-zinc-500">Entry / Exit Ref</p>
                    <p className="font-mono text-sm text-zinc-100">₹ {formatMoney(signal.plan.entryPrice)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-zinc-500">Stop / Risk Line</p>
                    <p className="font-mono text-sm text-terminal-red">₹ {formatMoney(signal.plan.stopLoss)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-zinc-500">TP1</p>
                    <p className="font-mono text-sm text-terminal-green">₹ {formatMoney(signal.plan.takeProfit1)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-zinc-500">TP2</p>
                    <p className="font-mono text-sm text-terminal-green">₹ {formatMoney(signal.plan.takeProfit2)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-zinc-500">Trailing Stop</p>
                    <p className="font-mono text-sm text-zinc-100">₹ {formatMoney(signal.plan.trailingStop)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-zinc-500">Risk:Reward</p>
                    <p className="font-mono text-sm text-zinc-100">{signal.plan.riskReward.toFixed(2)}R</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-zinc-500">Expected Move</p>
                    <p className="font-mono text-sm text-zinc-100">{formatPercent(signal.plan.expectedMovePct)}</p>
                  </div>
                </div>

                <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-zinc-500">Exit Logic</p>
                  <p className="mt-1 text-xs text-zinc-200">{signal.plan.primaryExitRule}</p>
                  <p className="mt-1 text-xs text-zinc-400">{signal.plan.exitRationale}</p>
                  <p className="mt-2 text-[11px] text-zinc-300">Invalidation: {signal.plan.invalidation}</p>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const activePlan = signal.plan;
                        if (!activePlan) return;

                        navigate(
                          `/execution?symbol=${encodeURIComponent(selectedSymbol)}&side=${signal.signal === 'BUY' ? 'buy' : 'sell'}&entry=${encodeURIComponent(String(activePlan.entryPrice))}&stop=${encodeURIComponent(String(activePlan.stopLoss))}&target=${encodeURIComponent(String(activePlan.takeProfit1))}`,
                        );
                      }}
                      className="terminal-btn"
                    >
                      Plan in Execution
                    </button>
                    <button type="button" onClick={() => void loadData()} className="terminal-btn">
                      Re-check Setup
                    </button>
                  </div>
                </div>
              </>
            ) : null}

            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">Required Checks Before Execution</p>
                <ul className="mt-2 space-y-1 text-xs text-zinc-300">
                  {signal.requiredChecks
                    .filter((item) => item.required)
                    .map((item) => (
                      <li key={item.key}>
                        {item.passed ? 'PASS' : 'WAIT'} - {item.label} (w {item.weight})
                      </li>
                    ))}
                </ul>
                {signal.failedChecks.length ? (
                  <p className="mt-2 text-xs text-terminal-amber">Open risks: {signal.failedChecks.join(' | ')}</p>
                ) : null}
              </div>

              <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">Support / Resistance Map</p>
                <p className="mt-1 text-xs text-zinc-400">
                  Nearest support: {signal.structure.nearestSupport ? `₹ ${formatMoney(signal.structure.nearestSupport)}` : '-'}
                  {' | '}
                  Nearest resistance: {signal.structure.nearestResistance ? `₹ ${formatMoney(signal.structure.nearestResistance)}` : '-'}
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-terminal-green">Supports</p>
                    <ul className="mt-1 space-y-1 text-xs text-zinc-300">
                      {signal.structure.supportLevels.length ? (
                        signal.structure.supportLevels.map((level, index) => (
                          <li key={`support-${index}`}>
                            S{index + 1}: ₹ {formatMoney(level.price)} ({level.touches}x, {formatPercent(level.distancePct)})
                          </li>
                        ))
                      ) : (
                        <li>-</li>
                      )}
                    </ul>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-terminal-red">Resistances</p>
                    <ul className="mt-1 space-y-1 text-xs text-zinc-300">
                      {signal.structure.resistanceLevels.length ? (
                        signal.structure.resistanceLevels.map((level, index) => (
                          <li key={`resistance-${index}`}>
                            R{index + 1}: ₹ {formatMoney(level.price)} ({level.touches}x, {formatPercent(level.distancePct)})
                          </li>
                        ))
                      ) : (
                        <li>-</li>
                      )}
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
              <p className="text-[10px] uppercase tracking-wide text-zinc-500">Prediction Tracking and Self-Improvement</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-4">
                <p className="text-xs text-zinc-300">Sample: <span className="font-mono text-zinc-100">{signal.performance.sampleSize}</span></p>
                <p className="text-xs text-zinc-300">Win Rate: <span className="font-mono text-zinc-100">{formatPercent(signal.performance.winRatePct)}</span></p>
                <p className="text-xs text-zinc-300">Avg Accuracy: <span className="font-mono text-zinc-100">{formatPercent(signal.performance.averageAccuracyPct)}</span></p>
                <p className="text-xs text-zinc-300">Recent 10: <span className="font-mono text-zinc-100">{formatPercent(signal.performance.recentWinRatePct)}</span></p>
              </div>
              <p className="mt-2 text-xs text-zinc-500">{signal.performance.note}</p>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-black/50 p-3">
              <p className="text-[10px] uppercase tracking-wide text-zinc-500">Signal Basis</p>
              <ul className="mt-2 space-y-1 text-xs text-zinc-300">
                {signal.reasons.map((reason, index) => (
                  <li key={`reason-${index}`}>• {reason}</li>
                ))}
              </ul>
            </div>
          </>
        ) : (
          <p className="text-sm text-zinc-500">Signal unavailable for the selected symbol.</p>
        )}
        <p className="text-xs text-zinc-500">
          Signals are probabilistic and risk-managed. Use position sizing and stop discipline on every trade.
        </p>
      </section>

      <section className="terminal-card space-y-4 p-5">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-400">
          <span className="font-mono text-zinc-200">{selectedSymbol || '-'}</span>
          <span className="mx-2 text-zinc-600">|</span>
          <span>{selectedMeta?.company ?? 'Company profile syncing...'}</span>
          <span className="mx-2 text-zinc-600">|</span>
          <span>{selectedMeta?.sector ?? 'Sector pending'}</span>
        </div>

        <div className="grid gap-3 xl:grid-cols-[1.8fr_0.7fr_0.6fr]">
          <div className="space-y-1">
            <label htmlFor="symbol" className="text-xs uppercase tracking-wide text-zinc-400">
              Company
            </label>
            <select id="symbol" value={selectedSymbol} onChange={(event) => changeSymbol(event.target.value)} className="terminal-input">
              {watchlist.map((item) => (
                <option key={item.symbol} value={item.symbol}>
                  {item.symbol} - {item.company ?? 'NEPSE Company'}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="interval" className="text-xs uppercase tracking-wide text-zinc-400">
              Interval
            </label>
            <select
              id="interval"
              value={interval}
              onChange={(event) => setInterval(event.target.value as Interval)}
              className="terminal-input"
            >
              {INTERVALS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs uppercase tracking-wide text-zinc-400">View</label>
            <div className="terminal-input flex items-center justify-between text-zinc-300">
              Candles ({activeDataInterval})
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setShowSma20((prev) => !prev)} className={showSma20 ? 'terminal-btn-primary' : 'terminal-btn'}>
            SMA20 {showSma20 ? '●' : '○'}
          </button>
          <button type="button" onClick={() => setShowEma20((prev) => !prev)} className={showEma20 ? 'terminal-btn-primary' : 'terminal-btn'}>
            EMA20 {showEma20 ? '●' : '○'}
          </button>
          <button
            type="button"
            onClick={() => setShowBollinger((prev) => !prev)}
            className={showBollinger ? 'terminal-btn-primary' : 'terminal-btn'}
          >
            Bollinger {showBollinger ? '●' : '○'}
          </button>
          <button type="button" onClick={() => setShowVwap((prev) => !prev)} className={showVwap ? 'terminal-btn-primary' : 'terminal-btn'}>
            VWAP {showVwap ? '●' : '○'}
          </button>
          <button
            type="button"
            onClick={() => setShowStructure((prev) => !prev)}
            className={showStructure ? 'terminal-btn-primary' : 'terminal-btn'}
          >
            S/R Levels {showStructure ? '●' : '○'}
          </button>
          <button
            type="button"
            onClick={() => setShowSupertrend((prev) => !prev)}
            className={showSupertrend ? 'terminal-btn-primary' : 'terminal-btn'}
          >
            Supertrend {showSupertrend ? '●' : '○'}
          </button>
          <button
            type="button"
            onClick={() => setShowKeyLevels((prev) => !prev)}
            className={showKeyLevels ? 'terminal-btn-primary' : 'terminal-btn'}
          >
            Key Levels {showKeyLevels ? '●' : '○'}
          </button>
          <button type="button" onClick={() => setShowFvg((prev) => !prev)} className={showFvg ? 'terminal-btn-primary' : 'terminal-btn'}>
            FVG {showFvg ? '●' : '○'}
          </button>
          <button
            type="button"
            onClick={() => setShowMtfFvg((prev) => !prev)}
            className={showMtfFvg ? 'terminal-btn-primary' : 'terminal-btn'}
          >
            MTF FVG {showMtfFvg ? '●' : '○'}
          </button>
          <button type="button" onClick={() => setShowSweeps((prev) => !prev)} className={showSweeps ? 'terminal-btn-primary' : 'terminal-btn'}>
            Sweeps {showSweeps ? '●' : '○'}
          </button>
          <button
            type="button"
            onClick={() => setShowCisdProjection((prev) => !prev)}
            className={showCisdProjection ? 'terminal-btn-primary' : 'terminal-btn'}
          >
            CISD Projections {showCisdProjection ? '●' : '○'}
          </button>
          <button type="button" onClick={() => void loadData()} className="terminal-btn ml-auto">
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        <div className="rounded-lg border border-cyan-900/60 bg-cyan-950/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] uppercase tracking-wide text-cyan-200/90">Historical Bootstrap (One-Time)</p>
            <span
              className={`rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${backfillStatusClass(backfillState?.status ?? 'IDLE')}`}
            >
              {backfillState?.status ?? 'IDLE'}
            </span>
          </div>

          <p className="mt-1 text-xs text-zinc-300">
            Pull deep candle history once to strengthen indicators, signals, and chart confidence.
          </p>

          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-[0.9fr_0.9fr_1fr]">
            <label className="text-[11px] text-zinc-400">
              Symbols Limit
              <input
                type="number"
                min={20}
                max={450}
                value={backfillSymbolsLimit}
                onChange={(event) => setBackfillSymbolsLimit(event.target.value)}
                className="terminal-input mt-1 font-mono"
                disabled={backfillState?.status === 'RUNNING'}
              />
            </label>

            <label className="text-[11px] text-zinc-400">
              Since Days (optional)
              <input
                type="number"
                min={1}
                placeholder="Blank = full history"
                value={backfillSinceDays}
                onChange={(event) => setBackfillSinceDays(event.target.value)}
                className="terminal-input mt-1 font-mono"
                disabled={backfillState?.status === 'RUNNING'}
              />
            </label>

            <div className="rounded-lg border border-zinc-800 bg-black/30 p-2 text-xs text-zinc-300">
              <p>
                Progress: {backfillState?.progress.processedSymbols ?? 0} / {backfillState?.progress.totalSymbols ?? 0}{' '}
                symbols ({backfillProgressPct}%)
              </p>
              <p>Rows fetched: {backfillState?.progress.totalFetchedRows ?? 0}</p>
              <p>Candles inserted: {backfillState?.progress.totalInsertedCandles ?? 0}</p>
              {backfillState?.progress.currentSymbol ? (
                <p>Current: {backfillState.progress.currentSymbol}</p>
              ) : null}
            </div>
          </div>

          <div className="mt-3 h-2 rounded-full bg-zinc-900/80">
            <div
              className="h-2 rounded-full bg-cyan-400 transition-all duration-300"
              style={{ width: `${backfillProgressPct}%` }}
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void startAllBackfill()}
              disabled={backfillBusy || backfillState?.status === 'RUNNING'}
              className="terminal-btn-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              {backfillState?.status === 'RUNNING'
                ? 'Backfill Running...'
                : backfillBusy
                  ? 'Starting...'
                  : 'Backfill All Symbols'}
            </button>
            <button
              type="button"
              onClick={() => void backfillSelectedSymbol()}
              disabled={symbolBackfillBusy || !selectedSymbol || backfillState?.status === 'RUNNING'}
              className="terminal-btn disabled:cursor-not-allowed disabled:opacity-60"
            >
              {symbolBackfillBusy ? 'Importing Symbol...' : `Backfill ${selectedSymbol || 'Symbol'} Only`}
            </button>
            <button type="button" onClick={() => void loadBackfillStatus()} className="terminal-btn">
              Refresh Backfill Status
            </button>
          </div>

          {latestBackfillReport ? (
            <p className="mt-2 text-xs text-zinc-300">
              Last report: {latestBackfillReport.symbol} added {latestBackfillReport.insertedCandles} candles
              {latestBackfillReport.error ? ` (error: ${latestBackfillReport.error})` : ''}.
            </p>
          ) : null}

          {backfillState?.error ? <p className="mt-2 text-xs text-terminal-red">{backfillState.error}</p> : null}
          {backfillFeedback ? <p className="mt-2 text-xs text-terminal-green">{backfillFeedback}</p> : null}
          {backfillError ? <p className="mt-2 text-xs text-terminal-red">{backfillError}</p> : null}
        </div>

        {error ? <p className="text-sm font-medium text-terminal-red">{error}</p> : null}
        {historyHint ? <p className="text-xs text-terminal-amber">{historyHint}</p> : null}
        <p className="text-xs text-zinc-500">
          Swing mode enabled by default: focus on end-of-session quality and structure confirmation, not minute-by-minute flips.
        </p>
      </section>

      <section className="grid gap-4 xl:grid-cols-[74px_minmax(0,1fr)_360px]">
        <aside className="terminal-card flex flex-col items-center gap-2 p-2">
          <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500 [writing-mode:vertical-rl]">Tools</p>
          {TOOL_ITEMS.map((tool) => (
            <button
              key={tool}
              type="button"
              onClick={() => setActiveTool(tool)}
              className={
                activeTool === tool
                  ? 'h-9 w-9 rounded-md border border-cyan-400/80 bg-cyan-500/20 text-[11px] font-semibold text-cyan-100'
                  : 'h-9 w-9 rounded-md border border-zinc-700 bg-zinc-900/70 text-[10px] font-medium text-zinc-300 hover:border-cyan-400/40'
              }
              title={tool}
            >
              {tool.slice(0, 2).toUpperCase()}
            </button>
          ))}
          <p className="mt-auto text-[10px] text-zinc-500">Active: {activeTool}</p>
        </aside>

        <div className="space-y-4">
          <section className="terminal-card bg-gradient-to-r from-zinc-950/80 via-slate-950/80 to-zinc-950/80 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">TradingView Style Workstation</p>
                <p className="text-sm text-zinc-300">
                  NEPSE-tailored open-source indicator stack with confluence scoring and strategy linking.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md border border-zinc-700 bg-zinc-900/70 px-2 py-1 text-[11px] text-zinc-200">
                  {selectedSymbol || '-'}
                </span>
                <span className="rounded-md border border-zinc-700 bg-zinc-900/70 px-2 py-1 text-[11px] text-zinc-300">
                  {activeDataInterval}
                </span>
                <span className="rounded-md border border-cyan-500/60 bg-cyan-500/10 px-2 py-1 text-[11px] font-semibold text-cyan-100">
                  Confluence {confluence.score}/100
                </span>
                <span
                  className={
                    confluence.bias === 'BULLISH'
                      ? 'rounded-md border border-green-500/60 bg-green-500/15 px-2 py-1 text-[11px] font-semibold text-green-300'
                      : confluence.bias === 'BEARISH'
                        ? 'rounded-md border border-red-500/60 bg-red-500/15 px-2 py-1 text-[11px] font-semibold text-red-300'
                        : 'rounded-md border border-zinc-700 bg-zinc-800/80 px-2 py-1 text-[11px] font-semibold text-zinc-300'
                  }
                >
                  {confluence.bias}
                </span>
              </div>
            </div>
            <p className="mt-2 text-xs text-zinc-400">{confluence.stance}</p>
          </section>

          <section className="terminal-card p-4">
            {payload?.candles.length ? (
              <>
                <ReactApexChart options={chartOptions} series={priceSeries} type="candlestick" height={500} />
                <div className="mt-2 border-t border-zinc-800 pt-3">
                  <ReactApexChart options={volumeOptions} series={volumeSeries} type="bar" height={150} />
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2">
                    <ReactApexChart options={adxOptions} series={adxSeries} type="line" height={190} />
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2">
                    <ReactApexChart options={stochOptions} series={stochSeries} type="line" height={190} />
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2">
                    <ReactApexChart options={rsiOptions} series={rsiSeries} type="line" height={190} />
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2">
                    <ReactApexChart options={macdOptions} series={macdSeries} type="line" height={190} />
                  </div>
                </div>
              </>
            ) : (
              <div className="grid h-[420px] place-content-center text-center">
                <p className="text-zinc-400">No candles available for the selected symbol yet.</p>
              </div>
            )}
          </section>

          <section className="terminal-card space-y-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">Live Trade Ideas</p>
              <span className="rounded-md border border-zinc-700 bg-zinc-900/70 px-2 py-1 text-[10px] text-zinc-300">
                Pack: {selectedPack.name}
              </span>
            </div>

            {tradeIdeas.length ? (
              <div className="grid gap-2 lg:grid-cols-3">
                {tradeIdeas.map((idea, index) => (
                  <article key={`${idea.title}-${index}`} className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-zinc-100">{idea.title}</h3>
                      <span
                        className={
                          idea.mode === 'LONG'
                            ? 'rounded border border-green-500/60 bg-green-500/15 px-2 py-0.5 text-[10px] font-semibold text-green-300'
                            : idea.mode === 'SHORT'
                              ? 'rounded border border-red-500/60 bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-300'
                              : 'rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] font-semibold text-zinc-300'
                        }
                      >
                        {idea.mode === 'SHORT' ? 'DE-RISK' : idea.mode}
                      </span>
                    </div>
                    <p className="mt-2 text-zinc-300">{idea.setup}</p>
                    <p className="mt-2 text-zinc-400">{idea.entry}</p>
                    <p className="mt-1 text-zinc-400">{idea.invalidation}</p>
                    <p className="mt-1 text-zinc-200">{idea.target}</p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="text-xs text-zinc-500">Trade ideas will appear as soon as candles and open-source indicators are available.</p>
            )}
          </section>

          <section className="terminal-card space-y-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">NEPSE Strategy Backtest Lab</p>
              <span className="rounded-md border border-zinc-700 bg-zinc-900/70 px-2 py-1 text-[10px] text-zinc-300">
                Long-only cash model
              </span>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-[11px] text-zinc-400">
                Lookahead Bars
                <input
                  type="number"
                  min={4}
                  max={40}
                  value={backtestLookahead}
                  onChange={(event) => setBacktestLookahead(event.target.value)}
                  className="terminal-input mt-1"
                />
              </label>
              <label className="text-[11px] text-zinc-400">
                Cooldown Bars
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={backtestCooldownBars}
                  onChange={(event) => setBacktestCooldownBars(event.target.value)}
                  className="terminal-input mt-1"
                />
              </label>
            </div>

            {backtestResult ? (
              <>
                <div className="grid gap-2 md:grid-cols-4">
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-zinc-500">Trades</p>
                    <p className="mt-1 font-mono text-lg text-zinc-100">{backtestResult.summary.trades}</p>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-zinc-500">Win Rate</p>
                    <p className="mt-1 font-mono text-lg text-zinc-100">{safeFixed(backtestResult.summary.winRatePct, 1)}%</p>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-zinc-500">Expectancy</p>
                    <p className="mt-1 font-mono text-lg text-zinc-100">{safeFixed(backtestResult.summary.expectancyR, 2)}R</p>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-zinc-500">Max Drawdown</p>
                    <p className="mt-1 font-mono text-lg text-zinc-100">{safeFixed(backtestResult.summary.maxDrawdownR, 2)}R</p>
                  </div>
                </div>

                <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-xs text-zinc-300">
                    Total R: <span className="font-mono text-zinc-100">{safeFixed(backtestResult.summary.totalR, 2)}R</span>
                    {' | '}
                    Best/Worst: <span className="font-mono text-zinc-100">{safeFixed(backtestResult.summary.bestR, 2)}R / {safeFixed(backtestResult.summary.worstR, 2)}R</span>
                    {' | '}
                    Timeouts: <span className="font-mono text-zinc-100">{backtestResult.summary.timeouts}</span>
                  </p>
                </div>

                <div className="max-h-52 overflow-auto rounded-lg border border-zinc-800 bg-black/30 p-2">
                  <table className="w-full text-left text-[11px] text-zinc-300">
                    <thead className="text-zinc-500">
                      <tr>
                        <th className="px-2 py-1">Date</th>
                        <th className="px-2 py-1">Outcome</th>
                        <th className="px-2 py-1">R</th>
                        <th className="px-2 py-1">Bars</th>
                      </tr>
                    </thead>
                    <tbody>
                      {backtestResult.trades.slice(-10).reverse().map((trade) => (
                        <tr key={`${trade.at}-${trade.entry}`}>
                          <td className="px-2 py-1 font-mono text-zinc-400">{new Date(trade.at).toLocaleDateString()}</td>
                          <td className="px-2 py-1">{trade.outcome}</td>
                          <td className={trade.rMultiple >= 0 ? 'px-2 py-1 font-mono text-green-300' : 'px-2 py-1 font-mono text-red-300'}>
                            {safeFixed(trade.rMultiple, 2)}
                          </td>
                          <td className="px-2 py-1 font-mono text-zinc-400">{trade.barsHeld}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="text-xs text-zinc-500">Backtest will run when enough candles are available.</p>
            )}
          </section>
        </div>

        <aside className="terminal-card space-y-3 p-4">
          <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">Open-Source Strategy Rack</p>

          <div className="grid gap-2">
            <label className="text-[11px] text-zinc-400">
              Strategy Type
              <select
                value={packCategory}
                onChange={(event) => setPackCategory(event.target.value as StrategyPackCategory)}
                className="terminal-input mt-1"
              >
                <option value="all">All Types</option>
                <option value="liquidity">Liquidity</option>
                <option value="trend">Trend</option>
                <option value="momentum">Momentum</option>
                <option value="risk">Risk</option>
              </select>
            </label>
          </div>

          <div className="space-y-2">
            {availablePacks.map((pack) => {
              const reading = strategyReadings[pack.id];
              return (
                <button
                  key={pack.id}
                  type="button"
                  onClick={() => setStrategyPack(pack.id)}
                  className={
                    strategyPack === pack.id
                      ? 'w-full rounded-lg border border-cyan-400/70 bg-cyan-500/10 p-3 text-left'
                      : 'w-full rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 text-left hover:border-zinc-600'
                  }
                >
                  <p className="text-xs font-semibold text-zinc-100">{pack.name}</p>
                  <p className="mt-1 text-[11px] text-zinc-400">{pack.source}</p>
                  <p className="mt-1 text-[11px] text-zinc-300">{nepseStatusLabel(reading.status)} - {reading.score}/100</p>
                </button>
              );
            })}
          </div>

          <article className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
            <p className="text-[10px] uppercase tracking-wide text-zinc-500">Selected Strategy Output</p>
            <p className="mt-1 text-xs text-zinc-100">{strategyReadings[strategyPack].summary}</p>
            <ul className="mt-2 space-y-1 text-[11px] text-zinc-400">
              {strategyReadings[strategyPack].checks.map((check, index) => (
                <li key={`${strategyPack}-check-${index}`}>- {check}</li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-zinc-500">Confluence driver: {confluence.driver}</p>
            {latestNepseLateWeekSweep ? (
              <p className="mt-2 text-[11px] text-amber-300">
                Late-week sweep active ({new Date(latestNepseLateWeekSweep.at).toLocaleDateString()})
              </p>
            ) : null}
          </article>

          <article className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
            <p className="text-[10px] uppercase tracking-wide text-zinc-500">CISD Projection Engine (NEPSE)</p>
            <label className="mt-2 block text-[11px] text-zinc-400">
              Projection Multipliers (comma separated)
              <input
                type="text"
                value={projectionMultipliersRaw}
                onChange={(event) => setProjectionMultipliersRaw(event.target.value)}
                className="terminal-input mt-1"
                placeholder="0.5,1,1.5,2"
              />
            </label>
            <p className="mt-2 text-[11px] text-zinc-500">
              Latest CISD: {latestCisd ? `${latestCisd.direction.toUpperCase()} @ ${safeFixed(latestCisd.breakLevel, 2)}` : 'none'}
            </p>
            <ul className="mt-2 space-y-1 text-[11px] text-zinc-300">
              {cisdProjectionLevels.length ? (
                cisdProjectionLevels.map((projection) => (
                  <li key={`${projection.multiple}-${projection.price}`}>
                    {projection.label}: <span className="font-mono text-zinc-100">{safeFixed(projection.price, 2)}</span>
                  </li>
                ))
              ) : (
                <li className="text-zinc-500">No projection levels yet. Wait for a CISD break.</li>
              )}
            </ul>
          </article>

          <article className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
            <p className="text-[10px] uppercase tracking-wide text-zinc-500">Indicator Snapshot</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <p className="text-zinc-400">
                ADX: <span className="font-mono text-zinc-100">{safeFixed(openSourceBundle?.latest.adx14, 1)}</span>
              </p>
              <p className="text-zinc-400">
                RVOL: <span className="font-mono text-zinc-100">{safeFixed(openSourceBundle?.latest.relativeVolume20, 2)}</span>
              </p>
              <p className="text-zinc-400">
                Stoch K: <span className="font-mono text-zinc-100">{safeFixed(openSourceBundle?.latest.stochK, 1)}</span>
              </p>
              <p className="text-zinc-400">
                Stoch D: <span className="font-mono text-zinc-100">{safeFixed(openSourceBundle?.latest.stochD, 1)}</span>
              </p>
              <p className="text-zinc-400">
                RSI14: <span className="font-mono text-zinc-100">{safeFixed(openSourceBundle?.latest.rsi14, 1)}</span>
              </p>
              <p className="text-zinc-400">
                Supertrend:{' '}
                <span className="font-mono text-zinc-100">
                  {openSourceBundle?.latest.supertrendTrend ? openSourceBundle.latest.supertrendTrend.toUpperCase() : '-'}
                </span>
              </p>
              <p className="text-zinc-400">
                MACD: <span className="font-mono text-zinc-100">{safeFixed(openSourceBundle?.latest.macd, 3)}</span>
              </p>
              <p className="text-zinc-400">
                Signal: <span className="font-mono text-zinc-100">{safeFixed(openSourceBundle?.latest.macdSignal, 3)}</span>
              </p>
              <p className="text-zinc-400">
                MACD Hist: <span className="font-mono text-zinc-100">{safeFixed(openSourceBundle?.latest.macdHistogram, 3)}</span>
              </p>
              <p className="text-zinc-400">
                ATR14: <span className="font-mono text-zinc-100">{safeFixed(openSourceBundle?.latest.atr14, 2)}</span>
              </p>
            </div>
          </article>

          <article className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
            <p className="text-[10px] uppercase tracking-wide text-zinc-500">Liquidity and Level Feed</p>
            <p className="mt-1 text-xs text-zinc-300">
              Sweeps {openSourceBundle?.sweepEvents.length ?? 0} | CISD {openSourceBundle?.cisdEvents.length ?? 0}
            </p>
            <ul className="mt-2 max-h-36 space-y-1 overflow-auto text-[11px] text-zinc-400">
              {(openSourceBundle?.keyLevels.slice(0, 10) ?? []).map((level) => (
                <li key={level.id}>
                  {level.label}: <span className="font-mono text-zinc-200">{safeFixed(level.price, 2)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-zinc-500">
              FVG Local/MTF: {openSourceBundle?.fvgZones.length ?? 0} / {openSourceBundle?.mtfFvgZones.length ?? 0}
            </p>
            <p className="mt-1 text-[11px] text-zinc-500">Late-week sweeps: {openSourceBundle?.nepseLateWeekSweeps.length ?? 0}</p>
          </article>

          <article className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] uppercase tracking-wide text-zinc-500">Alert Router</p>
              <button type="button" onClick={() => setAlertFeed([])} className="terminal-btn px-2 py-1 text-[11px]">
                Clear
              </button>
            </div>
            <div className="mt-2 grid gap-1 text-[11px] text-zinc-300">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={alertsEnabled} onChange={(event) => setAlertsEnabled(event.target.checked)} />
                Enable Alerts
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={alertOnSweep} onChange={(event) => setAlertOnSweep(event.target.checked)} disabled={!alertsEnabled} />
                Sweep Alerts
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={alertOnCisd} onChange={(event) => setAlertOnCisd(event.target.checked)} disabled={!alertsEnabled} />
                CISD Alerts
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={alertOnFvgTouch} onChange={(event) => setAlertOnFvgTouch(event.target.checked)} disabled={!alertsEnabled} />
                FVG Touch Alerts
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={alertOnKeyLevels} onChange={(event) => setAlertOnKeyLevels(event.target.checked)} disabled={!alertsEnabled} />
                Key Level Cross Alerts
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={alertOnConfluence} onChange={(event) => setAlertOnConfluence(event.target.checked)} disabled={!alertsEnabled} />
                Confluence State Alerts
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={alertOnMacdCross} onChange={(event) => setAlertOnMacdCross(event.target.checked)} disabled={!alertsEnabled} />
                MACD Crossover Alerts
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={alertOnRsiZones} onChange={(event) => setAlertOnRsiZones(event.target.checked)} disabled={!alertsEnabled} />
                RSI Zone Alerts
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {ALERT_SETTING_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyAlertSettingPreset(preset.id)}
                  className={
                    activeAlertPreset === preset.id
                      ? 'rounded-md border border-cyan-400/80 bg-cyan-500/15 px-2 py-1 text-[11px] font-semibold text-cyan-100'
                      : 'rounded-md border border-zinc-700 bg-zinc-900/70 px-2 py-1 text-[11px] text-zinc-300 hover:border-cyan-400/40'
                  }
                  disabled={!alertsEnabled}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <label className="text-[11px] text-zinc-400">
                MACD Fast
                <input
                  type="number"
                  min={2}
                  max={50}
                  value={macdFastPeriodRaw}
                  onChange={(event) => setMacdFastPeriodRaw(event.target.value)}
                  className="terminal-input mt-1"
                  disabled={!alertsEnabled}
                />
              </label>
              <label className="text-[11px] text-zinc-400">
                MACD Slow
                <input
                  type="number"
                  min={3}
                  max={120}
                  value={macdSlowPeriodRaw}
                  onChange={(event) => setMacdSlowPeriodRaw(event.target.value)}
                  className="terminal-input mt-1"
                  disabled={!alertsEnabled}
                />
              </label>
              <label className="text-[11px] text-zinc-400">
                MACD Signal
                <input
                  type="number"
                  min={2}
                  max={50}
                  value={macdSignalPeriodRaw}
                  onChange={(event) => setMacdSignalPeriodRaw(event.target.value)}
                  className="terminal-input mt-1"
                  disabled={!alertsEnabled}
                />
              </label>
              <label className="text-[11px] text-zinc-400">
                RSI Overbought
                <input
                  type="number"
                  min={50}
                  max={95}
                  value={rsiOverboughtRaw}
                  onChange={(event) => setRsiOverboughtRaw(event.target.value)}
                  className="terminal-input mt-1"
                  disabled={!alertsEnabled}
                />
              </label>
              <label className="text-[11px] text-zinc-400">
                RSI Oversold
                <input
                  type="number"
                  min={5}
                  max={50}
                  value={rsiOversoldRaw}
                  onChange={(event) => setRsiOversoldRaw(event.target.value)}
                  className="terminal-input mt-1"
                  disabled={!alertsEnabled}
                />
              </label>
              <div className="rounded border border-zinc-800 bg-zinc-950/70 px-2 py-1 text-[11px] text-zinc-400">
                Active: MACD {parsedMacdFastPeriod}/{parsedMacdSlowPeriod}/{parsedMacdSignalPeriod} | RSI {safeFixed(rsiOversoldThreshold, 1)}/{safeFixed(rsiOverboughtThreshold, 1)}
              </div>
            </div>
            <div className="mt-3 max-h-40 overflow-auto rounded border border-zinc-800 bg-black/30 p-2">
              {alertFeed.length ? (
                <ul className="space-y-1 text-[11px] text-zinc-300">
                  {alertFeed.map((alertItem) => (
                    <li key={alertItem.id}>
                      <span className="font-semibold text-zinc-100">[{alertItem.type}]</span> {alertItem.message}
                      <div className="text-[10px] text-zinc-500">{new Date(alertItem.at).toLocaleString()}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-zinc-500">No alerts yet.</p>
              )}
            </div>
          </article>
        </aside>
      </section>

      <footer className="terminal-card space-y-2 p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-zinc-400">
            Last Close:{' '}
            <span className="font-mono text-base font-bold text-white">₹ {lastCandle ? formatMoney(lastCandle.c) : '-'}</span>
          </p>
          <p className="text-zinc-500">
            Last Candle:{' '}
            <span className="font-mono text-zinc-200">{lastCandle ? new Date(lastCandle.t).toLocaleString() : '-'}</span>
          </p>
        </div>
        <p className="text-xs text-zinc-500">
          Open-source mode enabled: all indicators and strategy packs shown here are transparent, educational, and should be combined with strict risk management.
        </p>
      </footer>
    </section>
  );
}
