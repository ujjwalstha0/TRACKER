import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

type InstrumentType = 'equity' | 'debenture' | 'other';
type TraderType = 'individual' | 'entity';

interface CalcRequest {
  isBuy: boolean;
  price: number;
  qty: number;
  instrumentType: InstrumentType;
  buyPrice: number | null;
  holdingDays: number | null;
  traderType: TraderType;
}

interface BreakdownRow {
  charge: string;
  rate: number | null;
  amount: number;
}

interface CalcResponse {
  transactionValue: number;
  totalAmountToPay?: number;
  netProceeds?: number;
  totalCharges?: number;
  totalDeductions?: number;
  cgtAmount?: number;
  cgtRate?: number;
  breakdown: BreakdownRow[];
}

interface FormState {
  side: 'buy' | 'sell';
  price: number;
  qty: number;
  instrumentType: InstrumentType;
  holdingDays: number;
  buyPrice: number;
  traderType: TraderType;
}

const THEME_KEY = 'nepse.calculator.theme';

export function BuySellCalculator() {
  const [form, setForm] = useState<FormState>({
    side: 'buy',
    price: 850,
    qty: 100,
    instrumentType: 'equity',
    holdingDays: 180,
    buyPrice: 650,
    traderType: 'individual',
  });
  const [isDark, setIsDark] = useState<boolean>(() => localStorage.getItem(THEME_KEY) !== 'light');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CalcResponse | null>(null);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light');
  }, [isDark]);

  const formatMoney = useCallback((amount: number) => {
    return `Rs. ${new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)}`;
  }, []);

  const formatRate = useCallback((rate: number | null) => {
    if (rate === null || Number.isNaN(rate)) return '-';
    const normalized = rate <= 1 ? rate * 100 : rate;
    return `${normalized.toFixed(2)}%`;
  }, []);

  const endpointUrl = '/api/calculate-nepse-cost';
  // TODO: Change endpointUrl if backend route differs in your environment.

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError('');
      setLoading(true);

      try {
        const payload: CalcRequest = {
          isBuy: form.side === 'buy',
          price: form.price,
          qty: form.qty,
          instrumentType: form.instrumentType,
          buyPrice: form.side === 'sell' ? form.buyPrice : null,
          holdingDays: form.side === 'sell' ? form.holdingDays : null,
          traderType: form.traderType,
        };

        const res = await fetch(endpointUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          throw new Error('Unable to calculate charges.');
        }

        const data = (await res.json()) as CalcResponse;
        setResult(data);
      } catch (e) {
        setResult(null);
        setError(e instanceof Error ? e.message : 'Calculation failed.');
      } finally {
        setLoading(false);
      }
    },
    [form],
  );

  const summary = useMemo(() => {
    if (!result) return null;

    const totalChargesFromBreakdown = result.breakdown
      .filter((row) => row.charge !== 'Transaction Value')
      .reduce((sum, row) => sum + row.amount, 0);

    if (form.side === 'buy') {
      return {
        primaryLabel: 'Total Amount to Pay',
        primaryValue: result.totalAmountToPay ?? result.transactionValue + totalChargesFromBreakdown,
        secondLabel: 'Transaction Value',
        secondValue: result.transactionValue,
        thirdLabel: 'Total Charges',
        thirdValue: result.totalCharges ?? totalChargesFromBreakdown,
      };
    }

    return {
      primaryLabel: 'Net Proceeds',
      primaryValue: result.netProceeds ?? result.transactionValue - totalChargesFromBreakdown,
      secondLabel: 'Transaction Value',
      secondValue: result.transactionValue,
      thirdLabel: 'Total Deductions (fees + CGT)',
      thirdValue: result.totalDeductions ?? totalChargesFromBreakdown,
    };
  }, [form.side, result]);

  return (
    <div className={isDark ? 'calc-page theme-dark' : 'calc-page'}>
      <header className="calc-header">
        <div>
          <h1>NEPSE Buy/Sell Calculator</h1>
          <p>Exact trade cost and net proceeds after all charges.</p>
        </div>
        <button className="theme-btn" onClick={() => setIsDark((v) => !v)} type="button">
          {isDark ? 'Light Mode' : 'Dark Mode'}
        </button>
      </header>

      <section className="calc-layout">
        <form className="calc-card form-card" onSubmit={handleSubmit}>
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
              Share price (NPR)
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
              Quantity (shares)
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

          <div className="field-group">
            <label className="label" htmlFor="instrumentType">
              Instrument type
            </label>
            <select
              id="instrumentType"
              value={form.instrumentType}
              onChange={(e) => setForm((old) => ({ ...old, instrumentType: e.target.value as InstrumentType }))}
            >
              <option value="equity">Equity</option>
              <option value="debenture">Corporate debenture</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div className="field-group">
            <label className="label" htmlFor="traderType">
              Trader type
            </label>
            <select
              id="traderType"
              value={form.traderType}
              onChange={(e) => setForm((old) => ({ ...old, traderType: e.target.value as TraderType }))}
            >
              <option value="individual">Individual</option>
              <option value="entity">Entity</option>
            </select>
          </div>

          {form.side === 'sell' ? (
            <>
              <div className="field-group">
                <label className="label" htmlFor="holdingDays">
                  Holding period (days)
                </label>
                <input
                  id="holdingDays"
                  type="number"
                  placeholder="180"
                  value={form.holdingDays}
                  onChange={(e) => setForm((old) => ({ ...old, holdingDays: Number(e.target.value) }))}
                  required
                />
                <small>Used to select CGT 7.5% (&le;365) vs 5% (&gt;365).</small>
              </div>

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
                  onChange={(e) => setForm((old) => ({ ...old, buyPrice: Number(e.target.value) }))}
                  required
                />
              </div>
            </>
          ) : null}

          <button className="calculate-btn" type="submit" disabled={loading}>
            {loading ? 'Calculating...' : 'Calculate'}
          </button>

          {error ? <p className="error-text">{error}</p> : null}
        </form>

        <div className="calc-card results-card">
          {summary ? (
            <>
              <div className="summary-grid">
                <article className="summary-card">
                  <p>{summary.primaryLabel}</p>
                  <h3>{formatMoney(summary.primaryValue)}</h3>
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
                    {result?.breakdown.map((row) => (
                      <tr key={`${row.charge}-${row.amount}`}>
                        <td>{row.charge}</td>
                        <td>{formatRate(row.rate)}</td>
                        <td>{formatMoney(row.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <h3>Ready to calculate</h3>
              <p>Enter trade details and click Calculate to view buy/sell totals and full breakdown.</p>
            </div>
          )}
        </div>
      </section>

      {/* TODO: Optional prop wiring example: onResult?.(result) */}
    </div>
  );
}
