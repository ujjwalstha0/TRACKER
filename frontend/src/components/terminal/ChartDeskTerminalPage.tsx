import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ApexAxisChartSeries, ApexOptions } from 'apexcharts';
import ReactApexChart from 'react-apexcharts';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchIndicators, fetchSignal, fetchWatchlist } from '../../lib/api';
import { confidenceBadgeClass, signalBadgeClass } from '../../lib/signal-ui';
import { IndicatorsResponse, TradingSignalResponse, WatchlistApiRow } from '../../types';

const INTERVALS = ['1m', '5m', '15m', '1h', '1d'] as const;
type Interval = (typeof INTERVALS)[number];

const CHART_REFRESH_INTERVAL_MS = 60_000;
const SIGNAL_REFRESH_INTERVAL_MS = 60_000;

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

function actionabilityClass(label: 'EXECUTABLE' | 'WATCH' | 'BLOCKED'): string {
  if (label === 'EXECUTABLE') return 'border-terminal-green/70 bg-terminal-green/15 text-terminal-green';
  if (label === 'WATCH') return 'border-terminal-amber/70 bg-terminal-amber/15 text-terminal-amber';
  return 'border-terminal-red/70 bg-terminal-red/15 text-terminal-red';
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
  const [payload, setPayload] = useState<IndicatorsResponse | null>(null);
  const [signal, setSignal] = useState<TradingSignalResponse | null>(null);
  const [activeDataInterval, setActiveDataInterval] = useState<Interval>('1d');
  const [historyHint, setHistoryHint] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [minQuality, setMinQuality] = useState(() => readStoredValue('chartdesk.minQuality', '82'));
  const [minRiskReward, setMinRiskReward] = useState(() => readStoredValue('chartdesk.minRR', '1.8'));
  const [minSampleSize, setMinSampleSize] = useState(() => readStoredValue('chartdesk.minSample', '10'));

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('chartdesk.minQuality', minQuality);
    window.localStorage.setItem('chartdesk.minRR', minRiskReward);
    window.localStorage.setItem('chartdesk.minSample', minSampleSize);
  }, [minQuality, minRiskReward, minSampleSize]);

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

      setPayload(best);
      setActiveDataInterval(bestInterval);
      setHistoryHint(hint);
      setError('');
    } catch (requestError) {
      setPayload(null);
      setActiveDataInterval(interval);
      setHistoryHint('');
      setError(requestError instanceof Error ? requestError.message : 'Unable to load chart feed.');
    } finally {
      setLoading(false);
    }
  }, [interval, selectedSymbol]);

  useEffect(() => {
    void loadData();

    const timer = window.setInterval(() => {
      void loadData();
    }, CHART_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [loadData]);

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

    return series;
  }, [payload, showBollinger, showEma20, showSma20, showVwap]);

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
      colors: ['#94a3b8', '#f59e0b', '#34d399', '#a1a1aa', '#a1a1aa', '#22d3ee'],
      annotations: {
        yaxis: structureAnnotations,
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
  }, [showStructure, signal]);

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

  const lastCandle = payload?.candles[payload.candles.length - 1] ?? null;
  const selectedMeta = useMemo(
    () => watchlist.find((row) => row.symbol === selectedSymbol) ?? null,
    [selectedSymbol, watchlist],
  );

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
          <button type="button" onClick={() => void loadData()} className="terminal-btn ml-auto">
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {error ? <p className="text-sm font-medium text-terminal-red">{error}</p> : null}
        {historyHint ? <p className="text-xs text-terminal-amber">{historyHint}</p> : null}
        <p className="text-xs text-zinc-500">
          Swing mode enabled by default: focus on end-of-session quality and structure confirmation, not minute-by-minute flips.
        </p>
      </section>

      <section className="terminal-card p-4">
        {payload?.candles.length ? (
          <>
            <ReactApexChart options={chartOptions} series={priceSeries} type="candlestick" height={500} />
            <div className="mt-2 border-t border-zinc-800 pt-3">
              <ReactApexChart options={volumeOptions} series={volumeSeries} type="bar" height={170} />
            </div>
          </>
        ) : (
          <div className="grid h-[420px] place-content-center text-center">
            <p className="text-zinc-400">No candles available for the selected symbol yet.</p>
          </div>
        )}
      </section>

      <footer className="terminal-card flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
        <p className="text-zinc-400">
          Last Close:{' '}
          <span className="font-mono text-base font-bold text-white">₹ {lastCandle ? formatMoney(lastCandle.c) : '-'}</span>
        </p>
        <p className="text-zinc-500">
          Last Candle:{' '}
          <span className="font-mono text-zinc-200">{lastCandle ? new Date(lastCandle.t).toLocaleString() : '-'}</span>
        </p>
      </footer>
    </section>
  );
}
