import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ApexAxisChartSeries, ApexNonAxisChartSeries, ApexOptions } from 'apexcharts';
import ReactApexChart from 'react-apexcharts';
import { fetchEconomicNews } from '../../lib/api';
import { EconomicNewsItem, EconomicNewsResponse, NewsImpactLevel } from '../../types';

const NEWS_REFRESH_INTERVAL_MS = 120_000;

type ImpactFilter = 'ALL' | NewsImpactLevel;

function impactClass(impact: NewsImpactLevel): string {
  if (impact === 'HIGH') return 'border-terminal-red/70 bg-terminal-red/20 text-terminal-red';
  if (impact === 'MEDIUM') return 'border-terminal-amber/70 bg-terminal-amber/20 text-terminal-amber';
  return 'border-cyan-400/70 bg-cyan-500/15 text-cyan-200';
}

function formatDateLabel(isoDate: string | null): string {
  if (!isoDate) return 'Date unavailable';
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleDateString();
}

function formatRelativeTime(value: string | null): string {
  if (!value) return 'n/a';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return 'n/a';

  const diffHours = Math.floor((Date.now() - parsed) / (1000 * 60 * 60));
  if (diffHours < 1) return 'just now';
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function MarketNewsTerminalPage() {
  const [payload, setPayload] = useState<EconomicNewsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [impactFilter, setImpactFilter] = useState<ImpactFilter>('ALL');
  const [sourceFilter, setSourceFilter] = useState<string>('ALL');
  const [query, setQuery] = useState('');

  const loadNews = useCallback(async () => {
    setLoading(true);

    try {
      const response = await fetchEconomicNews(40);
      setPayload(response);
      setError('');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to load economy-market news.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNews();

    const timer = setInterval(() => {
      void loadNews();
    }, NEWS_REFRESH_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [loadNews]);

  const filteredItems = useMemo(() => {
    const allItems = payload?.items ?? [];
    return allItems.filter((item) => {
      if (impactFilter !== 'ALL' && item.impact !== impactFilter) return false;
      if (sourceFilter !== 'ALL' && item.source !== sourceFilter) return false;

      if (!query.trim()) return true;
      const needle = query.trim().toLowerCase();
      return (
        item.headline.toLowerCase().includes(needle) ||
        item.tags.some((tag) => tag.toLowerCase().includes(needle))
      );
    });
  }, [impactFilter, payload?.items, query, sourceFilter]);

  const stats = useMemo(() => {
    const allItems = payload?.items ?? [];
    return {
      total: allItems.length,
      high: allItems.filter((item) => item.impact === 'HIGH').length,
      medium: allItems.filter((item) => item.impact === 'MEDIUM').length,
      low: allItems.filter((item) => item.impact === 'LOW').length,
    };
  }, [payload?.items]);

  const sourceStats = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of payload?.items ?? []) {
      map.set(item.source, (map.get(item.source) ?? 0) + 1);
    }

    return [...map.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count);
  }, [payload?.items]);

  const sourceOptions = useMemo<ApexOptions>(() => {
    return {
      chart: {
        type: 'bar',
        toolbar: { show: false },
        background: 'transparent',
        animations: { enabled: false },
      },
      plotOptions: {
        bar: {
          borderRadius: 6,
          horizontal: true,
          distributed: true,
          barHeight: '58%',
        },
      },
      colors: ['#f59e0b', '#f97316', '#0ea5e9', '#22c55e', '#e11d48', '#a855f7'],
      dataLabels: { enabled: false },
      grid: {
        borderColor: '#27272a',
        strokeDashArray: 2,
      },
      xaxis: {
        labels: {
          style: { colors: '#a1a1aa' },
        },
      },
      yaxis: {
        labels: {
          style: { colors: '#a1a1aa' },
        },
      },
      tooltip: {
        theme: 'dark',
      },
      legend: { show: false },
    };
  }, []);

  const sourceSeries = useMemo<ApexAxisChartSeries>(() => {
    return [
      {
        name: 'Headlines',
        data: sourceStats.slice(0, 6).map((item) => item.count),
      },
    ];
  }, [sourceStats]);

  const sourceCategories = useMemo(() => {
    return sourceStats.slice(0, 6).map((item) => item.source.toUpperCase());
  }, [sourceStats]);

  const impactOptions = useMemo<ApexOptions>(() => {
    return {
      chart: {
        type: 'donut',
        toolbar: { show: false },
        animations: { enabled: false },
      },
      labels: ['High', 'Medium', 'Low'],
      colors: ['#ef4444', '#f59e0b', '#38bdf8'],
      dataLabels: { enabled: false },
      legend: {
        position: 'bottom',
        labels: { colors: '#a1a1aa' },
      },
      stroke: { colors: ['#09090b'] },
      tooltip: { theme: 'dark' },
    };
  }, []);

  const impactSeries = useMemo<ApexNonAxisChartSeries>(() => {
    return [stats.high, stats.medium, stats.low];
  }, [stats.high, stats.low, stats.medium]);

  const fiveDayTrend = useMemo(() => {
    const items = payload?.items ?? [];
    const pointMap = new Map<string, number>();
    const now = payload?.asOf ? new Date(payload.asOf) : new Date();

    for (let i = 4; i >= 0; i -= 1) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      pointMap.set(key, 0);
    }

    for (const item of items) {
      if (!item.publishedDate) continue;
      if (!pointMap.has(item.publishedDate)) continue;
      pointMap.set(item.publishedDate, (pointMap.get(item.publishedDate) ?? 0) + 1);
    }

    const points = [...pointMap.entries()].map(([date, count]) => ({
      date,
      count,
      label: formatDateLabel(date),
    }));

    return {
      labels: points.map((item) => item.label),
      counts: points.map((item) => item.count),
    };
  }, [payload?.asOf, payload?.items]);

  const trendOptions = useMemo<ApexOptions>(() => {
    return {
      chart: {
        type: 'area',
        toolbar: { show: false },
        animations: { enabled: false },
      },
      stroke: {
        curve: 'smooth',
        width: 3,
      },
      colors: ['#22d3ee'],
      fill: {
        type: 'gradient',
        gradient: {
          shadeIntensity: 1,
          opacityFrom: 0.35,
          opacityTo: 0.05,
        },
      },
      dataLabels: { enabled: false },
      grid: {
        borderColor: '#27272a',
        strokeDashArray: 2,
      },
      xaxis: {
        categories: fiveDayTrend.labels,
        labels: { style: { colors: '#a1a1aa' } },
      },
      yaxis: {
        labels: { style: { colors: '#a1a1aa' } },
      },
      tooltip: { theme: 'dark' },
    };
  }, [fiveDayTrend.labels]);

  const trendSeries = useMemo<ApexAxisChartSeries>(() => {
    return [
      {
        name: 'Headlines',
        data: fiveDayTrend.counts,
      },
    ];
  }, [fiveDayTrend.counts]);

  const topTags = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of payload?.items ?? []) {
      for (const tag of item.tags) {
        map.set(tag, (map.get(tag) ?? 0) + 1);
      }
    }

    return [...map.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [payload?.items]);

  return (
    <section className="space-y-5">
      <header className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-[radial-gradient(circle_at_20%_20%,rgba(34,211,238,0.18),transparent_35%),radial-gradient(circle_at_80%_0%,rgba(245,158,11,0.16),transparent_28%),#09090b] p-6">
        <div className="absolute -right-10 top-0 h-36 w-36 rounded-full bg-terminal-red/10 blur-3xl" />
        <div className="absolute left-1/3 top-0 h-28 w-28 rounded-full bg-cyan-400/15 blur-3xl" />
        <div className="relative space-y-2">
          <p className="text-xs uppercase tracking-[0.22em] text-zinc-400">Macro & Market Monitor</p>
          <h1 className="text-3xl font-semibold tracking-tight text-white">Economy News Impact Desk</h1>
          <p className="max-w-3xl text-sm text-zinc-300">
            Premium macro feed from multiple sources, auto-filtered to recent five-day headlines and ranked by likely impact on NEPSE decisions.
          </p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
            <span className="rounded-full border border-zinc-700 bg-zinc-900/70 px-3 py-1">As of {formatDateLabel(payload?.asOf ?? null)} ({formatRelativeTime(payload?.asOf ?? null)})</span>
            <span className="rounded-full border border-zinc-700 bg-zinc-900/70 px-3 py-1">Source Mode: {payload?.source ?? 'multi-source'}</span>
          </div>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-4">
        <article className="terminal-card p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Total Headlines</p>
          <p className="mt-2 font-mono text-2xl font-bold text-white">{stats.total}</p>
        </article>
        <article className="terminal-card p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">High Impact</p>
          <p className="mt-2 font-mono text-2xl font-bold text-terminal-red">{stats.high}</p>
        </article>
        <article className="terminal-card p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Medium Impact</p>
          <p className="mt-2 font-mono text-2xl font-bold text-terminal-amber">{stats.medium}</p>
        </article>
        <article className="terminal-card p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Low Impact</p>
          <p className="mt-2 font-mono text-2xl font-bold text-cyan-200">{stats.low}</p>
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <article className="terminal-card overflow-hidden">
          <header className="border-b border-zinc-800 p-4">
            <h2 className="text-sm font-semibold text-white">Impact Mix</h2>
            <p className="mt-1 text-xs text-zinc-500">High vs medium vs low impact composition</p>
          </header>
          <div className="p-3">
            <ReactApexChart options={impactOptions} series={impactSeries} type="donut" height={250} />
          </div>
        </article>

        <article className="terminal-card overflow-hidden">
          <header className="border-b border-zinc-800 p-4">
            <h2 className="text-sm font-semibold text-white">Source Coverage</h2>
            <p className="mt-1 text-xs text-zinc-500">How many useful items came from each source</p>
          </header>
          <div className="p-3">
            <ReactApexChart
              options={{
                ...sourceOptions,
                xaxis: {
                  ...sourceOptions.xaxis,
                  categories: sourceCategories,
                },
              }}
              series={sourceSeries}
              type="bar"
              height={250}
            />
          </div>
        </article>

        <article className="terminal-card overflow-hidden">
          <header className="border-b border-zinc-800 p-4">
            <h2 className="text-sm font-semibold text-white">5-Day Signal Flow</h2>
            <p className="mt-1 text-xs text-zinc-500">Recent useful-news arrival trend</p>
          </header>
          <div className="p-3">
            <ReactApexChart options={trendOptions} series={trendSeries} type="area" height={250} />
          </div>
        </article>
      </section>

      <section className="terminal-card p-4">
        <h2 className="text-sm font-semibold text-white">Top Themes</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {topTags.length ? (
            topTags.map((item) => (
              <div key={item.tag} className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500">{item.tag}</p>
                <p className="mt-2 font-mono text-xl font-semibold text-cyan-200">{item.count}</p>
              </div>
            ))
          ) : (
            <p className="text-sm text-zinc-500">No tags detected yet.</p>
          )}
        </div>
      </section>

      <section className="terminal-card overflow-hidden">
        <header className="flex flex-wrap items-center gap-3 border-b border-zinc-800 p-4">
          <h2 className="text-base font-semibold text-white">Economy News Feed</h2>

          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="terminal-input ml-auto max-w-[220px]"
            placeholder="Search theme or headline"
          />

          <select
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.target.value)}
            className="terminal-input max-w-[170px]"
          >
            <option value="ALL">All Sources</option>
            {sourceStats.map((item) => (
              <option key={item.source} value={item.source}>
                {item.source.toUpperCase()}
              </option>
            ))}
          </select>

          <select
            value={impactFilter}
            onChange={(event) => setImpactFilter(event.target.value as ImpactFilter)}
            className="terminal-input max-w-[180px]"
          >
            <option value="ALL">All Impacts</option>
            <option value="HIGH">High Impact</option>
            <option value="MEDIUM">Medium Impact</option>
            <option value="LOW">Low Impact</option>
          </select>

          <button type="button" onClick={() => void loadNews()} className="terminal-btn">
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </header>

        {error ? <p className="border-b border-zinc-800 px-4 py-3 text-sm text-terminal-red">{error}</p> : null}

        <div className="max-h-[620px] space-y-3 overflow-y-auto p-4">
          {filteredItems.length ? (
            filteredItems.map((item: EconomicNewsItem, index) => (
              <article key={`${item.url}-${index}`} className="rounded-xl border border-zinc-800 bg-zinc-950/75 p-4 transition hover:border-zinc-700 hover:bg-zinc-950">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${impactClass(item.impact)}`}>
                    {item.impact}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {formatDateLabel(item.publishedDate)} • {item.source.toUpperCase()}
                  </span>
                </div>

                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 block text-sm font-semibold text-zinc-100 transition hover:text-cyan-200"
                >
                  {item.headline}
                </a>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {item.tags.map((tag) => (
                    <span key={`${item.url}-${tag}`} className="rounded-md border border-zinc-700 bg-zinc-900/70 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-300">
                      {tag}
                    </span>
                  ))}
                  <span className="text-[11px] text-zinc-500">Relevance {item.relevanceScore.toFixed(1)}/10</span>
                </div>

                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className={item.impact === 'HIGH' ? 'h-full bg-terminal-red' : item.impact === 'MEDIUM' ? 'h-full bg-terminal-amber' : 'h-full bg-cyan-300'}
                    style={{ width: `${Math.max(8, Math.min(100, item.relevanceScore * 10))}%` }}
                  />
                </div>
              </article>
            ))
          ) : (
            <p className="text-sm text-zinc-500">No news matched this filter. Try refreshing, or broaden source/impact filters.</p>
          )}
        </div>
      </section>

      <p className="text-xs text-zinc-500">
        News is aggregated from multiple public sources, filtered to recent 5-day items, and ranked by usefulness before display.
      </p>
    </section>
  );
}
