import { FormEvent, useEffect, useMemo, useState } from 'react';
import { calculateNepseCost, fetchWatchlist } from '../../lib/api';
import { NepseCostResponse, WatchlistApiRow } from '../../types';

type Side = 'buy' | 'sell';

interface FormState {
  side: Side;
  symbol: string;
  price: string;
  qty: string;
  buyPrice: string;
  holdingDays: string;
}

const INITIAL_FORM: FormState = {
  side: 'buy',
  symbol: '',
  price: '',
  qty: '100',
  buyPrice: '',
  holdingDays: '',
};

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatRate(rate: number | null): string {
  if (rate === null) return '-';
  const percentage = rate <= 1 ? rate * 100 : rate;
  return `${percentage.toFixed(3)}%`;
}

export function CalculatorTerminalPage() {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [watchlist, setWatchlist] = useState<WatchlistApiRow[]>([]);
  const [result, setResult] = useState<NepseCostResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchWatchlist()
      .then((rows) => setWatchlist(rows))
      .catch(() => setWatchlist([]));
  }, []);

  const applySymbol = (symbol: string) => {
    setForm((previous) => {
      const selected = watchlist.find((item) => item.symbol === symbol);
      if (!selected) {
        return { ...previous, symbol };
      }

      return {
        ...previous,
        symbol,
        price: String(selected.ltp),
        buyPrice: previous.buyPrice || String(selected.ltp),
      };
    });
  };

  const summary = useMemo(() => {
    if (!result) return null;

    if (form.side === 'buy') {
      return {
        heading: 'Total Amount To Pay',
        value: result.totalAmountToPay ?? 0,
        lineOneLabel: 'Transaction Value',
        lineOneValue: result.transactionValue,
        lineTwoLabel: 'Total Charges',
        lineTwoValue: result.totalCharges,
      };
    }

    return {
      heading: 'Net Proceeds',
      value: result.netProceeds ?? 0,
      lineOneLabel: 'Transaction Value',
      lineOneValue: result.transactionValue,
      lineTwoLabel: 'Total Deductions',
      lineTwoValue: result.totalDeductions,
    };
  }, [form.side, result]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setLoading(true);
    setError('');

    try {
      const price = Number(form.price);
      const qty = Number(form.qty);
      const buyPrice = Number(form.buyPrice);
      const holdingDays = Number(form.holdingDays);

      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(qty) || qty <= 0) {
        throw new Error('Price and quantity must be valid positive numbers.');
      }

      if (form.side === 'sell' && (!Number.isFinite(buyPrice) || buyPrice <= 0)) {
        throw new Error('Original buy price is required for sell-side CGT.');
      }

      if (form.side === 'sell' && (!Number.isFinite(holdingDays) || holdingDays < 0)) {
        throw new Error('Holding days must be a valid non-negative number.');
      }

      const payload = {
        isBuy: form.side === 'buy',
        price,
        qty,
        instrumentType: 'equity' as const,
        buyPrice: form.side === 'sell' ? buyPrice : null,
        holdingDays: form.side === 'sell' ? holdingDays : null,
        traderType: 'individual' as const,
      };

      const response = await calculateNepseCost(payload);
      setResult(response);
    } catch (submissionError) {
      setResult(null);
      setError(submissionError instanceof Error ? submissionError.message : 'Failed to calculate.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-5">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">NEPSE Cost Engine</p>
        <h1 className="text-2xl font-semibold text-white">Buy/Sell Calculator</h1>
      </header>

      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <form onSubmit={onSubmit} className="terminal-card space-y-4 p-6 dark:bg-zinc-900">
          <div className="space-y-1">
            <label htmlFor="symbol" className="text-xs font-medium uppercase tracking-wide text-zinc-400">
              Company Quick Fill
            </label>
            <select
              id="symbol"
              value={form.symbol}
              onChange={(event) => applySymbol(event.target.value)}
              className="terminal-input"
            >
              <option value="">Select symbol from live feed</option>
              {watchlist.map((item) => (
                <option key={item.symbol} value={item.symbol}>
                  {item.symbol} {item.company ? `- ${item.company}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="price" className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                Price (NPR)
              </label>
              <input
                id="price"
                type="number"
                value={form.price}
                onChange={(event) => setForm((old) => ({ ...old, price: event.target.value }))}
                className="terminal-input font-mono"
                placeholder="850.00"
                required
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="qty" className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                Quantity
              </label>
              <input
                id="qty"
                type="number"
                value={form.qty}
                onChange={(event) => setForm((old) => ({ ...old, qty: event.target.value }))}
                className="terminal-input font-mono"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setForm((old) => ({ ...old, side: 'buy' }))}
              className={
                form.side === 'buy'
                  ? 'terminal-btn-primary border-terminal-green bg-terminal-green/15 text-terminal-green'
                  : 'terminal-btn'
              }
            >
              Buy
            </button>
            <button
              type="button"
              onClick={() => setForm((old) => ({ ...old, side: 'sell' }))}
              className={
                form.side === 'sell'
                  ? 'terminal-btn-primary border-terminal-red bg-terminal-red/15 text-terminal-red'
                  : 'terminal-btn'
              }
            >
              Sell
            </button>
          </div>

          {form.side === 'sell' ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor="buyPrice" className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                  Buy Price
                </label>
                <input
                  id="buyPrice"
                  type="number"
                  value={form.buyPrice}
                  onChange={(event) => setForm((old) => ({ ...old, buyPrice: event.target.value }))}
                  className="terminal-input font-mono"
                  required
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="holdingDays" className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                  Holding Days
                </label>
                <input
                  id="holdingDays"
                  type="number"
                  value={form.holdingDays}
                  onChange={(event) => setForm((old) => ({ ...old, holdingDays: event.target.value }))}
                  className="terminal-input font-mono"
                  required
                />
              </div>
            </div>
          ) : null}

          <button type="submit" disabled={loading} className="terminal-btn-primary w-full py-2.5">
            {loading ? 'Calculating...' : 'Calculate'}
          </button>

          {error ? <p className="text-sm font-medium text-terminal-red">{error}</p> : null}
        </form>

        <aside className="terminal-card p-6">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Result Snapshot</p>
          <h2 className="mt-1 text-lg font-semibold text-white">Execution Cost Summary</h2>

          <div className="mt-5 rounded-xl border border-zinc-700/70 bg-black/60 p-5">
            <p className="text-sm text-zinc-400">{summary?.heading ?? 'Total Amount To Pay'}</p>
            <p className="mt-2 text-4xl font-bold tracking-tight text-white font-mono">
              ₹ {summary ? formatMoney(summary.value) : '0.00'}
            </p>
          </div>

          <dl className="mt-5 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <dt className="text-sm text-zinc-400">{summary?.lineOneLabel ?? 'Transaction Value'}</dt>
              <dd className="font-mono text-base font-semibold text-white">₹ {summary ? formatMoney(summary.lineOneValue) : '0.00'}</dd>
            </div>
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <dt className="text-sm text-zinc-400">{summary?.lineTwoLabel ?? 'Total Charges'}</dt>
              <dd className="font-mono text-base font-semibold text-white">₹ {summary ? formatMoney(summary.lineTwoValue) : '0.00'}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-sm text-zinc-400">Mode</dt>
              <dd className="terminal-pill font-mono uppercase tracking-wide text-zinc-300">{form.side}</dd>
            </div>
          </dl>
        </aside>
      </div>

      <section className="terminal-card overflow-hidden">
        <header className="border-b border-zinc-800 p-5">
          <h3 className="text-base font-semibold text-white">Charge Breakdown</h3>
        </header>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-800 text-sm">
            <thead className="bg-black/40 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-5 py-3 text-left">Charge</th>
                <th className="px-5 py-3 text-left">Rate</th>
                <th className="px-5 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900/80">
              {result?.breakdown.length ? (
                result.breakdown.map((line, index) => (
                  <tr key={`${line.charge}-${index}`} className="hover:bg-zinc-900/80">
                    <td className="px-5 py-3 text-zinc-300">{line.charge}</td>
                    <td className="px-5 py-3 text-zinc-400 font-mono">{formatRate(line.rate)}</td>
                    <td className="px-5 py-3 text-right font-mono font-semibold text-white">₹ {formatMoney(line.amount)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className="px-5 py-8 text-center text-zinc-500">
                    Run calculation to see detailed charges.
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
