import { useEffect, useMemo, useState } from 'react';
import { fetchTrades } from '../lib/api';
import { TradeJournalTable } from '../components/TradeJournalTable';
import { TradeRow } from '../types';

export function JournalPage() {
  const [rows, setRows] = useState<TradeRow[]>([]);

  useEffect(() => {
    fetchTrades().then(setRows).catch(() => setRows([]));
  }, []);

  const stats = useMemo(() => {
    const sells = rows.filter((x) => !x.isBuy);
    const cgtPaid = sells.reduce((sum, t) => sum + Number(t.cgtAmount), 0);
    const pnl = rows.reduce((sum, t) => sum + (t.isBuy ? -Number(t.netCostOrProceeds) : Number(t.netCostOrProceeds)), 0);
    return { cgtPaid, pnl };
  }, [rows]);

  return (
    <section className="stack-gap">
      <div className="stats-row">
        <article className="panel metric-card">
          <p>Total P&L</p>
          <h3 className={stats.pnl >= 0 ? 'up' : 'down'}>{stats.pnl.toFixed(2)}</h3>
        </article>
        <article className="panel metric-card">
          <p>CGT Paid (FY)</p>
          <h3>{stats.cgtPaid.toFixed(2)}</h3>
        </article>
        <article className="panel metric-card">
          <p>Win Rate</p>
          <h3>Track with your target/stop fields</h3>
        </article>
      </div>
      <TradeJournalTable rows={rows} />
    </section>
  );
}
