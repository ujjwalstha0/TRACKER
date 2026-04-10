import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchEconomicNews, fetchNepalLivePrices } from '../../lib/api';
import {
  EconomicNewsItem,
  EconomicNewsResponse,
  NewsImpactLevel,
  NewsImpactScope,
  NepalLivePriceItem,
  NepalLivePricesResponse,
  NewsSentiment,
} from '../../types';

const NEWS_REFRESH_INTERVAL_MS = 120_000;

type ImpactFilter = 'ALL' | NewsImpactLevel;
type SentimentFilter = 'ALL' | NewsSentiment;

function impactClass(impact: NewsImpactLevel): string {
  if (impact === 'HIGH') return 'border-terminal-red/70 bg-terminal-red/20 text-terminal-red';
  if (impact === 'MEDIUM') return 'border-terminal-amber/70 bg-terminal-amber/20 text-terminal-amber';
  return 'border-cyan-400/70 bg-cyan-500/15 text-cyan-200';
}

function sentimentClass(sentiment: NewsSentiment): string {
  if (sentiment === 'POSITIVE') return 'border-terminal-green/70 bg-terminal-green/15 text-terminal-green';
  if (sentiment === 'NEGATIVE') return 'border-terminal-red/70 bg-terminal-red/20 text-terminal-red';
  return 'border-zinc-600/80 bg-zinc-900/70 text-zinc-200';
}

