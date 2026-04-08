import { FormEvent, useMemo, useState } from 'react';
import { calculateFees } from '../lib/api';
import { FeeCalculationInput, FeeCalculationResult } from '../types';

interface CalculatorFormState {
  symbol: string;
  instrumentType: FeeCalculationInput['instrumentType'];
  entityType: FeeCalculationInput['entityType'];
  listingType: FeeCalculationInput['listingType'];
  buyPrice: number;
  sellPrice: number;
  quantity: number;
  holdingDays: number;
}

const defaultInput: CalculatorFormState = {
  symbol: 'NABIL',
  instrumentType: 'equity',
  entityType: 'individual',
  listingType: 'listed',
  buyPrice: 550,
  sellPrice: 575,
  quantity: 100,
  holdingDays: 120,
};

export function CalculatorWidget() {
  const [input, setInput] = useState<CalculatorFormState>(defaultInput);
  const [buyResult, setBuyResult] = useState<FeeCalculationResult | null>(null);
  const [sellResult, setSellResult] = useState<FeeCalculationResult | null>(null);
  const [loading, setLoading] = useState(false);

  const summary = useMemo(() => {
    if (!buyResult || !sellResult) {
      return {
        totalBuy: 0,
        totalSell: 0,
        net: 0,
      };
    }

    const totalBuy = buyResult.totalBuyInCost;
    const totalSell = sellResult.netSellProceeds;
    return {
      totalBuy,
      totalSell,
      net: totalSell - totalBuy,
    };
  }, [buyResult, sellResult]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      const commonFields = {
        symbol: input.symbol,
        instrumentType: input.instrumentType,
        entityType: input.entityType,
        listingType: input.listingType,
        quantity: input.quantity,
      };

      const buyPayload: FeeCalculationInput = {
        ...commonFields,
        side: 'buy',
        price: input.buyPrice,
      };

      const sellPayload: FeeCalculationInput = {
        ...commonFields,
        side: 'sell',
        price: input.sellPrice,
        holdingDays: input.holdingDays,
        buyPricePerShare: input.buyPrice,
      };

      const [buyData, sellData] = await Promise.all([calculateFees(buyPayload), calculateFees(sellPayload)]);
      setBuyResult(buyData);
      setSellResult(sellData);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel calculator-panel">
      <div className="panel-head">
        <h2>Stock Buy vs Sell Net Calculator</h2>
        <p>Enter buy and planned sell price to see complete cost, net proceeds, and net outcome after all charges.</p>
      </div>

      <form className="calculator-grid" onSubmit={onSubmit}>
        <label>
          Symbol
          <input value={input.symbol} onChange={(e) => setInput({ ...input, symbol: e.target.value.toUpperCase() })} />
        </label>

        <label>
          Buy Price
          <input type="number" value={input.buyPrice} onChange={(e) => setInput({ ...input, buyPrice: Number(e.target.value) })} />
        </label>

        <label>
          Planned Sell Price
          <input type="number" value={input.sellPrice} onChange={(e) => setInput({ ...input, sellPrice: Number(e.target.value) })} />
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
          <input type="number" value={input.holdingDays ?? 120} onChange={(e) => setInput({ ...input, holdingDays: Number(e.target.value) })} />
        </label>

        <button className="cta" type="submit" disabled={loading}>
          {loading ? 'Calculating...' : 'Calculate Net Buy & Sell'}
        </button>
      </form>

      {buyResult && sellResult && (
        <>
          <div className="result-strip">
            <article className="panel metric-card">
              <p>Total Money Needed To Buy</p>
              <h3>NPR {summary.totalBuy.toLocaleString(undefined, { maximumFractionDigits: 2 })}</h3>
            </article>
            <article className="panel metric-card">
              <p>Money You Receive After Sell</p>
              <h3>NPR {summary.totalSell.toLocaleString(undefined, { maximumFractionDigits: 2 })}</h3>
            </article>
            <article className="panel metric-card">
              <p>Final Net (After Charges + CGT)</p>
              <h3 className={summary.net >= 0 ? 'up' : 'down'}>
                NPR {summary.net.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </h3>
            </article>
          </div>

          <div className="breakdown-grid">
            <article>
              <h3>Buy Side Breakdown</h3>
              <p>Gross Buy Value: NPR {buyResult.grossValue.toLocaleString()}</p>
              <p>Broker Commission: NPR {buyResult.brokerCommission.toLocaleString()}</p>
              <p>SEBON Fee: NPR {buyResult.sebonTransactionFee.toLocaleString()}</p>
              <p>DP Charge: NPR {buyResult.dpCharge.toLocaleString()}</p>
              <p>Total Buy Cost: NPR {buyResult.totalBuyInCost.toLocaleString()}</p>
            </article>
            <article>
              <h3>Sell Side Breakdown</h3>
              <p>Gross Sell Value: NPR {sellResult.grossValue.toLocaleString()}</p>
              <p>Broker Commission: NPR {sellResult.brokerCommission.toLocaleString()}</p>
              <p>SEBON Fee: NPR {sellResult.sebonTransactionFee.toLocaleString()}</p>
              <p>DP Charge: NPR {sellResult.dpCharge.toLocaleString()}</p>
              <p>
                CGT: NPR {sellResult.cgtAmount.toLocaleString()} ({(sellResult.cgtRate * 100).toFixed(2)}%)
              </p>
              <p>Net Sell Proceeds: NPR {sellResult.netSellProceeds.toLocaleString()}</p>
            </article>
          </div>
        </>
      )}
    </section>
  );
}
