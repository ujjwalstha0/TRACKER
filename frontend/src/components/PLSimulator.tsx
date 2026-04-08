import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { calculateNepseCost, fetchBuyTrades } from '../lib/api';
import { NepseCostResponse, TradeRow } from '../types';

interface SimulatorResult {
  target: NepseCostResponse;
  stopLoss: NepseCostResponse;
  targetPnL: number;
  stopLossPnL: number;
  costBasis: number;
}

interface ScenarioBreakdownRow {
  label: string;
  formula: string;
  amount: number;
}

function estimateHoldingDays(purchasedAt: string | null): number {
  if (!purchasedAt) return 0;
  const start = new Date(purchasedAt);
  const now = new Date();
  const days = Math.floor((now.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  return Math.max(0, days);
}

export function PLSimulator() {
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [loadingTrades, setLoadingTrades] = useState(false);
  const [selectedTradeId, setSelectedTradeId] = useState<number | null>(null);
  const [buyPrice, setBuyPrice] = useState(0);
  const [quantity, setQuantity] = useState(0);
  const [holdingDays, setHoldingDays] = useState(0);
  const [targetPrice, setTargetPrice] = useState(0);
  const [stopLossPrice, setStopLossPrice] = useState(0);
  const [result, setResult] = useState<SimulatorResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoadingTrades(true);
    fetchBuyTrades()
      .then((rows) => setTrades(rows.filter((t) => t.isBuy)))
      .catch(() => setTrades([]))
      .finally(() => setLoadingTrades(false));
  }, []);

  const selectedTrade = useMemo(() => {
    if (selectedTradeId === null) return null;
    return trades.find((t) => t.id === selectedTradeId) ?? null;
  }, [selectedTradeId, trades]);

  useEffect(() => {
    if (!selectedTrade) return;
    const estimated = estimateHoldingDays(selectedTrade.purchasedAt);
    setBuyPrice(selectedTrade.price);
    setQuantity(selectedTrade.qty);
    setHoldingDays(estimated);
    setTargetPrice(Number((selectedTrade.price * 1.1).toFixed(2)));
    setStopLossPrice(Number((selectedTrade.price * 0.95).toFixed(2)));
    setResult(null);
  }, [selectedTrade]);

  const formatMoney = useCallback((value: number) => {
    return `Rs. ${new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)}`;
  }, []);

  const getBreakdownAmount = useCallback((data: NepseCostResponse, charge: string) => {
    return data.breakdown.find((row) => row.charge === charge)?.amount ?? 0;
  }, []);

  const getBreakdownRate = useCallback((data: NepseCostResponse, charge: string) => {
    return data.breakdown.find((row) => row.charge === charge)?.rate ?? null;
  }, []);

  const formatRate = useCallback((rate: number | null) => {
    if (rate === null) return '-';
    const value = rate <= 1 ? rate * 100 : rate;
    return `${value.toFixed(2)}%`;
  }, []);

  const handleSimulate = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (buyPrice <= 0 || quantity <= 0) {
        setError('Buy price and quantity are required.');
        return;
      }

      if (targetPrice <= 0 || stopLossPrice <= 0) {
        setError('Target and stop-loss price are required.');
        return;
      }

      setLoading(true);
      setError('');

      try {
        const buySnapshot = selectedTrade
          ? null
          : await calculateNepseCost({
              isBuy: true,
              price: buyPrice,
              qty: quantity,
              instrumentType: 'equity',
              buyPrice: null,
              holdingDays: null,
              traderType: 'individual',
            });

        const payloadBase = {
          isBuy: false,
          qty: quantity,
          instrumentType: 'equity' as const,
          traderType: 'individual' as const,
          buyPrice,
          holdingDays,
        };

        const [target, stopLoss] = await Promise.all([
          calculateNepseCost({ ...payloadBase, price: targetPrice }),
          calculateNepseCost({ ...payloadBase, price: stopLossPrice }),
        ]);

        const costBasis = selectedTrade ? selectedTrade.netCostOrProceeds : buySnapshot?.totalAmountToPay ?? 0;
        setResult({
          target,
          stopLoss,
          costBasis,
          targetPnL: (target.netProceeds ?? 0) - costBasis,
          stopLossPnL: (stopLoss.netProceeds ?? 0) - costBasis,
        });
      } catch (e) {
        setResult(null);
        setError(e instanceof Error ? e.message : 'Simulation failed.');
      } finally {
        setLoading(false);
      }
    },
    [buyPrice, holdingDays, quantity, selectedTrade, stopLossPrice, targetPrice],
  );

  const scenarioRows = useMemo(() => {
    if (!result) return null;

    const buildRows = (label: 'target' | 'stop', data: NepseCostResponse, exitPrice: number, pnl: number): ScenarioBreakdownRow[] => {
      const brokerAmount = getBreakdownAmount(data, 'Broker Commission (total)');
      const sebonAmount = getBreakdownAmount(data, 'SEBON Transaction Fee');
      const dpAmount = getBreakdownAmount(data, 'DP Transfer Charge');
      const cgtAmount = getBreakdownAmount(data, 'CGT');
      const brokerRate = getBreakdownRate(data, 'Broker Commission (total)');
      const sebonRate = getBreakdownRate(data, 'SEBON Transaction Fee');
      const cgtRate = getBreakdownRate(data, 'CGT');
      const taxableGain = Math.max(0, (exitPrice - buyPrice) * quantity);
      const proceeds = data.netProceeds ?? 0;

      return [
        {
          label: 'Gross Sell Value',
          formula: `${formatMoney(exitPrice)} x ${quantity}`,
          amount: data.transactionValue,
        },
        {
          label: 'Broker Commission',
          formula: `${formatMoney(data.transactionValue)} x ${formatRate(brokerRate)}`,
          amount: brokerAmount,
        },
        {
          label: 'SEBON Fee',
          formula: `${formatMoney(data.transactionValue)} x ${formatRate(sebonRate)}`,
          amount: sebonAmount,
        },
        {
          label: 'DP Charge',
          formula: 'Fixed per sell transaction',
          amount: dpAmount,
        },
        {
          label: 'Taxable Gain',
          formula: `max(0, (${formatMoney(exitPrice)} - ${formatMoney(buyPrice)}) x ${quantity})`,
          amount: taxableGain,
        },
        {
          label: 'CGT',
          formula: `${formatMoney(taxableGain)} x ${formatRate(cgtRate)}`,
          amount: cgtAmount,
        },
        {
          label: label === 'target' ? 'Net Proceeds at Target' : 'Net Proceeds at Stop-Loss',
          formula: 'Gross value - all deductions',
          amount: proceeds,
        },
        {
          label: 'Cost Basis (Buy Side)',
          formula: 'From selected/manual buy trade',
          amount: result.costBasis,
        },
        {
          label: label === 'target' ? 'Profit/Loss at Target' : 'Profit/Loss at Stop-Loss',
          formula: `${formatMoney(proceeds)} - ${formatMoney(result.costBasis)}`,
          amount: pnl,
        },
      ];
    };

    return {
      target: buildRows('target', result.target, targetPrice, result.targetPnL),
      stop: buildRows('stop', result.stopLoss, stopLossPrice, result.stopLossPnL),
    };
  }, [
    buyPrice,
    formatMoney,
    formatRate,
    getBreakdownAmount,
    getBreakdownRate,
    quantity,
    result,
    stopLossPrice,
    targetPrice,
  ]);

  return (
    <section className="card">
      <h2>Profit/Loss with Target & Stop-Loss</h2>
      <p className="subtle">Pick an existing buy trade, then preview target and stop-loss exits after all charges.</p>

      <form className="form-grid" onSubmit={handleSimulate}>
        <div className="field-group">
          <label className="label" htmlFor="tradeSelect">
            Select buy trade
          </label>
          <select
            id="tradeSelect"
            value={selectedTradeId ?? ''}
            onChange={(e) => setSelectedTradeId(e.target.value ? Number(e.target.value) : null)}
            disabled={loadingTrades}
          >
            <option value="">{loadingTrades ? 'Loading trades...' : 'Manual entry (no selected trade)'}</option>
            {trades.map((trade) => (
              <option key={trade.id} value={trade.id}>
                {trade.symbol} | Buy: {trade.price} | Qty: {trade.qty}
              </option>
            ))}
          </select>
          {!loadingTrades && trades.length === 0 ? <small className="subtle">No buy trades found. Use manual entry below.</small> : null}
        </div>

        <div className="field-group">
          <label className="label" htmlFor="buyPrice">
            Buy price (NPR)
          </label>
          <input
            id="buyPrice"
            type="number"
            step="0.01"
            value={buyPrice || ''}
            onChange={(e) => setBuyPrice(Number(e.target.value))}
            required
          />
        </div>

        <div className="field-group">
          <label className="label" htmlFor="quantity">
            Quantity
          </label>
          <input
            id="quantity"
            type="number"
            value={quantity || ''}
            onChange={(e) => setQuantity(Number(e.target.value))}
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
            value={holdingDays}
            onChange={(e) => setHoldingDays(Number(e.target.value))}
            required
          />
        </div>

        <div className="field-group">
          <label className="label" htmlFor="targetPrice">
            Target price (NPR)
          </label>
          <input
            id="targetPrice"
            type="number"
            step="0.01"
            placeholder="900.00"
            value={targetPrice || ''}
            onChange={(e) => setTargetPrice(Number(e.target.value))}
            required
          />
        </div>

        <div className="field-group">
          <label className="label" htmlFor="stopLossPrice">
            Stop-loss price (NPR)
          </label>
          <input
            id="stopLossPrice"
            type="number"
            step="0.01"
            placeholder="780.00"
            value={stopLossPrice || ''}
            onChange={(e) => setStopLossPrice(Number(e.target.value))}
            required
          />
        </div>

        <button className="primary-btn" type="submit" disabled={loading}>
          {loading ? 'Simulating...' : 'Run Simulation'}
        </button>

        {error ? <p className="error-text">{error}</p> : null}
      </form>

      {result && scenarioRows ? (
        <>
          <div className="summary-grid simulator-grid">
            <article className="summary-card">
              <p>If exit at target</p>
              <h3>{formatMoney(result.target.netProceeds ?? 0)}</h3>
              <small className={result.targetPnL >= 0 ? 'profit' : 'loss'}>
                {result.targetPnL >= 0 ? 'Profit' : 'Loss'}: {formatMoney(result.targetPnL)}
              </small>
            </article>

            <article className="summary-card">
              <p>If exit at stop-loss</p>
              <h3>{formatMoney(result.stopLoss.netProceeds ?? 0)}</h3>
              <small className={result.stopLossPnL >= 0 ? 'profit' : 'loss'}>
                {result.stopLossPnL >= 0 ? 'Profit' : 'Loss'}: {formatMoney(result.stopLossPnL)}
              </small>
            </article>

            <article className="summary-card">
              <p>Cost basis (from buy trade)</p>
              <h3>{formatMoney(result.costBasis)}</h3>
              <small>CGT band: {holdingDays <= 365 ? '7.50%' : '5.00%'}</small>
            </article>
          </div>

          <div className="scenario-grid">
            <article className="scenario-card">
              <h3>Target Exit Breakdown</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Step</th>
                      <th>How</th>
                      <th>Amount (NPR)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scenarioRows.target.map((row) => (
                      <tr key={`target-${row.label}`}>
                        <td>{row.label}</td>
                        <td>{row.formula}</td>
                        <td className={row.label.includes('Profit/Loss') ? (row.amount >= 0 ? 'profit' : 'loss') : ''}>{formatMoney(row.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="scenario-card">
              <h3>Stop-Loss Exit Breakdown</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Step</th>
                      <th>How</th>
                      <th>Amount (NPR)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scenarioRows.stop.map((row) => (
                      <tr key={`stop-${row.label}`}>
                        <td>{row.label}</td>
                        <td>{row.formula}</td>
                        <td className={row.label.includes('Profit/Loss') ? (row.amount >= 0 ? 'profit' : 'loss') : ''}>{formatMoney(row.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </div>
        </>
      ) : null}
    </section>
  );
}
