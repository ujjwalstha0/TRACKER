import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

type InstrumentType = 'equity' | 'debenture' | 'other';
type TraderType = 'individual' | 'entity';
type ListingType = 'listed' | 'unlisted';

interface CalcRequest {
  symbol: string;
  side: 'buy' | 'sell';
  price: number;
  quantity: number;
  instrumentType: InstrumentType;
  listingType: ListingType;
  entityType: TraderType;
  buyPricePerShare?: number;
  holdingDays: number | null;
}

interface BreakdownRow {
  id: string;
  charge: string;
  rate: number | null;
  amount: number;
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

interface FeeBackendResponse {
  grossValue: number;
  brokerCommission: number;
  sebonTransactionFee: number;
  dpCharge: number;
  cgtRate: number;
  cgtAmount: number;
  totalFeesExcludingCgt: number;
  totalBuyInCost: number;
  netSellProceeds: number;
}

interface CalcResponse {
  transactionValue: number;
  totalAmountToPay: number;
  netProceeds: number;
  totalCharges: number;
  totalDeductions: number;
  breakdown: BreakdownRow[];
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

  const endpointUrl = '/api/fees/calculate';
  // TODO: Change endpointUrl only if your backend route differs.

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError('');
      setLoading(true);

      try {
        const payload: CalcRequest = {
          symbol: 'NEPSE',
          side: form.side,
          price: form.price,
          quantity: form.qty,
          instrumentType: form.instrumentType,
          listingType: 'listed',
          entityType: form.traderType,
          holdingDays: form.side === 'sell' ? form.holdingDays : null,
          buyPricePerShare: form.side === 'sell' ? form.buyPrice : undefined,
        };

        const res = await fetch(endpointUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          throw new Error('Unable to calculate charges.');
        }

        const data = (await res.json()) as FeeBackendResponse;
        const transactionValue = data.grossValue;
        const totalAmountToPay = data.totalBuyInCost;
        const netProceeds = data.netSellProceeds;
        const totalCharges = data.totalFeesExcludingCgt;
        const totalDeductions = data.totalFeesExcludingCgt + data.cgtAmount;
        const brokerRate = transactionValue > 0 ? data.brokerCommission / transactionValue : 0;
        const sebonRate = transactionValue > 0 ? data.sebonTransactionFee / transactionValue : 0;

        const breakdown: BreakdownRow[] = [
          {
            id: 'tx',
            charge: 'Transaction Value',
            rate: null,
            amount: transactionValue,
          },
          {
            id: 'broker',
            charge: 'Broker Commission (total)',
            rate: brokerRate,
            amount: data.brokerCommission,
          },
          {
            id: 'sebon',
            charge: 'SEBON Transaction Fee',
            rate: sebonRate,
            amount: data.sebonTransactionFee,
          },
          {
            id: 'dp',
            charge: 'DP Transfer Charge',
            rate: null,
            amount: data.dpCharge,
          },
        ];

        if (form.side === 'sell') {
          breakdown.push({
            id: 'cgt',
            charge: 'CGT',
            rate: data.cgtRate,
            amount: data.cgtAmount,
          });
        }

        breakdown.push({
          id: 'total',
          charge: form.side === 'buy' ? 'Total Amount to Pay' : 'Net Proceeds',
          rate: null,
          amount: form.side === 'buy' ? totalAmountToPay : netProceeds,
        });

        const normalized: CalcResponse = {
          transactionValue,
          totalAmountToPay,
          netProceeds,
          totalCharges,
          totalDeductions,
          breakdown,
        };

        setResult(normalized);
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

    if (form.side === 'buy') {
      return {
        primaryLabel: 'Total Amount to Pay',
        primaryValue: result.totalAmountToPay,
        secondLabel: 'Transaction Value',
        secondValue: result.transactionValue,
        thirdLabel: 'Total Charges',
        thirdValue: result.totalCharges,
      };
    }

    return {
      primaryLabel: 'Net Proceeds',
      primaryValue: result.netProceeds,
      secondLabel: 'Transaction Value',
      secondValue: result.transactionValue,
      thirdLabel: 'Total Deductions (fees + CGT)',
      thirdValue: result.totalDeductions,
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
                      <tr key={row.id}>
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
