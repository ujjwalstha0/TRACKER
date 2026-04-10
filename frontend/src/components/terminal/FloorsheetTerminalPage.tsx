import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchFloorsheetDesk, fetchFloorsheetSymbol } from '../../lib/api';
import {
  FloorsheetAlertSeverity,
  FloorsheetDeskResponse,
  FloorsheetPressureLabel,
  FloorsheetSymbolResponse,
} from '../../types';

const DESK_REFRESH_MS = 45_000;
const DETAIL_REFRESH_MS = 30_000;

function formatNumber(value: number | null, digits = 2): string {
  if (value === null) return '-';

  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatInteger(value: number | null): string {
  if (value === null) return '-';

  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 0,
  }).format(value);
}

function pressureClass(label: FloorsheetPressureLabel): string {
  if (label === 'ACCUMULATION') {
    return 'border-terminal-green/70 bg-terminal-green/15 text-terminal-green';
  }

  if (label === 'DISTRIBUTION') {
    return 'border-terminal-red/70 bg-terminal-red/15 text-terminal-red';
  }

  return 'border-terminal-amber/70 bg-terminal-amber/15 text-terminal-amber';
}

function severityClass(severity: FloorsheetAlertSeverity): string {
  if (severity === 'HIGH') {
    return 'border-terminal-red/70 bg-terminal-red/20 text-terminal-red';
  }

  if (severity === 'MEDIUM') {
    return 'border-terminal-amber/70 bg-terminal-amber/20 text-terminal-amber';
  }

  return 'border-cyan-400/70 bg-cyan-500/15 text-cyan-100';
}

function formatRelativeAge(iso: string | null): string {
  if (!iso) return 'awaiting source timestamp';

  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return 'timestamp unavailable';

  const diffMinutes = Math.floor((Date.now() - parsed) / (1000 * 60));
  if (diffMinutes <= 0) return 'just updated';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  return `${diffHours}h ago`;
}

