import { FormEvent, useMemo, useState } from 'react';
import { calculateFees } from '../lib/api';
import { FeeCalculationInput, FeeCalculationResult } from '../types';

const defaultInput: FeeCalculationInput = {
  symbol: 'NABIL',
  side: 'buy',
  instrumentType: 'equity',
  entityType: 'individual',
  listingType: 'listed',
  price: 550,
  quantity: 100,
  holdingDays: 120,
  buyPricePerShare: 500,
};

export function CalculatorWidget() {
  const [input, setInput] = useState<FeeCalculationInput>(defaultInput);
  const [result, setResult] = useState<FeeCalculationResult | null>(null);
  const [loading, setLoading] = useState(false);

  const titleAmount = useMemo(() => {
    if (!result) return '-';
    return input.side === 'buy'
      ? `Buy-In NPR ${result.totalBuyInCost.toLocaleString()}`
      : `Net Proceeds NPR ${result.netSellProceeds.toLocaleString()}`;
  }, [input.side, result]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      const data = await calculateFees(input);
      setResult(data);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel calculator-panel">
      <div className="panel-head">
        <h2>Trade Cost + CGT Desk</h2>
        <p>{titleAmount}</p>
      </div>

      <form className="calculator-grid" onSubmit={onSubmit}>
        <label>
          Symbol
          <input value={input.symbol} onChange={(e) => setInput({ ...input, symbol: e.target.value.toUpperCase() })} />
        </label>

        <label>
          Side
          <select value={input.side} onChange={(e) => setInput({ ...input, side: e.target.value as 'buy' | 'sell' })}>
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
        </label>

        <label>
          Price
          <input type="number" value={input.price} onChange={(e) => setInput({ ...input, price: Number(e.target.value) })} />
        </label>

        <label>
          Quantity
          <input type="number" value={input.quantity} onChange={(e) => setInput({ ...input, quantity: Number(e.target.value) })} />
        </label>

        <label>
          Instrument
          <select value={input.instrumentType} onChange={(e) => setInput({ ...input, instrumentType: e.target.value as FeeCalculationInput['instrumentType'] })}>
            <option value="equity">Equity</option>
            <option value="debenture">Debenture</option>
            <option value="other">Other</option>
          </select>
        </label>

        <label>
          Entity
          <select value={input.entityType} onChange={(e) => setInput({ ...input, entityType: e.target.value as FeeCalculationInput['entityType'] })}>
            <option value="individual">Individual</option>
            <option value="entity">Entity</option>
          </select>
        </label>

        <label>
          Listing
          <select value={input.listingType} onChange={(e) => setInput({ ...input, listingType: e.target.value as FeeCalculationInput['listingType'] })}>
            <option value="listed">Listed</option>
            <option value="unlisted">Unlisted</option>
          </select>
        </label>

        <label>
          Holding Days
          <input type="number" value={input.holdingDays ?? 0} onChange={(e) => setInput({ ...input, holdingDays: Number(e.target.value) })} />
        </label>

        <label>
          Buy Price/Share
          <input
            type="number"
            value={input.buyPricePerShare ?? 0}
            onChange={(e) => setInput({ ...input, buyPricePerShare: Number(e.target.value) })}
          />
        </label>

        <button className="cta" type="submit" disabled={loading}>
          {loading ? 'Calculating...' : 'Compute Charges'}
        </button>
      </form>

      {result && (
        <div className="breakdown-grid">
          <article>
            <h3>Core</h3>
            <p>Gross: NPR {result.grossValue.toLocaleString()}</p>
            <p>Broker Commission: NPR {result.brokerCommission.toLocaleString()}</p>
            <p>SEBON Tx Fee: NPR {result.sebonTransactionFee.toLocaleString()}</p>
            <p>DP Charge: NPR {result.dpCharge.toLocaleString()}</p>
            <p>CGT: NPR {result.cgtAmount.toLocaleString()} ({(result.cgtRate * 100).toFixed(2)}%)</p>
          </article>
          <article>
            <h3>Commission Split</h3>
            <p>Broker Share: NPR {result.commissionSplit.broker.toLocaleString()}</p>
            <p>NEPSE Share: NPR {result.commissionSplit.nepse.toLocaleString()}</p>
            <p>SEBON Inside: NPR {result.commissionSplit.sebonInside.toLocaleString()}</p>
          </article>
        </div>
      )}
    </section>
  );
}
