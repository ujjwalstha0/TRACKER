import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { createHolding, fetchPortfolio, fetchWatchlist, removeHolding } from '../../lib/api';
import { PortfolioResponse, WatchlistApiRow } from '../../types';

interface HoldingForm {
  symbol: string;
  buyPrice: string;
  qty: string;
  targetPrice: string;
  stopLoss: string;
  notes: string;
}

const INITIAL_FORM: HoldingForm = {
  symbol: '',
  buyPrice: '',
  qty: '100',
  targetPrice: '',
  stopLoss: '',
  notes: '',
};

function formatMoney(value: number | null): string {
  if (value === null) return '-';

  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function PortfolioTerminalPage() {
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistApiRow[]>([]);
  const [form, setForm] = useState<HoldingForm>(INITIAL_FORM);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadPortfolio = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const data = await fetchPortfolio();
      setPortfolio(data);
    } catch (loadError) {
      setPortfolio(null);
      setError(loadError instanceof Error ? loadError.message : 'Failed to load your portfolio.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPortfolio();
  }, [loadPortfolio]);

  useEffect(() => {
    fetchWatchlist()
      .then((rows) => setWatchlist(rows))
      .catch(() => setWatchlist([]));
  }, []);

  const applySymbolInput = (symbolInput: string) => {
    const lookup = symbolInput.trim().toLowerCase();
    const selected = watchlist.find(
      (item) => item.symbol.toLowerCase() === lookup || (item.company ?? '').toLowerCase() === lookup,
    );

    if (!selected) {
      setForm((old) => ({ ...old, symbol: symbolInput.toUpperCase() }));
      return;
    }

    setForm((old) => ({
      ...old,
      symbol: selected.symbol,
      buyPrice: old.buyPrice || String(selected.ltp),
    }));
  };

  const submitHolding = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');

    try {
      await createHolding({
        symbol: form.symbol.trim().toUpperCase(),
        buyPrice: Number(form.buyPrice),
        qty: Number(form.qty),
        targetPrice: form.targetPrice ? Number(form.targetPrice) : undefined,
        stopLoss: form.stopLoss ? Number(form.stopLoss) : undefined,
        notes: form.notes || undefined,
      });

      setForm(INITIAL_FORM);
      await loadPortfolio();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to add holding.');
    } finally {
      setSaving(false);
    }
  };

  const deleteHolding = async (id: number) => {
    setError('');
    try {
      await removeHolding(id);
      await loadPortfolio();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to remove holding.');
    }
  };

  const summary = useMemo(() => {
    return (
      portfolio?.summary ?? {
        holdingsCount: 0,
        investedCost: 0,
        currentValue: 0,
        netIfSellNow: 0,
        unrealizedPnl: 0,
      }
    );
  }, [portfolio]);

  return (
    <section className="space-y-5">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Personal Holdings</p>
        <h1 className="text-2xl font-semibold text-white">Portfolio Tracker</h1>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <article className="terminal-card p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Holdings</p>
          <p className="mt-3 font-mono text-2xl font-bold text-white">{summary.holdingsCount}</p>
        </article>
        <article className="terminal-card p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Invested Cost</p>
          <p className="mt-3 font-mono text-2xl font-bold text-white">₹ {formatMoney(summary.investedCost)}</p>
        </article>
        <article className="terminal-card p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Current Value</p>
          <p className="mt-3 font-mono text-2xl font-bold text-white">₹ {formatMoney(summary.currentValue)}</p>
        </article>
        <article className="terminal-card p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Net If Sold Now</p>
          <p className="mt-3 font-mono text-2xl font-bold text-white">₹ {formatMoney(summary.netIfSellNow)}</p>
        </article>
        <article className="terminal-card p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Unrealized P&L</p>
          <p className={summary.unrealizedPnl >= 0 ? 'mt-3 font-mono text-2xl font-bold text-terminal-green' : 'mt-3 font-mono text-2xl font-bold text-terminal-red'}>
            ₹ {formatMoney(summary.unrealizedPnl)}
          </p>
        </article>
      </section>

      <form onSubmit={submitHolding} className="terminal-card grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-6">
        <div className="space-y-1">
          <label className="text-xs uppercase tracking-wide text-zinc-400" htmlFor="holdingSymbol">
            Symbol
          </label>
          <input
            id="holdingSymbol"
            list="portfolio-symbol-options"
            value={form.symbol}
            onChange={(event) => applySymbolInput(event.target.value)}
            className="terminal-input font-mono"
            placeholder="Type symbol or company"
            required
          />
          <datalist id="portfolio-symbol-options">
            {watchlist.map((item) => (
              <option key={item.symbol} value={item.symbol}>
                {item.symbol} {item.company ? `- ${item.company}` : ''}
              </option>
            ))}
            {watchlist
              .filter((item) => item.company)
              .map((item) => (
                <option key={`${item.symbol}-company`} value={item.company ?? ''}>
                  {item.company} ({item.symbol})
                </option>
              ))}
          </datalist>
        </div>

        <div className="space-y-1">
          <label className="text-xs uppercase tracking-wide text-zinc-400" htmlFor="holdingBuyPrice">
            Buy Price
          </label>
          <input
            id="holdingBuyPrice"
            type="number"
            value={form.buyPrice}
            onChange={(event) => setForm((old) => ({ ...old, buyPrice: event.target.value }))}
            className="terminal-input font-mono"
            placeholder="850"
            required
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs uppercase tracking-wide text-zinc-400" htmlFor="holdingQty">
            Qty
          </label>
          <input
            id="holdingQty"
            type="number"
            value={form.qty}
            onChange={(event) => setForm((old) => ({ ...old, qty: event.target.value }))}
            className="terminal-input font-mono"
            required
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs uppercase tracking-wide text-zinc-400" htmlFor="holdingTarget">
            Target
          </label>
          <input
            id="holdingTarget"
            type="number"
            value={form.targetPrice}
            onChange={(event) => setForm((old) => ({ ...old, targetPrice: event.target.value }))}
            className="terminal-input font-mono"
            placeholder="920"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs uppercase tracking-wide text-zinc-400" htmlFor="holdingStop">
            Stop-Loss
          </label>
          <input
            id="holdingStop"
            type="number"
            value={form.stopLoss}
            onChange={(event) => setForm((old) => ({ ...old, stopLoss: event.target.value }))}
            className="terminal-input font-mono"
            placeholder="790"
          />
        </div>

        <div className="flex items-end gap-2">
          <button type="submit" disabled={saving} className="terminal-btn-primary w-full">
            {saving ? 'Adding...' : 'Add Stock'}
          </button>
          <button type="button" onClick={() => void loadPortfolio()} className="terminal-btn">
            {loading ? '...' : '↻'}
          </button>
        </div>

        <div className="space-y-1 md:col-span-2 xl:col-span-6">
          <label className="text-xs uppercase tracking-wide text-zinc-400" htmlFor="holdingNotes">
            Notes (optional)
          </label>
          <input
            id="holdingNotes"
            value={form.notes}
            onChange={(event) => setForm((old) => ({ ...old, notes: event.target.value }))}
            className="terminal-input"
            placeholder="Reason for holding, catalyst, plan..."
          />
        </div>
      </form>

      {error ? <p className="text-sm font-medium text-terminal-red">{error}</p> : null}

      <section className="terminal-card overflow-hidden">
        <header className="border-b border-zinc-800 p-4">
          <h2 className="text-base font-semibold text-white">Tracked Stocks</h2>
        </header>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-800 text-sm">
            <thead className="bg-black/40 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3 text-left">Symbol</th>
                <th className="px-4 py-3 text-right">Buy</th>
                <th className="px-4 py-3 text-right">LTP</th>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3 text-right">Net If Sell</th>
                <th className="px-4 py-3 text-right">P&L Now</th>
                <th className="px-4 py-3 text-right">P&L @ Target</th>
                <th className="px-4 py-3 text-right">P&L @ Stop</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900/80">
              {portfolio?.holdings.length ? (
                portfolio.holdings.map((row) => {
                  const pnlNowPositive = (row.pnlNow ?? 0) >= 0;
                  const pnlTargetPositive = (row.pnlIfTargetHit ?? 0) >= 0;
                  const pnlStopPositive = (row.pnlIfStopLossHit ?? 0) >= 0;

                  return (
                    <tr key={row.id} className="hover:bg-zinc-900/80">
                      <td className="px-4 py-3">
                        <p className="font-mono font-semibold text-white">{row.symbol}</p>
                        <p className="text-xs text-zinc-500">{row.company ?? row.sector ?? 'Tracked'}</p>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-200">{formatMoney(row.buyPrice)}</td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-100">{formatMoney(row.currentPrice)}</td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-300">{row.qty}</td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-100">₹ {formatMoney(row.netIfSellNow)}</td>
                      <td className={pnlNowPositive ? 'px-4 py-3 text-right font-mono text-terminal-green' : 'px-4 py-3 text-right font-mono text-terminal-red'}>
                        ₹ {formatMoney(row.pnlNow)}
                      </td>
                      <td className={pnlTargetPositive ? 'px-4 py-3 text-right font-mono text-terminal-green' : 'px-4 py-3 text-right font-mono text-terminal-red'}>
                        ₹ {formatMoney(row.pnlIfTargetHit)}
                      </td>
                      <td className={pnlStopPositive ? 'px-4 py-3 text-right font-mono text-terminal-green' : 'px-4 py-3 text-right font-mono text-terminal-red'}>
                        ₹ {formatMoney(row.pnlIfStopLossHit)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button type="button" onClick={() => void deleteHolding(row.id)} className="terminal-btn text-terminal-red">
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-zinc-500">
                    Add your first stock to start tracking real-time portfolio P&L.
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
