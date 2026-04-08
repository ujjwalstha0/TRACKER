import { WatchlistItem } from '../types';

interface WatchlistTableProps {
  rows: WatchlistItem[];
}

function cgtFlag(item: WatchlistItem): string {
  return item.listingType === 'listed' ? 'Listed CGT (5%/7.5%)' : 'Unlisted CGT (10%)';
}

export function WatchlistTable({ rows }: WatchlistTableProps) {
  return (
    <section className="panel table-wrap">
      <h2>Watchlist</h2>
      <table>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Sector</th>
            <th>Buy Price</th>
            <th>Current Price</th>
            <th>Unrealized P&L</th>
            <th>CGT Flag</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => {
            const pnl = (item.currentPrice - item.buyPrice) * item.quantity;
            return (
              <tr key={item.symbol}>
                <td>{item.symbol}</td>
                <td>{item.sector}</td>
                <td>{item.buyPrice}</td>
                <td>{item.currentPrice}</td>
                <td className={pnl >= 0 ? 'up' : 'down'}>{pnl.toFixed(2)}</td>
                <td>{cgtFlag(item)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
