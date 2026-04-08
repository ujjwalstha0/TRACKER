import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchIndices, fetchWatchlist } from '../../lib/api';
import { IndexApiRow, WatchlistApiRow } from '../../types';

const POLL_INTERVAL = 30_000;
const PAGE_SIZE = 20;

type SortKey = 'symbol' | 'ltp' | 'change_pct' | 'volume' | 'turnover';
type SortDirection = 'asc' | 'desc';

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
  const [sortKey, setSortKey] = useState<SortKey>('turnover');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [page, setPage] = useState(1);
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

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();

    const filtered = [...watchlist].filter((row) => {
      if (!query) return true;
      return (
        row.symbol.toLowerCase().includes(query) ||
        (row.company ?? '').toLowerCase().includes(query) ||
        (row.sector ?? '').toLowerCase().includes(query)
      );
    });

    const sorted = filtered.sort((a, b) => {
      if (sortKey === 'symbol') {
        const compare = a.symbol.localeCompare(b.symbol);
        return sortDirection === 'asc' ? compare : -compare;
      }

      const aValue = (a[sortKey] ?? 0) as number;
      const bValue = (b[sortKey] ?? 0) as number;
      const diff = aValue - bValue;
      return sortDirection === 'asc' ? diff : -diff;
    });

    return sorted;
  }, [search, sortDirection, sortKey, watchlist]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));

  useEffect(() => {
    setPage(1);
  }, [search, sortDirection, sortKey]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const currentRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredRows.slice(start, start + PAGE_SIZE);
  }, [filteredRows, page]);

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

          <select
            value={sortKey}
            onChange={(event) => setSortKey(event.target.value as SortKey)}
            className="terminal-input max-w-[170px]"
          >
            <option value="turnover">Sort: Turnover</option>
            <option value="ltp">Sort: Price</option>
            <option value="change_pct">Sort: Point/% Change</option>
            <option value="volume">Sort: Volume</option>
            <option value="symbol">Sort: Symbol</option>
          </select>

          <button
            type="button"
            onClick={() => setSortDirection((old) => (old === 'asc' ? 'desc' : 'asc'))}
            className="terminal-btn"
          >
            {sortDirection === 'asc' ? 'Ascending' : 'Descending'}
          </button>

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
                <th className="px-4 py-3 text-right">Volume</th>
                <th className="px-4 py-3 text-right">Turnover</th>
                <th className="px-4 py-3 text-left">Sector</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900/80">
              {currentRows.length ? (
                currentRows.map((row) => {
                  const up = (row.change_pct ?? 0) >= 0;
                  return (
                    <tr key={row.symbol} className="cursor-pointer hover:bg-zinc-900/80" onClick={() => navigate(`/chart-desk/${row.symbol}`)}>
                      <td className="px-4 py-3 font-mono font-semibold text-white">{row.symbol}</td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-200">{formatNumber(row.ltp)}</td>
                      <td className={up ? 'px-4 py-3 text-right font-mono text-terminal-green' : 'px-4 py-3 text-right font-mono text-terminal-red'}>
                        {up ? '+' : ''}
                        {formatNumber(row.change_pct)}%
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-300">{formatNumber(row.volume, 0)}</td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-300">{formatNumber(row.turnover)}</td>
                      <td className="px-4 py-3 text-zinc-400">{row.sector ?? 'N/A'}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                    No rows found for the current filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <footer className="flex items-center justify-between border-t border-zinc-800 px-4 py-3 text-sm">
          <p className="text-zinc-400">
            Showing {currentRows.length} of {filteredRows.length} companies
          </p>
          <div className="flex items-center gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage((old) => Math.max(1, old - 1))} className="terminal-btn disabled:opacity-50">
              Prev
            </button>
            <span className="font-mono text-zinc-300">
              Page {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((old) => Math.min(totalPages, old + 1))}
              className="terminal-btn disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </footer>
      </section>
    </section>
  );
}
