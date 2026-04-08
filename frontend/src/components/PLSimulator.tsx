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

  const handleSimulate = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!selectedTrade) {
        setError('Please select a buy trade first.');
        return;
      }

      setLoading(true);
      setError('');

      try {
        const payloadBase = {
          isBuy: false,
          qty: selectedTrade.qty,
          instrumentType: 'equity' as const,
          traderType: 'individual' as const,
          buyPrice: selectedTrade.price,
          holdingDays,
        };

        const [target, stopLoss] = await Promise.all([
          calculateNepseCost({ ...payloadBase, price: targetPrice }),
          calculateNepseCost({ ...payloadBase, price: stopLossPrice }),
        ]);

        const costBasis = selectedTrade.netCostOrProceeds;
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
    [holdingDays, selectedTrade, stopLossPrice, targetPrice],
  );

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
            <option value="">{loadingTrades ? 'Loading trades...' : 'Choose a buy trade'}</option>
            {trades.map((trade) => (
              <option key={trade.id} value={trade.id}>
                {trade.symbol} | Buy: {trade.price} | Qty: {trade.qty}
              </option>
            ))}
          </select>
        </div>

        <div className="field-group">
          <label className="label">Buy price (auto)</label>
          <input value={selectedTrade ? selectedTrade.price : ''} readOnly />
        </div>

        <div className="field-group">
          <label className="label">Quantity (auto)</label>
          <input value={selectedTrade ? selectedTrade.qty : ''} readOnly />
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
            disabled={!selectedTrade}
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
            disabled={!selectedTrade}
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
            disabled={!selectedTrade}
            required
          />
        </div>

        <button className="primary-btn" type="submit" disabled={loading || !selectedTrade}>
          {loading ? 'Simulating...' : 'Run Simulation'}
        </button>

        {error ? <p className="error-text">{error}</p> : null}
      </form>

      {result ? (
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
      ) : null}
    </section>
  );
}
