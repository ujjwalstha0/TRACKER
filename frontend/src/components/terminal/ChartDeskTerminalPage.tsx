import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ApexAxisChartSeries, ApexOptions } from 'apexcharts';
import ReactApexChart from 'react-apexcharts';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchIndicators, fetchWatchlist } from '../../lib/api';
import { IndicatorsResponse, WatchlistApiRow } from '../../types';

const INTERVALS = ['1m', '5m', '15m', '1h', '1d'] as const;
type Interval = (typeof INTERVALS)[number];

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
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
      const response = await fetchIndicators(selectedSymbol, interval, 320);
      setPayload(response);
      setError('');
    } catch (requestError) {
      setPayload(null);
      setError(requestError instanceof Error ? requestError.message : 'Unable to load chart feed.');
    } finally {
      setLoading(false);
    }
  }, [interval, selectedSymbol]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

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
          formatter: (value) => value.toFixed(2),
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
            <div className="terminal-input flex items-center justify-between text-zinc-300">Candles</div>
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
