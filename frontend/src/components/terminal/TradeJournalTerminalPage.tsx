import { useEffect, useMemo, useState } from 'react';
import { fetchTrades } from '../../lib/api';
import { TradeRow } from '../../types';

interface TradeWithPnL extends TradeRow {
  realizedPnL: number | null;
}

interface Lot {
  qty: number;
  unitCost: number;
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function computeFifoPnL(rows: TradeRow[]): TradeWithPnL[] {
  const lotsBySymbol = new Map<string, Lot[]>();
  const realizedByTradeId = new Map<number, number | null>();

  const chronologicalRows = [...rows].sort((a, b) => a.id - b.id);

  for (const row of chronologicalRows) {
    const symbolLots = lotsBySymbol.get(row.symbol) ?? [];

    if (row.isBuy) {
      const unitCost = row.qty > 0 ? Number(row.netCostOrProceeds) / Number(row.qty) : 0;
      symbolLots.push({ qty: Number(row.qty), unitCost });
      lotsBySymbol.set(row.symbol, symbolLots);
      realizedByTradeId.set(row.id, null);
      continue;
    }

    let remainingSellQty = Number(row.qty);
    let matchedQty = 0;
    let matchedCost = 0;

    while (remainingSellQty > 0 && symbolLots.length > 0) {
      const firstLot = symbolLots[0];
      const consumeQty = Math.min(firstLot.qty, remainingSellQty);

      matchedQty += consumeQty;
      matchedCost += consumeQty * firstLot.unitCost;

      firstLot.qty -= consumeQty;
      remainingSellQty -= consumeQty;

      if (firstLot.qty <= 0) {
        symbolLots.shift();
      }
    }

    lotsBySymbol.set(row.symbol, symbolLots);

    if (matchedQty > 0) {
      realizedByTradeId.set(row.id, Number(row.netCostOrProceeds) - matchedCost);
    } else {
      realizedByTradeId.set(row.id, null);
    }
  }

  return [...rows]
    .sort((a, b) => b.id - a.id)
    .map((row) => ({
      ...row,
      realizedPnL: realizedByTradeId.get(row.id) ?? null,
    }));
}

export function TradeJournalTerminalPage() {
  const [rows, setRows] = useState<TradeRow[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchTrades()
      .then((data) => {
        setRows(data);
        setError('');
      })
      .catch((requestError) => {
        setRows([]);
        setError(requestError instanceof Error ? requestError.message : 'Unable to load trade journal.');
      });
  }, []);

  const enrichedRows = useMemo(() => computeFifoPnL(rows), [rows]);

  const summary = useMemo(() => {
    const sells = enrichedRows.filter((row) => !row.isBuy);

    const totalRealizedPnL = sells.reduce((sum, row) => sum + (row.realizedPnL ?? 0), 0);
    const totalCgt = sells.reduce((sum, row) => sum + Number(row.cgtAmount), 0);

    const grossTurnover = enrichedRows.reduce((sum, row) => sum + Number(row.totalValue), 0);

    return {
      totalRealizedPnL,
      totalCgt,
      grossTurnover,
      tradeCount: enrichedRows.length,
    };
  }, [enrichedRows]);

  return (
    <section className="space-y-5">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Execution Log</p>
        <h1 className="text-2xl font-semibold text-white">Trade Journal</h1>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article className="terminal-card p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Realized P&L</p>
          <p className={summary.totalRealizedPnL >= 0 ? 'mt-3 font-mono text-2xl font-bold text-terminal-green' : 'mt-3 font-mono text-2xl font-bold text-terminal-red'}>
            ₹ {formatMoney(summary.totalRealizedPnL)}
          </p>
        </article>
        <article className="terminal-card p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">CGT Paid</p>
          <p className="mt-3 font-mono text-2xl font-bold text-white">₹ {formatMoney(summary.totalCgt)}</p>
        </article>
        <article className="terminal-card p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Gross Turnover</p>
          <p className="mt-3 font-mono text-2xl font-bold text-white">₹ {formatMoney(summary.grossTurnover)}</p>
        </article>
        <article className="terminal-card p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Trades</p>
          <p className="mt-3 font-mono text-2xl font-bold text-white">{summary.tradeCount}</p>
        </article>
      </section>

      <section className="terminal-card overflow-hidden">
        <header className="border-b border-zinc-800 p-4">
          <h2 className="text-base font-semibold text-white">Journal Entries</h2>
        </header>

        {error ? <p className="border-b border-zinc-800 px-4 py-3 text-sm text-terminal-red">{error}</p> : null}

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-800 text-sm">
            <thead className="bg-black/40 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3 text-left">Symbol</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-right">Price</th>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-right">Net</th>
                <th className="px-4 py-3 text-right">P&L</th>
                <th className="px-4 py-3 text-right">CGT</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900/80">
              {enrichedRows.length ? (
                enrichedRows.map((row) => {
                  const pnl = row.realizedPnL;
                  const pnlClass = pnl === null ? 'text-zinc-500' : pnl >= 0 ? 'text-terminal-green' : 'text-terminal-red';

                  return (
                    <tr key={row.id} className="hover:bg-zinc-900/80">
                      <td className="px-4 py-3 font-mono font-semibold text-white">{row.symbol}</td>
                      <td className={row.isBuy ? 'px-4 py-3 text-zinc-300' : 'px-4 py-3 text-terminal-amber'}>{row.isBuy ? 'Buy' : 'Sell'}</td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-200">{formatMoney(row.price)}</td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-200">{row.qty}</td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-300">₹ {formatMoney(Number(row.totalValue))}</td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-100">₹ {formatMoney(Number(row.netCostOrProceeds))}</td>
                      <td className={`px-4 py-3 text-right font-mono font-semibold ${pnlClass}`}>
                        {pnl === null ? '-' : `₹ ${formatMoney(pnl)}`}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-400">{(Number(row.cgtRate) * 100).toFixed(2)}%</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-zinc-500">
                    No trade records available yet.
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