export function FloorsheetTerminalPage() {
  const [desk, setDesk] = useState<FloorsheetDeskResponse | null>(null);
  const [detail, setDetail] = useState<FloorsheetSymbolResponse | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [rows, setRows] = useState(120);
  const [buyerInput, setBuyerInput] = useState('');
  const [sellerInput, setSellerInput] = useState('');
  const [appliedBuyer, setAppliedBuyer] = useState('');
  const [appliedSeller, setAppliedSeller] = useState('');
  const [loadingDesk, setLoadingDesk] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);

  const loadDesk = useCallback(async () => {
    setLoadingDesk(true);

    try {
      const payload = await fetchFloorsheetDesk({ symbols: 8, rows: 90 });
      setDesk(payload);
      setError('');
      setLastUpdatedAt(new Date().toISOString());
      setSelectedSymbol((previous) => {
        if (previous && payload.symbols.some((row) => row.symbol === previous)) {
          return previous;
        }

        return payload.symbols[0]?.symbol ?? '';
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load floorsheet desk.');
    } finally {
      setLoadingDesk(false);
    }
  }, []);

  const loadDetail = useCallback(async () => {
    if (!selectedSymbol) {
      setDetail(null);
      return;
    }

    setLoadingDetail(true);

    try {
      const payload = await fetchFloorsheetSymbol(selectedSymbol, {
        rows,
        buyer: appliedBuyer || undefined,
        seller: appliedSeller || undefined,
      });
      setDetail(payload);
      setError('');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load symbol floorsheet.');
      setDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  }, [appliedBuyer, appliedSeller, rows, selectedSymbol]);

  useEffect(() => {
    void loadDesk();

    const timer = setInterval(() => {
      void loadDesk();
    }, DESK_REFRESH_MS);

    return () => clearInterval(timer);
  }, [loadDesk]);

  useEffect(() => {
    void loadDetail();

    const timer = setInterval(() => {
      void loadDetail();
    }, DETAIL_REFRESH_MS);

    return () => clearInterval(timer);
  }, [loadDetail]);

  const selectedInsight = useMemo(() => {
    if (detail?.insight) {
      return detail.insight;
    }

    return desk?.symbols.find((row) => row.symbol === selectedSymbol) ?? null;
  }, [desk?.symbols, detail?.insight, selectedSymbol]);

  const mustWatchAlerts = useMemo(() => (desk?.alerts ?? []).slice(0, 6), [desk?.alerts]);

  const entry = selectedInsight?.weightedAvgRate ?? 0;
  const suggestedSide = selectedInsight?.pressure.label === 'DISTRIBUTION' ? 'sell' : 'buy';
  const target = entry > 0 ? (suggestedSide === 'buy' ? entry * 1.06 : entry * 0.94) : 0;
  const stop = entry > 0 ? (suggestedSide === 'buy' ? entry * 0.97 : entry * 1.03) : 0;

  const executionHref = useMemo(() => {
    if (!selectedSymbol) {
      return '/execution';
    }

    if (entry <= 0 || target <= 0 || stop <= 0) {
      return `/execution?symbol=${encodeURIComponent(selectedSymbol)}&side=${suggestedSide}`;
    }

    return `/execution?symbol=${encodeURIComponent(selectedSymbol)}&side=${suggestedSide}&entry=${encodeURIComponent(
      entry.toFixed(2),
    )}&stop=${encodeURIComponent(stop.toFixed(2))}&target=${encodeURIComponent(target.toFixed(2))}`;
  }, [entry, selectedSymbol, stop, suggestedSide, target]);

  return (
    <section className="space-y-5">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-[0.22em] text-cyan-300/80">Trading Microstructure</p>
        <h1 className="text-2xl font-semibold text-white sm:text-3xl">NEPSE Floorsheet Lab</h1>
        <p className="text-sm text-zinc-400">
          Full utilization of floorsheet flow: broker inventory transfer, block print detection, concentration risk, and symbol-by-symbol tape intelligence.
        </p>
      </header>

      <section className="terminal-card overflow-hidden">
        <div className="relative">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_10%,rgba(34,211,238,0.2),transparent_35%),radial-gradient(circle_at_86%_8%,rgba(248,113,113,0.2),transparent_30%)]" />
          <div className="relative grid gap-4 p-4 sm:p-5 lg:grid-cols-[1.1fr_0.9fr]">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md border border-cyan-400/70 bg-cyan-500/15 px-3 py-1 text-xs font-semibold tracking-wide text-cyan-100">
                  Source: {desk?.source ?? 'sharesansar'}
                </span>
                <span className="rounded-md border border-zinc-700/80 bg-zinc-900/60 px-3 py-1 text-xs text-zinc-300">
                  Updated {formatRelativeAge(lastUpdatedAt)}
                </span>
              </div>

              <p className="mt-4 text-sm text-zinc-300">
                The desk scans top active symbols, then ranks must-watch broker behavior before you place a trade.
              </p>

              {error ? <p className="mt-3 text-sm font-medium text-terminal-red">{error}</p> : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <article className="rounded-xl border border-zinc-700/80 bg-zinc-950/70 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500">Scanned Symbols</p>
                <p className="mt-2 font-mono text-2xl font-bold text-white">{desk?.scannedSymbols ?? 0}</p>
              </article>

              <article className="rounded-xl border border-zinc-700/80 bg-zinc-950/70 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500">Must-Watch Alerts</p>
                <p className="mt-2 font-mono text-2xl font-bold text-terminal-amber">{mustWatchAlerts.length}</p>
              </article>

              <article className="rounded-xl border border-zinc-700/80 bg-zinc-950/70 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500">Selected Symbol</p>
                <p className="mt-2 font-mono text-2xl font-bold text-cyan-200">{selectedSymbol || '--'}</p>
              </article>

              <article className="rounded-xl border border-zinc-700/80 bg-zinc-950/70 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500">Pressure</p>
                <p className="mt-2 text-sm font-semibold text-zinc-100">
                  {selectedInsight ? selectedInsight.pressure.label.replace('_', ' ') : 'NO SIGNAL'}
                </p>
              </article>
            </div>
          </div>
        </div>
      </section>

      <section className="terminal-card p-4 sm:p-5">
        <header className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-white">Filters and Controls</h2>
          <button type="button" onClick={() => void loadDesk()} className="terminal-btn ml-auto text-xs">
            {loadingDesk ? 'Refreshing...' : 'Refresh Desk'}
          </button>
          <button type="button" onClick={() => void loadDetail()} className="terminal-btn text-xs">
            {loadingDetail ? 'Refreshing...' : 'Refresh Symbol'}
          </button>
        </header>

        <div className="mt-4 grid gap-3 md:grid-cols-5">
          <label className="md:col-span-1">
            <span className="mb-1 block text-xs uppercase tracking-wide text-zinc-500">Symbol</span>
            <select
              value={selectedSymbol}
              onChange={(event) => setSelectedSymbol(event.target.value)}
              className="terminal-input"
            >
              {desk?.symbols.length ? (
                desk.symbols.map((row) => (
                  <option key={row.symbol} value={row.symbol}>
                    {row.symbol}
                  </option>
                ))
              ) : (
                <option value="">No symbol</option>
              )}
            </select>
          </label>

          <label className="md:col-span-1">
            <span className="mb-1 block text-xs uppercase tracking-wide text-zinc-500">Rows</span>
            <select value={rows} onChange={(event) => setRows(Number(event.target.value))} className="terminal-input">
              <option value={80}>80 trades</option>
              <option value={120}>120 trades</option>
              <option value={180}>180 trades</option>
              <option value={240}>240 trades</option>
            </select>
          </label>

          <label className="md:col-span-1">
            <span className="mb-1 block text-xs uppercase tracking-wide text-zinc-500">Buyer Broker</span>
            <input
              value={buyerInput}
              onChange={(event) => setBuyerInput(event.target.value)}
              className="terminal-input"
              placeholder="e.g. 58"
            />
          </label>

          <label className="md:col-span-1">
            <span className="mb-1 block text-xs uppercase tracking-wide text-zinc-500">Seller Broker</span>
            <input
              value={sellerInput}
              onChange={(event) => setSellerInput(event.target.value)}
              className="terminal-input"
              placeholder="e.g. 49"
            />
          </label>

          <div className="flex items-end gap-2 md:col-span-1">
            <button
              type="button"
              onClick={() => {
                setAppliedBuyer(buyerInput.trim());
                setAppliedSeller(sellerInput.trim());
              }}
              className="terminal-btn w-full text-xs"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => {
                setBuyerInput('');
                setSellerInput('');
                setAppliedBuyer('');
                setAppliedSeller('');
              }}
              className="terminal-btn w-full text-xs"
            >
              Clear
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <article className="terminal-card p-4 sm:p-5">
          <header className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Must Watch Now</p>
              <h2 className="mt-1 text-lg font-semibold text-white">High-Signal Floorsheet Alerts</h2>
            </div>
          </header>

          <div className="mt-4 space-y-2">
            {mustWatchAlerts.length ? (
              mustWatchAlerts.map((alert, index) => (
                <div key={`${alert.title}-${index}`} className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-md border px-2 py-1 text-[10px] font-semibold tracking-wide ${severityClass(alert.severity)}`}>
                      {alert.severity}
                    </span>
                    <span className="text-[11px] uppercase tracking-wide text-zinc-500">{alert.type.replace(/_/g, ' ')}</span>
                  </div>
                  <p className="mt-2 text-sm text-zinc-100">{alert.title}</p>
                  <p className="mt-1 text-xs text-zinc-400">{alert.detail}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-zinc-500">No major alert triggered in current scan.</p>
            )}
          </div>
        </article>

        <article className="terminal-card p-4 sm:p-5">
          <header>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Execution Bridge</p>
            <h2 className="mt-1 text-lg font-semibold text-white">One-Click Plan Handoff</h2>
          </header>

          <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 text-sm text-zinc-300">
              <p>
                Suggested side: <span className="font-semibold text-zinc-100">{suggestedSide.toUpperCase()}</span>
              </p>
              <p className="mt-1">
                Flow pressure: <span className="font-semibold text-zinc-100">{selectedInsight?.pressure.label ?? 'N/A'}</span>
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Use only with your own chart validation and risk controls.
              </p>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 text-xs text-zinc-400">
              Entry {entry > 0 ? formatNumber(entry) : '--'} | Stop {stop > 0 ? formatNumber(stop) : '--'} | Target{' '}
              {target > 0 ? formatNumber(target) : '--'}
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <Link to={executionHref} className="terminal-btn text-center text-xs">
                Plan in Execution
              </Link>
              <Link to={selectedSymbol ? `/chart-desk/${encodeURIComponent(selectedSymbol)}` : '/chart-desk'} className="terminal-btn text-center text-xs">
                Open Chart Lab
              </Link>
            </div>
          </div>
        </article>
      </section>

      <section className="terminal-card p-4 sm:p-5">
        <header>
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Symbol Scanner</p>
          <h2 className="mt-1 text-lg font-semibold text-white">Broker Flow by Active Symbols</h2>
        </header>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {desk?.symbols.length ? (
            desk.symbols.map((symbol) => {
              const selected = symbol.symbol === selectedSymbol;
              return (
                <button
                  key={symbol.symbol}
                  type="button"
                  onClick={() => setSelectedSymbol(symbol.symbol)}
                  className={
                    selected
                      ? 'rounded-xl border border-cyan-300/70 bg-cyan-500/10 p-3 text-left'
                      : 'rounded-xl border border-zinc-800 bg-zinc-950/70 p-3 text-left hover:border-cyan-500/60'
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-base font-semibold text-zinc-100">{symbol.symbol}</p>
                    <span className={`rounded-md border px-2 py-1 text-[10px] font-semibold tracking-wide ${pressureClass(symbol.pressure.label)}`}>
                      {symbol.pressure.label.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">Turnover Rs {formatNumber(symbol.amount)}</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    Trades {formatInteger(symbol.tradeCount)} | Block {formatInteger(symbol.blockTradeCount)}
                  </p>
                </button>
              );
            })
          ) : (
            <p className="text-sm text-zinc-500">Symbol scan is not available right now.</p>
          )}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="terminal-card p-4 sm:p-5">
          <header>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Selected Symbol</p>
            <h2 className="mt-1 text-lg font-semibold text-white">{selectedSymbol || 'No Symbol Selected'}</h2>
          </header>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Turnover</p>
              <p className="mt-2 font-mono text-xl text-zinc-100">Rs {formatNumber(selectedInsight?.amount ?? null)}</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Weighted Avg Rate</p>
              <p className="mt-2 font-mono text-xl text-zinc-100">{formatNumber(selectedInsight?.weightedAvgRate ?? null)}</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Transfer Score</p>
              <p className="mt-2 font-mono text-xl text-zinc-100">{formatNumber(selectedInsight?.pressure.transferScore ?? null)}%</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Concentration</p>
              <p className="mt-2 font-mono text-xl text-zinc-100">{formatNumber(selectedInsight?.pressure.concentrationPct ?? null)}%</p>
            </div>
          </div>

          <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 text-sm text-zinc-300">
            {selectedInsight?.highlights.length ? (
              selectedInsight.highlights.map((line, index) => (
                <p key={`${line}-${index}`} className={index > 0 ? 'mt-1' : ''}>
                  {line}
                </p>
              ))
            ) : (
              <p>No symbol highlights available yet.</p>
            )}
          </div>
        </article>

        <article className="terminal-card p-4 sm:p-5">
          <header>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Large Prints</p>
            <h2 className="mt-1 text-lg font-semibold text-white">Block Trade Radar</h2>
          </header>

          <div className="mt-4 space-y-2">
            {detail?.topPrints.length ? (
              detail.topPrints.slice(0, 8).map((print, index) => (
                <div key={`${print.contractNo ?? index}-${print.amount}-${index}`} className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-sm text-zinc-100">#{print.contractNo ?? '-'}</span>
                    <span className="font-mono text-sm text-cyan-200">Rs {formatNumber(print.amount)}</span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-400">
                    Buyer {print.buyerBroker ?? '--'} | Seller {print.sellerBroker ?? '--'} | Qty {formatInteger(print.quantity)} | Rate {formatNumber(print.rate)}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-zinc-500">No block prints detected for current selection.</p>
            )}
          </div>
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="terminal-card overflow-hidden">
          <header className="border-b border-zinc-800 px-4 py-3">
            <h2 className="text-base font-semibold text-white">Top Net Buyer Brokers</h2>
          </header>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-zinc-800 text-sm">
              <thead className="bg-black/40 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3 text-left">Broker</th>
                  <th className="px-4 py-3 text-right">Net Amount</th>
                  <th className="px-4 py-3 text-right">Traded Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900/80">
                {detail?.brokerFlows.topNetBuyers.length ? (
                  detail.brokerFlows.topNetBuyers.map((row) => (
                    <tr key={`buyer-${row.broker}`}>
                      <td className="px-4 py-3 font-mono text-zinc-100">{row.broker}</td>
                      <td className="px-4 py-3 text-right font-mono text-terminal-green">Rs {formatNumber(row.netAmount)}</td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-300">Rs {formatNumber(row.tradedAmount)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-zinc-500">
                      No net buyer concentration yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="terminal-card overflow-hidden">
          <header className="border-b border-zinc-800 px-4 py-3">
            <h2 className="text-base font-semibold text-white">Top Net Seller Brokers</h2>
          </header>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-zinc-800 text-sm">
              <thead className="bg-black/40 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3 text-left">Broker</th>
                  <th className="px-4 py-3 text-right">Net Amount</th>
                  <th className="px-4 py-3 text-right">Traded Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900/80">
                {detail?.brokerFlows.topNetSellers.length ? (
                  detail.brokerFlows.topNetSellers.map((row) => (
                    <tr key={`seller-${row.broker}`}>
                      <td className="px-4 py-3 font-mono text-zinc-100">{row.broker}</td>
                      <td className="px-4 py-3 text-right font-mono text-terminal-red">Rs {formatNumber(row.netAmount)}</td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-300">Rs {formatNumber(row.tradedAmount)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-zinc-500">
                      No net seller concentration yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="terminal-card overflow-hidden">
        <header className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-4 py-3">
          <h2 className="text-base font-semibold text-white">Trade Tape</h2>
          <span className="rounded-md border border-zinc-700/80 bg-zinc-900/70 px-2 py-1 text-[11px] text-zinc-400">
            Showing {detail?.trades.length ?? 0} rows
          </span>
        </header>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-800 text-sm">
            <thead className="bg-black/40 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3 text-left">Contract</th>
                <th className="px-4 py-3 text-left">Buyer</th>
                <th className="px-4 py-3 text-left">Seller</th>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3 text-right">Rate</th>
                <th className="px-4 py-3 text-right">Amount (Rs)</th>
                <th className="px-4 py-3 text-left">Traded</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900/80">
              {detail?.trades.length ? (
                detail.trades.map((trade, index) => (
                  <tr key={`${trade.contractNo ?? 'c'}-${trade.amount}-${index}`}>
                    <td className="px-4 py-3 font-mono text-zinc-100">{trade.contractNo ?? '-'}</td>
                    <td className="px-4 py-3 font-mono text-zinc-300">{trade.buyerBroker ?? '--'}</td>
                    <td className="px-4 py-3 font-mono text-zinc-300">{trade.sellerBroker ?? '--'}</td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-300">{formatInteger(trade.quantity)}</td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-300">{formatNumber(trade.rate)}</td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-100">{formatNumber(trade.amount)}</td>
                    <td className="px-4 py-3 text-xs text-zinc-500">{trade.tradedAt ?? '--'}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-zinc-500">
                    No trades found for this symbol and filter combination.
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
