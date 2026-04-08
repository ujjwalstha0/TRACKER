import { FormEvent, useCallback, useMemo, useState } from 'react';
import { calculateNepseCost } from '../lib/api';
import { NepseCostResponse } from '../types';

interface CalculatorFormState {
  side: 'buy' | 'sell';
  price: number;
  qty: number;
  holdingDays: number;
}

const defaultState: CalculatorFormState = {
  side: 'buy',
  price: 850,
  qty: 100,
  holdingDays: 180,
};

export function BuySellCalculator() {
  const [form, setForm] = useState<CalculatorFormState>(defaultState);
  const [result, setResult] = useState<NepseCostResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const formatMoney = useCallback((value: number) => {
    return `Rs. ${new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)}`;
  }, []);

  const formatRate = useCallback((rate: number | null) => {
    if (rate === null) return '-';
    const percent = rate <= 1 ? rate * 100 : rate;
    return `${percent.toFixed(2)}%`;
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setLoading(true);
      setError('');

      try {
        const data = await calculateNepseCost({
          isBuy: form.side === 'buy',
          price: form.price,
          qty: form.qty,
          instrumentType: 'equity',
          buyPrice: null,
          holdingDays: form.side === 'sell' ? form.holdingDays : null,
          traderType: 'individual',
        });
        setResult(data);
      } catch (e) {
        setResult(null);
        setError(e instanceof Error ? e.message : 'Unable to calculate.');
      } finally {
        setLoading(false);
      }
    },
    [form.holdingDays, form.price, form.qty, form.side],
  );

  const summary = useMemo(() => {
    if (!result) return null;

    if (form.side === 'buy') {
      return {
        firstLabel: 'Total Amount to Pay',
        firstValue: result.totalAmountToPay ?? 0,
        secondLabel: 'Transaction Value',
        secondValue: result.transactionValue,
        thirdLabel: 'Total Charges',
        thirdValue: result.totalCharges,
      };
    }

    return {
      firstLabel: 'Net Proceeds',
      firstValue: result.netProceeds ?? 0,
      secondLabel: 'Transaction Value',
      secondValue: result.transactionValue,
      thirdLabel: 'Total Deductions',
      thirdValue: result.totalDeductions,
    };
  }, [form.side, result]);

  return (
    <section className="card">
      <h2>Buy/Sell Calculator</h2>
      <p className="subtle">Equity + individual assumptions are fixed internally.</p>

      <form className="form-grid" onSubmit={handleSubmit}>
        <div className="field-group">
          <label className="label">Transaction side</label>
          <div className="toggle-row">
            <button
              type="button"
              className={form.side === 'buy' ? 'toggle active' : 'toggle'}
              onClick={() => setForm((old) => ({ ...old, side: 'buy' }))}
            >
              Buy
            </button>
            <button
              type="button"
              className={form.side === 'sell' ? 'toggle active' : 'toggle'}
              onClick={() => setForm((old) => ({ ...old, side: 'sell' }))}
            >
              Sell
            </button>
          </div>
        </div>

        <div className="field-group">
          <label className="label" htmlFor="price">
            Price (per share)
          </label>
          <input
            id="price"
            type="number"
            step="0.01"
            placeholder="850.00"
            value={form.price}
            onChange={(e) => setForm((old) => ({ ...old, price: Number(e.target.value) }))}
            required
          />
        </div>

        <div className="field-group">
          <label className="label" htmlFor="qty">
            Quantity
          </label>
          <input
            id="qty"
            type="number"
            placeholder="100"
            value={form.qty}
            onChange={(e) => setForm((old) => ({ ...old, qty: Number(e.target.value) }))}
            required
          />
        </div>

        {form.side === 'sell' ? (
          <div className="field-group">
            <label className="label" htmlFor="holdingDays">
              Holding days
            </label>
            <input
              id="holdingDays"
              type="number"
              placeholder="180"
              value={form.holdingDays}
              onChange={(e) => setForm((old) => ({ ...old, holdingDays: Number(e.target.value) }))}
              required
            />
          </div>
        ) : null}

        <button className="primary-btn" type="submit" disabled={loading}>
          {loading ? 'Calculating...' : 'Calculate'}
        </button>

        {error ? <p className="error-text">{error}</p> : null}
      </form>

      {summary && result ? (
        <>
          <div className="summary-grid">
            <article className="summary-card">
              <p>{summary.firstLabel}</p>
              <h3>{formatMoney(summary.firstValue)}</h3>
            </article>
            <article className="summary-card">
              <p>{summary.secondLabel}</p>
              <h3>{formatMoney(summary.secondValue)}</h3>
            </article>
            <article className="summary-card">
              <p>{summary.thirdLabel}</p>
              <h3>{formatMoney(summary.thirdValue)}</h3>
            </article>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Charge</th>
                  <th>Rate</th>
                  <th>Amount (NPR)</th>
                </tr>
              </thead>
              <tbody>
                {result.breakdown.map((row, idx) => (
                  <tr key={`${row.charge}-${idx}`}>
                    <td>{row.charge}</td>
                    <td>{formatRate(row.rate)}</td>
                    <td>{formatMoney(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}
