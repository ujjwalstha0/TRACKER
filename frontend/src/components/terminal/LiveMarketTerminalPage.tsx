import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchIndices, fetchWatchlist } from '../../lib/api';
import { IndexApiRow, WatchlistApiRow } from '../../types';

const POLL_INTERVAL = 30_000;

function formatNumber(value: number | null, digits = 2): string {
  if (value === null) return '-';

  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function LiveMarketTerminalPage() {
  const navigate = useNavigate();

  const [indices, setIndices] = useState<IndexApiRow[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistApiRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);

    try {
      const [indicesRows, watchlistRows] = await Promise.all([fetchIndices(), fetchWatchlist()]);
      setIndices(indicesRows);
      setWatchlist(watchlistRows);
      setError('');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load market feed.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();

    const timer = setInterval(() => {
      void loadData();
    }, POLL_INTERVAL);

    return () => clearInterval(timer);
  }, [loadData]);

  const focusIndices = useMemo(() => {
    const names = ['NEPSE Index', 'Banking SubIndex', 'HydroPower Index', 'Mutual Fund'];
    const matched = names
      .map((name) => indices.find((row) => row.indexName === name))
      .filter((row): row is IndexApiRow => Boolean(row));

    if (matched.length >= 4) {
      return matched.slice(0, 4);
    }

    const extras = indices.filter((row) => !matched.some((picked) => picked.indexName === row.indexName)).slice(0, 4 - matched.length);
    return [...matched, ...extras];
  }, [indices]);

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();

    return [...watchlist]
      .filter((row) => {
        if (!query) return true;
        return (
          row.symbol.toLowerCase().includes(query) ||
          (row.company ?? '').toLowerCase().includes(query) ||
          (row.sector ?? '').toLowerCase().includes(query)
        );
      })
      .sort((a, b) => (b.turnover ?? 0) - (a.turnover ?? 0));
  }, [search, watchlist]);

  return (
    <section className="space-y-5">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Market Pulse</p>
        <h1 className="text-2xl font-semibold text-white">Live Market</h1>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {focusIndices.map((index) => {
          const up = index.change_pct >= 0;
          return (
            <article key={index.indexName} className="terminal-card p-4">
              <p className="text-xs uppercase tracking-wide text-zinc-500">{index.indexName}</p>
              <p className="mt-3 text-2xl font-bold text-white font-mono">₹ {formatNumber(index.value)}</p>
              <p className={up ? 'mt-2 font-mono text-sm text-terminal-green' : 'mt-2 font-mono text-sm text-terminal-red'}>
                {up ? '+' : ''}
                {formatNumber(index.change_pct)}%
              </p>
            </article>
          );
        })}
      </section>

      <section className="terminal-card overflow-hidden">
        <header className="flex flex-wrap items-center gap-3 border-b border-zinc-800 p-4">
          <h2 className="text-base font-semibold text-white">Watchlist</h2>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="terminal-input ml-auto max-w-xs"
            placeholder="Search symbol or company"
          />
          <button type="button" onClick={() => void loadData()} className="terminal-btn">
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </header>

        {error ? <p className="border-b border-zinc-800 px-4 py-3 text-sm text-terminal-red">{error}</p> : null}

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-800 text-sm">
            <thead className="bg-black/40 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3 text-left">Symbol</th>
                <th className="px-4 py-3 text-right">LTP</th>
                <th className="px-4 py-3 text-right">Change %</th>
                <th className="px-4 py-3 text-left">Sector</th>
                <th className="px-4 py-3 text-right">Turnover</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900/80">
              {rows.length ? (
                rows.map((row) => {
                  const up = (row.change_pct ?? 0) >= 0;
                  return (
                    <tr key={row.symbol} className="cursor-pointer hover:bg-zinc-900/80" onClick={() => navigate(`/chart-desk/${row.symbol}`)}>
                      <td className="px-4 py-3 font-mono font-semibold text-white">{row.symbol}</td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-200">{formatNumber(row.ltp)}</td>
                      <td className={up ? 'px-4 py-3 text-right font-mono text-terminal-green' : 'px-4 py-3 text-right font-mono text-terminal-red'}>
                        {up ? '+' : ''}
                        {formatNumber(row.change_pct)}%
                      </td>
                      <td className="px-4 py-3 text-zinc-400">{row.sector ?? 'N/A'}</td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-300">{formatNumber(row.turnover)}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                    No rows found for the current filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
