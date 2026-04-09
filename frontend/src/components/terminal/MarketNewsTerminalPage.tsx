import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchEconomicNews } from '../../lib/api';
import { EconomicNewsItem, EconomicNewsResponse, NewsImpactLevel } from '../../types';

const NEWS_REFRESH_INTERVAL_MS = 120_000;

type ImpactFilter = 'ALL' | NewsImpactLevel;

function impactClass(impact: NewsImpactLevel): string {
  if (impact === 'HIGH') return 'border-terminal-red/70 bg-terminal-red/20 text-terminal-red';
  if (impact === 'MEDIUM') return 'border-terminal-amber/70 bg-terminal-amber/20 text-terminal-amber';
  return 'border-cyan-400/70 bg-cyan-500/15 text-cyan-200';
}

export function MarketNewsTerminalPage() {
  const [payload, setPayload] = useState<EconomicNewsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [impactFilter, setImpactFilter] = useState<ImpactFilter>('ALL');

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
    if (impactFilter === 'ALL') return allItems;
    return allItems.filter((item) => item.impact === impactFilter);
  }, [impactFilter, payload?.items]);

  const stats = useMemo(() => {
    const allItems = payload?.items ?? [];
    return {
      total: allItems.length,
      high: allItems.filter((item) => item.impact === 'HIGH').length,
      medium: allItems.filter((item) => item.impact === 'MEDIUM').length,
      low: allItems.filter((item) => item.impact === 'LOW').length,
    };
  }, [payload?.items]);

  return (
    <section className="space-y-5">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Macro & Market Monitor</p>
        <h1 className="text-2xl font-semibold text-white">Economy News Impact Desk</h1>
        <p className="text-sm text-zinc-400">
          Curated economy and policy headlines that can influence NEPSE sentiment, liquidity, and sector rotation.
        </p>
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

      <section className="terminal-card overflow-hidden">
        <header className="flex flex-wrap items-center gap-3 border-b border-zinc-800 p-4">
          <h2 className="text-base font-semibold text-white">Economy News Feed</h2>

          <select
            value={impactFilter}
            onChange={(event) => setImpactFilter(event.target.value as ImpactFilter)}
            className="terminal-input ml-auto max-w-[180px]"
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
              <article key={`${item.url}-${index}`} className="rounded-xl border border-zinc-800 bg-zinc-950/75 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${impactClass(item.impact)}`}>
                    {item.impact}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {item.publishedDate ?? 'Date unavailable'} • {item.source}
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
                  <span className="text-[11px] text-zinc-500">Relevance {item.relevanceScore}/10</span>
                </div>
              </article>
            ))
          ) : (
            <p className="text-sm text-zinc-500">No news matched this filter. Try refreshing or selecting another impact level.</p>
          )}
        </div>
      </section>

      <p className="text-xs text-zinc-500">
        News is aggregated from public headlines and auto-classified by market-impact keywords. Always verify source context before trading decisions.
      </p>
    </section>
  );
}
