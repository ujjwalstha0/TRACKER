import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchIndices, fetchSignal, fetchWatchlist } from '../../lib/api';
import { confidenceBadgeClass, signalBadgeClass, signalLabel } from '../../lib/signal-ui';
import { IndexApiRow, TradingSignalResponse, WatchlistApiRow } from '../../types';

const POLL_INTERVAL = 10_000;
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

function formatSignedPercent(value: number | null): string {
  if (value === null) return '--';
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatNumber(value)}%`;
}

function formatSignedNumber(value: number | null): string {
  if (value === null) return '--';
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatNumber(value)}`;
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
  const [signalsBySymbol, setSignalsBySymbol] = useState<Record<string, TradingSignalResponse>>({});

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
    const names = ['NEPSE Index', 'Sensitive Index', 'Sensitive Float Index', 'HydroPower Index'];
    const matched = names
      .map((name) => indices.find((row) => row.indexName === name))
      .filter((row): row is IndexApiRow => Boolean(row));

    if (matched.length >= 4) {
      return matched.slice(0, 4);
    }

    const extras = indices.filter((row) => !matched.some((picked) => picked.indexName === row.indexName)).slice(0, 4 - matched.length);
    return [...matched, ...extras];
  }, [indices]);

  const groupedIndices = useMemo(() => {
    const sorted = [...indices].sort((a, b) => a.indexName.localeCompare(b.indexName));
    const broad = sorted.filter((row) => {
      const name = row.indexName.toLowerCase();
      return name.includes('nepse') || name.includes('sensitive') || name.includes('float');
    });
    const sectoral = sorted.filter((row) => !broad.some((item) => item.indexName === row.indexName));
    return { broad, sectoral };
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

      const aValue = ((a[sortKey] ?? Number.NEGATIVE_INFINITY) as number);
      const bValue = ((b[sortKey] ?? Number.NEGATIVE_INFINITY) as number);
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

  useEffect(() => {
    if (!currentRows.length) {
      return;
    }

    let active = true;

    Promise.all(
      currentRows.map(async (row) => {
        try {
          const signal = await fetchSignal(row.symbol);
          return [row.symbol, signal] as const;
        } catch {
          return [row.symbol, null] as const;
        }
      }),
    ).then((entries) => {
      if (!active) return;

      setSignalsBySymbol((previous) => {
        const next = { ...previous };
        for (const [symbol, signal] of entries) {
          if (signal) {
            next[symbol] = signal;
          }
        }
        return next;
      });
    });

    return () => {
      active = false;
    };
  }, [currentRows]);

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
                {formatSignedPercent(index.change_pct)}
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
                <th className="px-4 py-3 text-left">Company</th>
                <th className="px-4 py-3 text-right">LTP</th>
                <th className="px-4 py-3 text-right">Change (Pts / %)</th>
                <th className="px-4 py-3 text-center">Signal</th>
                <th className="px-4 py-3 text-right">Volume</th>
                <th className="px-4 py-3 text-right">Turnover</th>
                <th className="px-4 py-3 text-left">Sector</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900/80">
              {currentRows.length ? (
                currentRows.map((row) => {
                  const hasChange = row.change_pct !== null;
                  const up = (row.change_pct ?? 0) >= 0;
                  const signal = signalsBySymbol[row.symbol] ?? null;
                  return (
                    <tr key={row.symbol} className="cursor-pointer hover:bg-zinc-900/80" onClick={() => navigate(`/chart-desk/${row.symbol}`)}>
                      <td className="px-4 py-3 font-mono font-semibold text-white">{row.symbol}</td>
                      <td className="px-4 py-3 text-zinc-300">{row.company ?? 'Profile syncing...'}</td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-200">{formatNumber(row.ltp)}</td>
                      <td
                        className={
                          !hasChange && row.change === null
                            ? 'px-4 py-3 text-right font-mono text-zinc-500'
                            : up
                              ? 'px-4 py-3 text-right font-mono text-terminal-green'
                              : 'px-4 py-3 text-right font-mono text-terminal-red'
                        }
                      >
                        <div className="flex flex-col items-end gap-0.5 leading-tight">
                          <span>{formatSignedNumber(row.change)}</span>
                          <span className="text-[11px] opacity-90">{formatSignedPercent(row.change_pct)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {signal ? (
                          <div className="inline-flex items-center gap-1">
                            <span className={`rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${signalBadgeClass(signal.signal)}`}>
                              {signalLabel(signal.signal, signal.confidence)}
                            </span>
                            <span className={`rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${confidenceBadgeClass(signal.confidence)}`}>
                              {signal.confidence}
                            </span>
                          </div>
                        ) : (
                          <span className="rounded-md border border-gray-500 bg-gray-500/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-300">--</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-300">{row.volume === null ? '--' : formatNumber(row.volume, 0)}</td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-300">{row.turnover === null ? '--' : formatNumber(row.turnover)}</td>
                      <td className="px-4 py-3 text-zinc-400">{row.sector ?? 'Unclassified'}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-zinc-500">
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

        <p className="border-t border-zinc-900 px-4 py-3 text-xs text-zinc-500">
          Signals for analysis only. Not financial advice. Past performance ≠ future results.
        </p>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="terminal-card overflow-hidden">
          <header className="border-b border-zinc-800 px-4 py-3">
            <h2 className="text-base font-semibold text-white">Core Indices</h2>
            <p className="text-xs text-zinc-500">NEPSE, sensitive, and float-sensitive index coverage.</p>
          </header>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-zinc-800 text-sm">
              <thead className="bg-black/40 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3 text-left">Index</th>
                  <th className="px-4 py-3 text-right">Value</th>
                  <th className="px-4 py-3 text-right">Change %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900/80">
                {groupedIndices.broad.length ? (
                  groupedIndices.broad.map((row) => (
                    <tr key={`broad-${row.indexName}`}>
                      <td className="px-4 py-3 text-zinc-300">{row.indexName}</td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-200">{formatNumber(row.value)}</td>
                      <td className={
                        row.change_pct >= 0
                          ? 'px-4 py-3 text-right font-mono text-terminal-green'
                          : 'px-4 py-3 text-right font-mono text-terminal-red'
                      }>
                        {formatSignedPercent(row.change_pct)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-zinc-500">
                      Core index feed not available yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="terminal-card overflow-hidden">
          <header className="border-b border-zinc-800 px-4 py-3">
            <h2 className="text-base font-semibold text-white">Sector-Wise Indices</h2>
            <p className="text-xs text-zinc-500">Banking, hydro, insurance, tourism, manufacturing, and more.</p>
          </header>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-zinc-800 text-sm">
              <thead className="bg-black/40 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3 text-left">Index</th>
                  <th className="px-4 py-3 text-right">Value</th>
                  <th className="px-4 py-3 text-right">Change %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900/80">
                {groupedIndices.sectoral.length ? (
                  groupedIndices.sectoral.map((row) => (
                    <tr key={`sector-${row.indexName}`}>
                      <td className="px-4 py-3 text-zinc-300">{row.indexName}</td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-200">{formatNumber(row.value)}</td>
                      <td className={
                        row.change_pct >= 0
                          ? 'px-4 py-3 text-right font-mono text-terminal-green'
                          : 'px-4 py-3 text-right font-mono text-terminal-red'
                      }>
                        {formatSignedPercent(row.change_pct)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-zinc-500">
                      Sector index feed not available yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </section>
  );
}
