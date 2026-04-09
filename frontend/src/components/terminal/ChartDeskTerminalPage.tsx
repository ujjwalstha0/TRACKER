import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ApexAxisChartSeries, ApexOptions } from 'apexcharts';
import ReactApexChart from 'react-apexcharts';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchIndicators, fetchSignal, fetchWatchlist } from '../../lib/api';
import { confidenceBadgeClass, signalBadgeClass } from '../../lib/signal-ui';
import { IndicatorsResponse, TradingSignalResponse, WatchlistApiRow } from '../../types';

const INTERVALS = ['1m', '5m', '15m', '1h', '1d'] as const;
type Interval = (typeof INTERVALS)[number];

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

export function ChartDeskTerminalPage() {
  const { symbol: symbolParam } = useParams<{ symbol?: string }>();
  const navigate = useNavigate();

  const [watchlist, setWatchlist] = useState<WatchlistApiRow[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState(symbolParam?.toUpperCase() ?? '');
  const [interval, setInterval] = useState<Interval>('15m');
  const [showSma20, setShowSma20] = useState(false);
  const [showEma20, setShowEma20] = useState(true);
  const [showBollinger, setShowBollinger] = useState(true);
  const [showVwap, setShowVwap] = useState(false);
  const [payload, setPayload] = useState<IndicatorsResponse | null>(null);
  const [signal, setSignal] = useState<TradingSignalResponse | null>(null);
  const [activeDataInterval, setActiveDataInterval] = useState<Interval>('15m');
  const [historyHint, setHistoryHint] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
  }, [loadData]);

  useEffect(() => {
    if (!selectedSymbol) {
      setSignal(null);
      return;
    }

    let active = true;

    fetchSignal(selectedSymbol)
      .then((response) => {
        if (!active) return;
        setSignal(response);
      })
      .catch(() => {
        if (!active) return;
        setSignal(null);
      });

    return () => {
      active = false;
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
        width: [1, 2.4, 2.2, 1.4, 1.4, 2],
        curve: 'smooth',
      },
      colors: ['#94a3b8', '#f59e0b', '#34d399', '#a1a1aa', '#a1a1aa', '#22d3ee'],
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
  }, []);

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

      <section className="terminal-card space-y-3 p-5">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Pro Trader Signal</p>
        {signal ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-lg border px-4 py-2 text-xl font-bold uppercase tracking-wide ${signalBadgeClass(signal.signal)}`}>
                {signal.signal}
              </span>
              <span className={`rounded-lg border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${confidenceBadgeClass(signal.confidence)}`}>
                {signal.confidence}
              </span>
            </div>
            <p className="text-sm font-medium text-zinc-200">
              {signal.signal} ({signal.confidence}) - {signal.reasons.join(' + ') || 'No strong reasons'}
            </p>
            <p className="text-xs text-zinc-500">Recommended Action: {signal.recommendedAction}</p>
          </>
        ) : (
          <p className="text-sm text-zinc-500">Signal unavailable for the selected symbol.</p>
        )}
        <p className="text-xs text-zinc-500">
          Signals for analysis only. Not financial advice. Past performance ≠ future results.
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
          <button type="button" onClick={() => void loadData()} className="terminal-btn ml-auto">
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {error ? <p className="text-sm font-medium text-terminal-red">{error}</p> : null}
        {historyHint ? <p className="text-xs text-terminal-amber">{historyHint}</p> : null}
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
