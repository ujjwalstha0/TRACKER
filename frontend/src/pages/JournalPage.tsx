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
    const wins = sells.filter((x) => Number(x.cgtAmount) >= 0).length;
    const winRate = sells.length ? (wins / sells.length) * 100 : 0;
    const avgHoldingDays = sells.length
      ? sells.reduce((sum, t) => sum + Number(t.holdingDays ?? 0), 0) / sells.length
      : 0;
    return { cgtPaid, pnl, winRate, avgHoldingDays, sellCount: sells.length };
  }, [rows]);

  return (
    <section className="stack-gap">
      <div className="stats-row">
        <article className="panel metric-card">
          <p>Total P&L</p>
          <h3 className={stats.pnl >= 0 ? 'up' : 'down'}>{stats.pnl.toFixed(2)} NPR</h3>
        </article>
        <article className="panel metric-card">
          <p>CGT Paid (FY)</p>
          <h3>{stats.cgtPaid.toFixed(2)} NPR</h3>
        </article>
        <article className="panel metric-card">
          <p>Win Rate</p>
          <h3 className={stats.winRate >= 50 ? 'up' : 'down'}>{stats.winRate.toFixed(1)}%</h3>
          <small>{stats.sellCount} closed trades</small>
        </article>
      </div>

      <div className="stats-row">
        <article className="panel metric-card">
          <p>Average Hold Time</p>
          <h3>{stats.avgHoldingDays.toFixed(1)} days</h3>
        </article>
        <article className="panel metric-card">
          <p>Process Reminder</p>
          <h3>Execute Plan, Not Emotion</h3>
        </article>
        <article className="panel metric-card">
          <p>Review Habit</p>
          <h3>End-day journal within 15 min</h3>
        </article>
      </div>
      <TradeJournalTable rows={rows} />
    </section>
  );
}
