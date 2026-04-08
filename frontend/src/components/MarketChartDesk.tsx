import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ApexOptions } from 'apexcharts';
import ReactApexChart from 'react-apexcharts';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchIndicators, fetchWatchlist } from '../lib/api';
import { IndicatorsResponse, WatchlistApiRow } from '../types';

const INTERVAL_OPTIONS = ['1m', '5m', '15m', '1h', '1d'] as const;
type IntervalOption = (typeof INTERVAL_OPTIONS)[number];

interface IndicatorToggles {
  sma20: boolean;
  ema20: boolean;
  bollinger: boolean;
  vwap: boolean;
}

function formatNumber(value: number | null, digits = 2): string {
  if (value === null) return '-';
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function MarketChartDesk() {
  const params = useParams<{ symbol?: string }>();
  const navigate = useNavigate();

  const symbolFromUrl = params.symbol?.toUpperCase() ?? '';

  const [watchlist, setWatchlist] = useState<WatchlistApiRow[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState(symbolFromUrl);
  const [interval, setInterval] = useState<IntervalOption>('15m');
  const [limit, setLimit] = useState(240);
  const [toggles, setToggles] = useState<IndicatorToggles>({
    sma20: true,
    ema20: true,
    bollinger: true,
    vwap: false,
  });
  const [payload, setPayload] = useState<IndicatorsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (symbolFromUrl && symbolFromUrl !== selectedSymbol) {
      setSelectedSymbol(symbolFromUrl);
    }
  }, [symbolFromUrl, selectedSymbol]);

  useEffect(() => {
    fetchWatchlist()
      .then((rows) => {
        setWatchlist(rows);

        if (selectedSymbol) {
          return;
        }

        const preferred = symbolFromUrl || rows[0]?.symbol;
        if (!preferred) {
          return;
        }

        setSelectedSymbol(preferred);
        navigate(`/chart/${preferred}`, { replace: true });
      })
      .catch(() => {
        setWatchlist([]);
      });
  }, [navigate, selectedSymbol, symbolFromUrl]);

  const loadChart = useCallback(async () => {
    if (!selectedSymbol) return;

    setLoading(true);
    try {
      const data = await fetchIndicators(selectedSymbol, interval, limit);
      setPayload(data);
      setError('');
    } catch (e) {
      setPayload(null);
      setError(e instanceof Error ? e.message : 'Failed to load chart data.');
    } finally {
      setLoading(false);
    }
  }, [interval, limit, selectedSymbol]);

  useEffect(() => {
    void loadChart();
  }, [loadChart]);

  const quickPicks = useMemo(() => {
    return [...watchlist]
      .sort((a, b) => (b.turnover ?? 0) - (a.turnover ?? 0))
      .slice(0, 12);
  }, [watchlist]);

  const latestCandle = useMemo(() => {
    if (!payload?.candles.length) return null;
    return payload.candles[payload.candles.length - 1];
  }, [payload]);

  const priceSeries = useMemo(() => {
    if (!payload) return [];

    const series: Array<{
      name: string;
      type: 'candlestick' | 'line';
      data: Array<{ x: number; y: number | [number, number, number, number] | null }>;
    }> = [
      {
        name: `${payload.symbol} OHLC`,
        type: 'candlestick',
        data: payload.candles.map((candle) => ({
          x: new Date(candle.t).getTime(),
          y: [candle.o, candle.h, candle.l, candle.c],
        })),
      },
    ];

    if (toggles.sma20) {
      series.push({
        name: 'SMA 20',
        type: 'line',
        data: payload.sma20.map((point) => ({
          x: new Date(point.t).getTime(),
          y: point.value,
        })),
      });
    }

    if (toggles.ema20) {
      series.push({
        name: 'EMA 20',
        type: 'line',
        data: payload.ema20.map((point) => ({
          x: new Date(point.t).getTime(),
          y: point.value,
        })),
      });
    }

    if (toggles.bollinger) {
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
          name: 'Bollinger Mid',
          type: 'line',
          data: payload.bollinger.middle.map((point) => ({
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

    if (toggles.vwap) {
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
  }, [payload, toggles]);

  const priceOptions = useMemo<ApexOptions>(() => {
    return {
      chart: {
        type: 'candlestick',
        height: 460,
        background: 'transparent',
        toolbar: { show: true },
        zoom: { enabled: true, type: 'x' },
      },
      theme: { mode: 'light' },
      grid: {
        borderColor: '#d2dde8',
        strokeDashArray: 3,
      },
      xaxis: {
        type: 'datetime',
        labels: {
          datetimeUTC: false,
        },
      },
      yaxis: {
        labels: {
          formatter: (value) => value.toFixed(2),
        },
      },
      legend: {
        position: 'top',
        horizontalAlign: 'left',
      },
      stroke: {
        width: [1, 2, 2, 1.5, 1.5, 1.5, 2],
        curve: 'smooth',
      },
      colors: ['#2a7de1', '#f97316', '#10b981', '#9ca3af', '#6b7280', '#9ca3af', '#f43f5e'],
      tooltip: {
        shared: true,
      },
      plotOptions: {
        candlestick: {
          colors: {
            upward: '#16a34a',
            downward: '#dc2626',
          },
          wick: {
            useFillColor: true,
          },
        },
      },
    };
  }, []);

  const rsiSeries = useMemo(() => {
    if (!payload) return [];
    return [
      {
        name: 'RSI 14',
        data: payload.rsi14.map((point) => ({
          x: new Date(point.t).getTime(),
          y: point.value,
        })),
      },
    ];
  }, [payload]);

  const rsiOptions = useMemo<ApexOptions>(() => {
    return {
      chart: {
        type: 'line',
        height: 200,
        toolbar: { show: false },
        background: 'transparent',
      },
      stroke: { width: 2, curve: 'smooth' },
      colors: ['#2563eb'],
      xaxis: {
        type: 'datetime',
        labels: { datetimeUTC: false },
      },
      yaxis: {
        min: 0,
        max: 100,
      },
      grid: {
        borderColor: '#d2dde8',
        strokeDashArray: 3,
      },
      annotations: {
        yaxis: [
          { y: 70, borderColor: '#dc2626', strokeDashArray: 4 },
          { y: 30, borderColor: '#16a34a', strokeDashArray: 4 },
        ],
      },
    };
  }, []);

  const macdSeries = useMemo(() => {
    if (!payload) return [];

    return [
      {
        name: 'MACD',
        type: 'line',
        data: payload.macd.line.map((point) => ({
          x: new Date(point.t).getTime(),
          y: point.value,
        })),
      },
      {
        name: 'Signal',
        type: 'line',
        data: payload.macd.signal.map((point) => ({
          x: new Date(point.t).getTime(),
          y: point.value,
        })),
      },
      {
        name: 'Histogram',
        type: 'column',
        data: payload.macd.histogram.map((point) => ({
          x: new Date(point.t).getTime(),
          y: point.value,
        })),
      },
    ];
  }, [payload]);

  const macdOptions = useMemo<ApexOptions>(() => {
    return {
      chart: {
        type: 'line',
        height: 240,
        stacked: false,
        background: 'transparent',
        toolbar: { show: false },
      },
      stroke: {
        width: [2, 2, 1],
        curve: 'smooth',
      },
      plotOptions: {
        bar: {
          columnWidth: '70%',
        },
      },
      colors: ['#1d4ed8', '#f97316', '#6b7280'],
      xaxis: {
        type: 'datetime',
        labels: { datetimeUTC: false },
      },
      grid: {
        borderColor: '#d2dde8',
        strokeDashArray: 3,
      },
    };
  }, []);

  const handleSymbolPick = useCallback(
    (symbol: string) => {
      setSelectedSymbol(symbol);
      navigate(`/chart/${symbol}`);
    },
    [navigate],
  );

  return (
    <section className="card chart-desk">
      <div className="chart-head">
        <div>
          <h2>Market Chart Desk</h2>
          <p className="subtle">Candles + indicators for deliberate entries and exits.</p>
        </div>
        <button className="theme-btn" type="button" onClick={() => void loadChart()} disabled={loading || !selectedSymbol}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <div className="chart-controls">
        <div className="field-group">
          <label className="label" htmlFor="chartSymbol">
            Company
          </label>
          <select
            id="chartSymbol"
            value={selectedSymbol}
            onChange={(e) => handleSymbolPick(e.target.value)}
            disabled={!watchlist.length}
          >
            {!watchlist.length ? <option value="">No symbols available</option> : null}
            {watchlist.map((row) => (
              <option key={row.symbol} value={row.symbol}>
                {row.symbol} {row.company ? `- ${row.company}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="field-group">
          <label className="label" htmlFor="interval">
            Interval
          </label>
          <select
            id="interval"
            value={interval}
            onChange={(e) => setInterval(e.target.value as IntervalOption)}
          >
            {INTERVAL_OPTIONS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <div className="field-group">
          <label className="label" htmlFor="candlesLimit">
            Candles
          </label>
          <select id="candlesLimit" value={String(limit)} onChange={(e) => setLimit(Number(e.target.value))}>
            {[120, 240, 360, 500].map((value) => (
              <option key={value} value={String(value)}>
                {value}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="chart-toggle-row">
        <button
          type="button"
          className={toggles.sma20 ? 'toggle active' : 'toggle'}
          onClick={() => setToggles((prev) => ({ ...prev, sma20: !prev.sma20 }))}
        >
          SMA 20
        </button>
        <button
          type="button"
          className={toggles.ema20 ? 'toggle active' : 'toggle'}
          onClick={() => setToggles((prev) => ({ ...prev, ema20: !prev.ema20 }))}
        >
          EMA 20
        </button>
        <button
          type="button"
          className={toggles.bollinger ? 'toggle active' : 'toggle'}
          onClick={() => setToggles((prev) => ({ ...prev, bollinger: !prev.bollinger }))}
        >
          Bollinger
        </button>
        <button
          type="button"
          className={toggles.vwap ? 'toggle active' : 'toggle'}
          onClick={() => setToggles((prev) => ({ ...prev, vwap: !prev.vwap }))}
        >
          VWAP
        </button>
      </div>

      <div className="summary-grid chart-meta-grid">
        <article className="summary-card">
          <p>Selected Symbol</p>
          <h3>{selectedSymbol || '-'}</h3>
          <small>Interval: {interval}</small>
        </article>
        <article className="summary-card">
          <p>Last Candle Close</p>
          <h3>{latestCandle ? formatNumber(latestCandle.c) : '-'}</h3>
          <small>Volume: {latestCandle ? formatNumber(latestCandle.v, 0) : '-'}</small>
        </article>
        <article className="summary-card">
          <p>Last Candle Time</p>
          <h3>{latestCandle ? new Date(latestCandle.t).toLocaleTimeString() : '-'}</h3>
          <small>{latestCandle ? new Date(latestCandle.t).toLocaleDateString() : '-'}</small>
        </article>
      </div>

      <div className="mini-live-ticker chart-quick-picks">
        {quickPicks.length ? (
          quickPicks.map((row) => (
            <button
              key={row.symbol}
              type="button"
              className={selectedSymbol === row.symbol ? 'mini-live-symbol active' : 'mini-live-symbol'}
              onClick={() => handleSymbolPick(row.symbol)}
            >
              <strong>{row.symbol}</strong> {formatNumber(row.ltp)} ({formatNumber(row.change_pct)}%)
            </button>
          ))
        ) : (
          <span>Quick picks are unavailable until watchlist data arrives.</span>
        )}
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      {!payload?.candles.length && !loading ? <p className="subtle">No OHLC candles are available for this symbol yet.</p> : null}

      {payload?.candles.length ? (
        <>
          <div className="chart-frame">
            <ReactApexChart options={priceOptions} series={priceSeries} type="candlestick" height={460} />
          </div>

          <div className="indicator-grid">
            <article className="scenario-card">
              <h3>RSI 14</h3>
              <ReactApexChart options={rsiOptions} series={rsiSeries} type="line" height={200} />
            </article>

            <article className="scenario-card">
              <h3>MACD (12, 26, 9)</h3>
              <ReactApexChart options={macdOptions} series={macdSeries} type="line" height={240} />
            </article>
          </div>
        </>
      ) : null}
    </section>
  );
}