function scopeClass(scope: NewsImpactScope): string {
  if (scope === 'MARKET') return 'border-cyan-400/70 bg-cyan-500/15 text-cyan-200';
  if (scope === 'MACRO') return 'border-purple-400/70 bg-purple-500/15 text-purple-200';
  if (scope === 'SECTOR') return 'border-terminal-amber/70 bg-terminal-amber/20 text-terminal-amber';
  return 'border-zinc-600/80 bg-zinc-900/70 text-zinc-200';
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

function formatNprValue(value: number | null, fractionDigits: number): string {
  if (value === null) return '-';
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

function fallbackSummary(item: EconomicNewsItem): string {
  const topic = item.tags[0] ?? 'market context';
  return `This headline points to ${topic.toLowerCase()} developments that can influence near-term NEPSE sentiment and position sizing. ${item.marketEffect}`;
}

function truncateSummary(value: string, expanded: boolean): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (expanded || normalized.length <= 260) {
    return normalized;
  }

  return `${normalized.slice(0, 260).trimEnd()}...`;
}

export function MarketNewsTerminalPage() {
  const [payload, setPayload] = useState<EconomicNewsResponse | null>(null);
  const [livePrices, setLivePrices] = useState<NepalLivePricesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [impactFilter, setImpactFilter] = useState<ImpactFilter>('ALL');
  const [sentimentFilter, setSentimentFilter] = useState<SentimentFilter>('ALL');
  const [sourceFilter, setSourceFilter] = useState<string>('ALL');
  const [query, setQuery] = useState('');
  const [expandedSummaries, setExpandedSummaries] = useState<Record<string, boolean>>({});

  const loadNews = useCallback(async () => {
    setLoading(true);

    try {
      const [newsResponse, pricesResponse] = await Promise.all([
        fetchEconomicNews(40),
        fetchNepalLivePrices(),
      ]);

      setPayload(newsResponse);
      setLivePrices(pricesResponse);
      setExpandedSummaries({});
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
      if (sentimentFilter !== 'ALL' && item.sentiment !== sentimentFilter) return false;
      if (sourceFilter !== 'ALL' && item.source !== sourceFilter) return false;

      if (!query.trim()) return true;
      const needle = query.trim().toLowerCase();
      return (
        item.headline.toLowerCase().includes(needle) ||
        item.summary.toLowerCase().includes(needle) ||
        item.tags.some((tag) => tag.toLowerCase().includes(needle))
      );
    });
  }, [impactFilter, payload?.items, query, sentimentFilter, sourceFilter]);

  const stats = useMemo(() => {
    const allItems = payload?.items ?? [];
    return {
      total: allItems.length,
      high: allItems.filter((item) => item.impact === 'HIGH').length,
      medium: allItems.filter((item) => item.impact === 'MEDIUM').length,
      low: allItems.filter((item) => item.impact === 'LOW').length,
      positive: allItems.filter((item) => item.sentiment === 'POSITIVE').length,
      negative: allItems.filter((item) => item.sentiment === 'NEGATIVE').length,
      neutral: allItems.filter((item) => item.sentiment === 'NEUTRAL').length,
      marketWide: allItems.filter((item) => item.impactScope === 'MARKET' || item.impactScope === 'MACRO').length,
      companySpecific: allItems.filter((item) => item.impactScope === 'COMPANY').length,
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

  const sourceHighlights = useMemo(() => {
    const top = sourceStats.slice(0, 5);
    const maxCount = top.length ? Math.max(...top.map((item) => item.count)) : 1;

    return top.map((item) => ({
      ...item,
      barWidth: Math.max(12, Math.round((item.count / maxCount) * 100)),
    }));
  }, [sourceStats]);

  const fiveDayPulse = useMemo(() => {
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

    return [...pointMap.entries()].map(([date, count]) => ({
      date,
      count,
      label: formatDateLabel(date),
    }));
  }, [payload?.asOf, payload?.items]);

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

  const livePriceMap = useMemo(() => {
    const map = new Map<NepalLivePriceItem['key'], NepalLivePriceItem>();
    for (const item of livePrices?.items ?? []) {
      map.set(item.key, item);
    }
    return map;
  }, [livePrices?.items]);

  const livePriceCards = useMemo(
    () => [
      {
        key: 'GOLD' as const,
        title: 'Gold',
        unit: 'per tola',
        value: livePriceMap.get('GOLD')?.value ?? null,
        decimals: 0,
        accent: 'text-amber-200',
      },
      {
        key: 'SILVER' as const,
        title: 'Silver',
        unit: 'per tola',
        value: livePriceMap.get('SILVER')?.value ?? null,
        decimals: 2,
        accent: 'text-zinc-100',
      },
      {
        key: 'PETROL' as const,
        title: 'Petrol',
        unit: 'per litre',
        value: livePriceMap.get('PETROL')?.value ?? null,
        decimals: 2,
        accent: 'text-terminal-red',
      },
      {
        key: 'DIESEL' as const,
        title: 'Diesel',
        unit: 'per litre',
        value: livePriceMap.get('DIESEL')?.value ?? null,
        decimals: 2,
        accent: 'text-cyan-200',
      },
    ],
    [livePriceMap],
  );

  const newestHeadline = filteredItems[0] ?? null;
  const isInitialLoad = loading && !payload;
  const hasActiveFilters =
    impactFilter !== 'ALL' ||
    sentimentFilter !== 'ALL' ||
    sourceFilter !== 'ALL' ||
    query.trim().length > 0;

  return (
    <section className="space-y-5">
      <header className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-[radial-gradient(circle_at_20%_20%,rgba(34,211,238,0.18),transparent_35%),radial-gradient(circle_at_80%_0%,rgba(245,158,11,0.16),transparent_28%),#09090b] p-6">
        <div className="absolute -right-10 top-0 h-36 w-36 rounded-full bg-terminal-red/10 blur-3xl" />
        <div className="absolute left-1/3 top-0 h-28 w-28 rounded-full bg-cyan-400/15 blur-3xl" />
        <div className="relative space-y-2">
          <p className="text-xs uppercase tracking-[0.22em] text-zinc-400">Macro & Market Monitor</p>
          <h1 className="text-3xl font-semibold tracking-tight text-white">Economy News Impact Desk</h1>
          <p className="max-w-3xl text-sm text-zinc-300">
            Summary-first macro feed built for faster decisions across multiple platforms. Headlines stay in-app with clear context, sentiment cues, and market/company impact signals before you choose to open any source.
          </p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
            <span className="rounded-full border border-zinc-700 bg-zinc-900/70 px-3 py-1">As of {formatDateLabel(payload?.asOf ?? null)} ({formatRelativeTime(payload?.asOf ?? null)})</span>
            <span className="rounded-full border border-zinc-700 bg-zinc-900/70 px-3 py-1">Source Mode: {payload?.source ?? 'multi-source'}</span>
          </div>
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {livePriceCards.map((card) => {
          const source = livePriceMap.get(card.key)?.source ?? '--';
          const asOf = livePriceMap.get(card.key)?.asOf ?? livePrices?.asOf ?? null;

          return (
            <article key={card.key} className="terminal-card p-4">
              <p className="text-xs uppercase tracking-wide text-zinc-500">{card.title}</p>
              <p className={`mt-2 font-mono text-2xl font-bold ${card.accent}`}>
                NPR {formatNprValue(card.value, card.decimals)}
              </p>
              <p className="mt-1 text-xs text-zinc-500">{card.unit}</p>
              <p className="mt-1 text-[11px] text-zinc-600">{source} • {formatRelativeTime(asOf)}</p>
            </article>
          );
        })}
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        {isInitialLoad ? (
          Array.from({ length: 4 }).map((_, index) => (
            <article key={`news-stat-skeleton-${index}`} className="terminal-card p-4">
              <div className="skeleton-block h-3 w-24" />
              <div className="skeleton-block mt-3 h-7 w-20" />
            </article>
          ))
        ) : (
          <>
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
          </>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-5">
        <article className="terminal-card p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Positive Signal</p>
          <p className="mt-2 font-mono text-2xl font-bold text-terminal-green">{stats.positive}</p>
        </article>
        <article className="terminal-card p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Negative Signal</p>
          <p className="mt-2 font-mono text-2xl font-bold text-terminal-red">{stats.negative}</p>
        </article>
        <article className="terminal-card p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Neutral Signal</p>
          <p className="mt-2 font-mono text-2xl font-bold text-zinc-200">{stats.neutral}</p>
        </article>
        <article className="terminal-card p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Market/Macro Scope</p>
          <p className="mt-2 font-mono text-2xl font-bold text-cyan-200">{stats.marketWide}</p>
        </article>
        <article className="terminal-card p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Company Scope</p>
          <p className="mt-2 font-mono text-2xl font-bold text-zinc-100">{stats.companySpecific}</p>
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <article className="terminal-card p-4 sm:p-5">
          <header>
            <h2 className="text-sm font-semibold text-white">Source Pulse</h2>
            <p className="mt-1 text-xs text-zinc-500">Top publishers contributing useful market context today</p>
          </header>

          <div className="mt-4 space-y-2">
            {isInitialLoad ? (
              Array.from({ length: 4 }).map((_, index) => (
                <div key={`source-skeleton-${index}`} className="rounded-lg border border-zinc-800/90 bg-zinc-950/75 p-3">
                  <div className="skeleton-block h-3 w-20" />
                  <div className="skeleton-block mt-2 h-2 w-full" />
                </div>
              ))
            ) : sourceHighlights.length ? (
              sourceHighlights.map((item) => (
                <div key={item.source} className="rounded-lg border border-zinc-800/90 bg-zinc-950/75 p-3">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="font-medium uppercase tracking-wide text-zinc-300">{item.source}</span>
                    <span className="font-mono text-zinc-400">{item.count}</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,rgba(34,211,238,0.9),rgba(59,130,246,0.8))]"
                      style={{ width: `${item.barWidth}%` }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-zinc-500">Source data will appear as soon as headlines are loaded.</p>
            )}
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-5">
            {isInitialLoad
              ? Array.from({ length: 5 }).map((_, index) => (
                  <div key={`pulse-skeleton-${index}`} className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-2 py-2 text-center">
                    <div className="skeleton-block mx-auto h-3 w-14" />
                    <div className="skeleton-block mx-auto mt-2 h-3 w-8" />
                  </div>
                ))
              : fiveDayPulse.map((point) => (
                  <div key={point.date} className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-2 py-2 text-center">
                    <p className="text-[11px] text-zinc-500">{point.label}</p>
                    <p className="mt-1 font-mono text-sm text-zinc-200">{point.count}</p>
                  </div>
                ))}
          </div>
        </article>

        <article className="terminal-card p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-white">Top Themes</h2>
          <div className="mt-3 space-y-2">
            {isInitialLoad ? (
              Array.from({ length: 5 }).map((_, index) => (
                <div key={`tag-skeleton-${index}`} className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                  <div className="skeleton-block h-3 w-28" />
                  <div className="skeleton-block mt-2 h-5 w-10" />
                </div>
              ))
            ) : topTags.length ? (
              topTags.map((item) => (
                <div key={item.tag} className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">{item.tag}</p>
                  <p className="mt-1 font-mono text-lg font-semibold text-cyan-200">{item.count}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-zinc-500">No tags detected yet.</p>
            )}
          </div>
        </article>
      </section>

      <section className="terminal-card overflow-hidden">
        <header className="flex flex-wrap items-center gap-3 border-b border-zinc-800 p-4">
          <h2 className="text-base font-semibold text-white">Economy News Feed (Summary First)</h2>

          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="terminal-input ml-auto max-w-[220px]"
            placeholder="Search theme, summary, headline"
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

          <select
            value={sentimentFilter}
            onChange={(event) => setSentimentFilter(event.target.value as SentimentFilter)}
            className="terminal-input max-w-[180px]"
          >
            <option value="ALL">All Sentiments</option>
            <option value="POSITIVE">Positive</option>
            <option value="NEGATIVE">Negative</option>
            <option value="NEUTRAL">Neutral</option>
          </select>

          <button type="button" onClick={() => void loadNews()} className="terminal-btn">
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </header>

        {error ? <p className="border-b border-zinc-800 px-4 py-3 text-sm text-terminal-red">{error}</p> : null}

        {newestHeadline ? (
          <div className="border-b border-zinc-800 bg-zinc-900/45 px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Latest Alert</p>
            <p className="mt-1 text-sm text-zinc-200">{newestHeadline.headline}</p>
          </div>
        ) : null}

        <div className="max-h-[620px] space-y-3 overflow-y-auto p-4">
          {isInitialLoad ? (
            Array.from({ length: 5 }).map((_, index) => (
              <article key={`news-item-skeleton-${index}`} className="rounded-xl border border-zinc-800 bg-zinc-950/75 p-4">
                <div className="skeleton-block h-3 w-40" />
                <div className="skeleton-block mt-3 h-4 w-11/12" />
                <div className="skeleton-block mt-2 h-3 w-full" />
                <div className="skeleton-block mt-2 h-3 w-10/12" />
                <div className="skeleton-block mt-4 h-2 w-full" />
              </article>
            ))
          ) : filteredItems.length ? (
            filteredItems.map((item: EconomicNewsItem, index) => {
              const key = `${item.url}-${index}`;
              const expanded = !!expandedSummaries[key];
              const summary = item.summary || fallbackSummary(item);
              const canExpand = summary.trim().length > 260;

              return (
                <article key={key} className="rounded-xl border border-zinc-800 bg-zinc-950/75 p-4 transition hover:border-zinc-700 hover:bg-zinc-950/95">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${impactClass(item.impact)}`}>
                      {item.impact}
                    </span>
                    <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${sentimentClass(item.sentiment)}`}>
                      {item.sentiment}
                    </span>
                    <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${scopeClass(item.impactScope)}`}>
                      {item.impactScope === 'MARKET' ? 'MARKET WIDE' : item.impactScope}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {formatDateLabel(item.publishedDate)} • {item.source.toUpperCase()}
                    </span>
                  </div>

                  <p className="mt-2 text-sm font-semibold text-zinc-100">{item.headline}</p>

                  <p className="mt-2 text-sm leading-relaxed text-zinc-300">{truncateSummary(summary, expanded)}</p>

                  <p className="mt-2 text-xs text-zinc-400">Market effect: {item.marketEffect}</p>

                  {item.affectedSymbols.length || item.affectedSectors.length ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                      <span className="uppercase tracking-wide">Affects:</span>
                      {item.affectedSymbols.map((symbol) => (
                        <span
                          key={`${item.url}-${symbol}`}
                          className="rounded-md border border-zinc-700 bg-zinc-900/70 px-2 py-0.5 font-mono text-zinc-300"
                        >
                          {symbol}
                        </span>
                      ))}
                      {item.affectedSectors.map((sector) => (
                        <span
                          key={`${item.url}-${sector}`}
                          className="rounded-md border border-zinc-700 bg-zinc-900/70 px-2 py-0.5 text-zinc-300"
                        >
                          {sector}
                        </span>
                      ))}
                    </div>
                  ) : null}

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

                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    {canExpand ? (
                      <button
                        type="button"
                        className="terminal-btn text-xs"
                        onClick={() =>
                          setExpandedSummaries((prev) => ({
                            ...prev,
                            [key]: !expanded,
                          }))
                        }
                      >
                        {expanded ? 'Show Less Summary' : 'Read Full Summary'}
                      </button>
                    ) : null}

                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="terminal-btn text-xs"
                    >
                      Open Source
                    </a>
                  </div>
                </article>
              );
            })
          ) : (
            <div className="empty-state">
              <p className="empty-state-title">No news matched this view.</p>
              <p className="empty-state-hint">Adjust filters or refresh to pull the latest macro headlines.</p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                {hasActiveFilters ? (
                  <button
                    type="button"
                    className="terminal-btn text-xs"
                    onClick={() => {
                      setImpactFilter('ALL');
                      setSentimentFilter('ALL');
                      setSourceFilter('ALL');
                      setQuery('');
                    }}
                  >
                    Clear Filters
                  </button>
                ) : null}
                <button type="button" className="terminal-btn text-xs" onClick={() => void loadNews()}>
                  Refresh Feed
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      <p className="text-xs text-zinc-500">
        News is aggregated from public sources, filtered to recent 5-day items, and summarized in-platform so you can understand impact before deciding to open the source.
      </p>
    </section>
  );
}