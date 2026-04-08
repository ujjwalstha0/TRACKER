import { FormEvent, useCallback, useMemo, useState } from 'react';
import { calculateNepseCost } from '../lib/api';
import { NepseCostResponse } from '../types';

interface CalculatorFormState {
  side: 'buy' | 'sell';
  price: string;
  qty: string;
  holdingDays: string;
  buyPrice: string;
}

const defaultState: CalculatorFormState = {
  side: 'buy',
  price: '',
  qty: '',
  holdingDays: '',
  buyPrice: '',
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
        const price = Number(form.price);
        const qty = Number(form.qty);
        const holdingDays = Number(form.holdingDays);
        const buyPrice = Number(form.buyPrice);

        if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(qty) || qty <= 0) {
          throw new Error('Price and quantity must be valid positive numbers.');
        }

        if (form.side === 'sell' && (!Number.isFinite(buyPrice) || buyPrice <= 0)) {
          throw new Error('Original buy price is required for sell CGT calculation.');
        }

        if (form.side === 'sell' && (!Number.isFinite(holdingDays) || holdingDays < 0)) {
          throw new Error('Holding days must be a valid number for sell calculation.');
        }

        const data = await calculateNepseCost({
          isBuy: form.side === 'buy',
          price,
          qty,
          instrumentType: 'equity',
          buyPrice: form.side === 'sell' ? buyPrice : null,
          holdingDays: form.side === 'sell' ? holdingDays : null,
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
    [form.buyPrice, form.holdingDays, form.price, form.qty, form.side],
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
      thirdLabel: 'Total Deductions (fees + CGT)',
      thirdValue: result.totalDeductions,
    };
  }, [form.side, result]);

  const detailRows = useMemo(() => {
    if (!result) return [];

    const transactionValue = result.transactionValue;
    const sellPrice = Number(form.price) || 0;
    const qty = Number(form.qty) || 0;
    const buyPrice = Number(form.buyPrice) || 0;
    const taxableGain = form.side === 'sell' ? Math.max(0, (sellPrice - buyPrice) * qty) : 0;

    return result.breakdown
      .filter((row) => row.charge !== 'Transaction Value')
      .map((row) => {
        const label = row.charge;

        if (label.includes('Broker Commission')) {
          return {
            charge: label,
            chargedOn: `Transaction Value ${formatMoney(transactionValue)}`,
            formula: `${formatMoney(transactionValue)} x ${formatRate(row.rate)}`,
            amount: row.amount,
          };
        }

        if (label.includes('SEBON')) {
          return {
            charge: label,
            chargedOn: `Transaction Value ${formatMoney(transactionValue)}`,
            formula: `${formatMoney(transactionValue)} x ${formatRate(row.rate)}`,
            amount: row.amount,
          };
        }

        if (label.includes('DP')) {
          return {
            charge: label,
            chargedOn: 'Per sell transaction',
            formula: 'Fixed DP transfer charge',
            amount: row.amount,
          };
        }

        if (label === 'CGT') {
          return {
            charge: label,
            chargedOn: `Taxable gain ${formatMoney(taxableGain)}`,
            formula: `${formatMoney(taxableGain)} x ${formatRate(row.rate)}`,
            amount: row.amount,
          };
        }

        return {
          charge: label,
          chargedOn: '-',
          formula: '-',
          amount: row.amount,
        };
      });
  }, [form.buyPrice, form.price, form.qty, form.side, formatMoney, formatRate, result]);

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
            onChange={(e) => setForm((old) => ({ ...old, price: e.target.value }))}
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
            onChange={(e) => setForm((old) => ({ ...old, qty: e.target.value }))}
            required
          />
        </div>

        {form.side === 'sell' ? (
          <>
            <div className="field-group">
              <label className="label" htmlFor="buyPrice">
                Original buy price (NPR)
              </label>
              <input
                id="buyPrice"
                type="number"
                step="0.01"
                placeholder="650.00"
                value={form.buyPrice}
                onChange={(e) => setForm((old) => ({ ...old, buyPrice: e.target.value }))}
                required
              />
            </div>

            <div className="field-group">
              <label className="label" htmlFor="holdingDays">
                Holding days
              </label>
              <input
                id="holdingDays"
                type="number"
                placeholder="180"
                value={form.holdingDays}
                onChange={(e) => setForm((old) => ({ ...old, holdingDays: e.target.value }))}
                required
              />
              <small className="subtle">CGT 7.5% for &le;365 days, 5% for &gt;365 days on positive gain.</small>
            </div>
          </>
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

          <div className="table-wrap detail-breakdown">
            <table>
              <thead>
                <tr>
                  <th>Charge</th>
                  <th>Charged On</th>
                  <th>How Calculated</th>
                  <th>Amount (NPR)</th>
                </tr>
              </thead>
              <tbody>
                {detailRows.map((row) => (
                  <tr key={`${row.charge}-${row.formula}`}>
                    <td>{row.charge}</td>
                    <td>{row.chargedOn}</td>
                    <td>{row.formula}</td>
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
