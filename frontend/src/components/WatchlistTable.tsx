import { WatchlistItem } from '../types';

interface WatchlistTableProps {
  rows: WatchlistItem[];
}

function cgtFlag(item: WatchlistItem): string {
  return item.listingType === 'listed' ? 'Listed CGT (5%/7.5%)' : 'Unlisted CGT (10%)';
}

function getConvictionScore(item: WatchlistItem): number {
  const rr = (item.targetPrice - item.currentPrice) / Math.max(1, item.currentPrice - item.stopLoss);
  const rrScore = Math.max(0, Math.min(40, rr * 18));
  const momentumScore = Math.max(0, Math.min(35, item.momentum * 3.5));
  const pnlDirectionScore = item.currentPrice >= item.buyPrice ? 25 : 14;
  return Math.round(rrScore + momentumScore + pnlDirectionScore);
}

export function WatchlistTable({ rows }: WatchlistTableProps) {
  return (
    <section className="panel table-wrap">
      <h2>Setup Radar</h2>
      <table>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Sector</th>
            <th>Entry</th>
            <th>LTP</th>
            <th>Target</th>
            <th>Stop</th>
            <th>R/R</th>
            <th>Unrealized P&L</th>
            <th>Momentum</th>
            <th>Conviction</th>
            <th>Catalyst</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => {
            const pnl = (item.currentPrice - item.buyPrice) * item.quantity;
            const risk = Math.max(1, item.currentPrice - item.stopLoss);
            const reward = Math.max(0, item.targetPrice - item.currentPrice);
            const rr = reward / risk;
            const score = getConvictionScore(item);
            return (
              <tr key={item.symbol}>
                <td>{item.symbol}</td>
                <td>{item.sector}</td>
                <td>{item.buyPrice}</td>
                <td>{item.currentPrice}</td>
                <td>{item.targetPrice}</td>
                <td>{item.stopLoss}</td>
                <td className={rr >= 1.8 ? 'up' : ''}>{rr.toFixed(2)}R</td>
                <td className={pnl >= 0 ? 'up' : 'down'}>{pnl.toFixed(2)}</td>
                <td className={item.momentum >= 7 ? 'up' : ''}>{item.momentum.toFixed(1)}</td>
                <td>
                  <span className={score >= 70 ? 'score-pill good' : score >= 55 ? 'score-pill mid' : 'score-pill low'}>{score}</span>
                </td>
                <td>
                  {item.catalyst}
                  <div className="muted-mini">{cgtFlag(item)}</div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
