import { useEffect, useMemo, useState } from 'react';
import { fetchSignal, fetchWatchlist } from '../../lib/api';
import { confidenceBadgeClass, signalBadgeClass, signalLabel } from '../../lib/signal-ui';
import { TradingSignalResponse, WatchlistApiRow } from '../../types';

const SIGNAL_POLL_INTERVAL_MS = 20_000;

interface SignalRow {
  symbol: string;
  company: string | null;
  turnover: number | null;
  signal: TradingSignalResponse;
}

export function SignalDashboardTerminalPage() {
  const [buyRows, setBuyRows] = useState<SignalRow[]>([]);
  const [sellRows, setSellRows] = useState<SignalRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let active = true;
    let inFlight = false;

    const load = async () => {
      if (inFlight) {
        return;
      }

      inFlight = true;
      setLoading(true);
      setError('');

      try {
        const watchlist = await fetchWatchlist();
        const universe = [...watchlist]
          .sort((a, b) => (b.turnover ?? 0) - (a.turnover ?? 0))
          .slice(0, 60);

        const resolved = await Promise.all(
          universe.map(async (row) => {
            try {
              const signal = await fetchSignal(row.symbol);
              return {
                symbol: row.symbol,
                company: row.company,
                turnover: row.turnover,
                signal,
              } as SignalRow;
            } catch {
              return null;
            }
          }),
        );

        if (!active) return;

        const rows = resolved.filter((item): item is SignalRow => item !== null);

        const buys = rows
          .filter((row) => row.signal.signal === 'BUY')
          .sort((a, b) => b.signal.strength - a.signal.strength || (b.turnover ?? 0) - (a.turnover ?? 0))
          .slice(0, 5);

        const sells = rows
          .filter((row) => row.signal.signal === 'SELL')
          .sort((a, b) => b.signal.strength - a.signal.strength || (b.turnover ?? 0) - (a.turnover ?? 0))
          .slice(0, 5);

        setBuyRows(buys);
        setSellRows(sells);
      } catch (requestError) {
        if (!active) return;
        setBuyRows([]);
        setSellRows([]);
        setError(requestError instanceof Error ? requestError.message : 'Failed to load signal dashboard.');
      } finally {
        if (!active) return;
        setLoading(false);
        inFlight = false;
      }
    };

    void load();

    const timer = setInterval(() => {
      void load();
    }, SIGNAL_POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [refreshTick]);

  const summary = useMemo(() => {
    return {
      buyCount: buyRows.length,
      sellCount: sellRows.length,
      strongestBuy: buyRows[0]?.signal.strength ?? 0,
      strongestSell: sellRows[0]?.signal.strength ?? 0,
    };
  }, [buyRows, sellRows]);

  return (
    <section className="space-y-5">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Signal Dashboard</p>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-white">Top 5 BUY and SELL Signals</h1>
          <button
            type="button"
            onClick={() => setRefreshTick((value) => value + 1)}
            className="terminal-btn"
            disabled={loading}
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article className="terminal-card p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Top BUY Count</p>
          <p className="mt-3 font-mono text-2xl font-bold text-terminal-green">{summary.buyCount}</p>
        </article>
        <article className="terminal-card p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Top SELL Count</p>
          <p className="mt-3 font-mono text-2xl font-bold text-terminal-red">{summary.sellCount}</p>
        </article>
        <article className="terminal-card p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Strongest BUY</p>
          <p className="mt-3 font-mono text-2xl font-bold text-white">{summary.strongestBuy}</p>
        </article>
        <article className="terminal-card p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Strongest SELL</p>
          <p className="mt-3 font-mono text-2xl font-bold text-white">{summary.strongestSell}</p>
        </article>
      </section>

      {error ? <p className="text-sm font-medium text-terminal-red">{error}</p> : null}
      {loading ? <p className="text-sm text-zinc-500">Refreshing signals...</p> : null}

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="terminal-card overflow-hidden">
          <header className="border-b border-zinc-800 px-4 py-3">
            <h2 className="text-base font-semibold text-terminal-green">Top 5 BUY Signals</h2>
          </header>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-zinc-800 text-sm">
              <thead className="bg-black/40 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3 text-left">Symbol</th>
                  <th className="px-4 py-3 text-left">Signal</th>
                  <th className="px-4 py-3 text-left">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900/80">
                {buyRows.length ? (
                  buyRows.map((row) => (
                    <tr key={`buy-${row.symbol}`}>
                      <td className="px-4 py-3">
                        <p className="font-mono font-semibold text-white">{row.symbol}</p>
                        <p className="text-xs text-zinc-500">{row.company ?? 'Unknown company'}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="inline-flex items-center gap-1">
                          <span className={`rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${signalBadgeClass(row.signal.signal)}`}>
                            {signalLabel(row.signal.signal, row.signal.confidence)}
                          </span>
                          <span className={`rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${confidenceBadgeClass(row.signal.confidence)}`}>
                            {row.signal.confidence}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-zinc-300">{row.signal.reasons[0] ?? 'No clear reason'}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-zinc-500">
                      No BUY signals found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="terminal-card overflow-hidden">
          <header className="border-b border-zinc-800 px-4 py-3">
            <h2 className="text-base font-semibold text-terminal-red">Top 5 SELL Signals</h2>
          </header>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-zinc-800 text-sm">
              <thead className="bg-black/40 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3 text-left">Symbol</th>
                  <th className="px-4 py-3 text-left">Signal</th>
                  <th className="px-4 py-3 text-left">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900/80">
                {sellRows.length ? (
                  sellRows.map((row) => (
                    <tr key={`sell-${row.symbol}`}>
                      <td className="px-4 py-3">
                        <p className="font-mono font-semibold text-white">{row.symbol}</p>
                        <p className="text-xs text-zinc-500">{row.company ?? 'Unknown company'}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="inline-flex items-center gap-1">
                          <span className={`rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${signalBadgeClass(row.signal.signal)}`}>
                            {signalLabel(row.signal.signal, row.signal.confidence)}
                          </span>
                          <span className={`rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${confidenceBadgeClass(row.signal.confidence)}`}>
                            {row.signal.confidence}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-zinc-300">{row.signal.reasons[0] ?? 'No clear reason'}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-zinc-500">
                      No SELL signals found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <p className="text-xs text-zinc-500">
        Signals for analysis only. Not financial advice. Past performance ≠ future results.
      </p>
    </section>
  );
}
