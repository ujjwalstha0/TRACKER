import { TradeRow } from '../types';

interface TradeJournalTableProps {
  rows: TradeRow[];
}

export function TradeJournalTable({ rows }: TradeJournalTableProps) {
  if (!rows.length) {
    return <div className="panel">No trades logged yet.</div>;
  }

  return (
    <div className="panel table-wrap">
      <h2>Personal Trade Journal</h2>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Symbol</th>
            <th>Side</th>
            <th>Price</th>
            <th>Qty</th>
            <th>Total Value</th>
            <th>Broker Fee</th>
            <th>SEBON Fee</th>
            <th>DP Fee</th>
            <th>CGT Rate</th>
            <th>CGT Amount</th>
            <th>Net Cost/Proceeds</th>
            <th>Holding Days</th>
            <th>Sector</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.id}</td>
              <td>{row.symbol}</td>
              <td>{row.isBuy ? 'BUY' : 'SELL'}</td>
              <td>{row.price}</td>
              <td>{row.qty}</td>
              <td>{row.totalValue}</td>
              <td>{row.brokerFee}</td>
              <td>{row.sebonFee}</td>
              <td>{row.dpFee}</td>
              <td>{(row.cgtRate * 100).toFixed(2)}%</td>
              <td>{row.cgtAmount}</td>
              <td>{row.netCostOrProceeds}</td>
              <td>{row.holdingDays ?? '-'}</td>
              <td>{row.sector ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
