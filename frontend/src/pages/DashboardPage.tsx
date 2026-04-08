import { useEffect, useMemo, useState } from 'react';

const cards = [
  { title: 'Net Realized P&L', value: 'NPR 82,410', tone: 'up', delta: '+2.4% this month' },
  { title: 'Capital at Risk Today', value: 'NPR 9,500', tone: 'flat', delta: '1.9% of account' },
  { title: 'Tax Impact Tracker', value: 'NPR 6,245', tone: 'down', delta: 'CGT running total' },
  { title: 'Execution Consistency', value: '74 / 100', tone: 'up', delta: 'From journal discipline' },
];

const indexRows = [
  { name: 'NEPSE', value: '2,118.40', move: '+0.82%', direction: 'up' },
  { name: 'Banking', value: '1,367.22', move: '-0.21%', direction: 'down' },
  { name: 'Hydro', value: '2,545.80', move: '+1.19%', direction: 'up' },
  { name: 'Finance', value: '1,901.41', move: '-0.13%', direction: 'down' },
];

const setups = [
  { symbol: 'NABIL', trigger: 'Break > 556', stop: '542', rr: '2.2R', note: 'Strong relative strength vs banking index' },
  { symbol: 'UPPER', trigger: 'Pullback near 338', stop: '329', rr: '2.0R', note: 'Hydro momentum continuation candidate' },
  { symbol: 'NICA', trigger: 'Close > 412', stop: '401', rr: '1.7R', note: 'Mean-reversion only if volume confirms' },
];

const pnlSeries = [8, 12, 9, 15, 11, 18, 21, 19, 25, 22, 27, 31];

const planStorageKey = 'nepse.daily.plan.v1';

export function DashboardPage() {
  const [dailyPlan, setDailyPlan] = useState(() => {
    const cached = localStorage.getItem(planStorageKey);
    if (cached) return cached;
    return 'Focus only on A+ setups with >1.8R. No impulsive midday entries.';
  });

  useEffect(() => {
    localStorage.setItem(planStorageKey, dailyPlan);
  }, [dailyPlan]);

  const curveStats = useMemo(() => {
    const highest = Math.max(...pnlSeries);
    const latest = pnlSeries[pnlSeries.length - 1];
    const previous = pnlSeries[pnlSeries.length - 2] ?? latest;
    return {
      highest,
      latest,
      delta: latest - previous,
    };
  }, []);

  return (
    <section className="grid-layout">
      <article className="panel hero">
        <p className="kicker">Today&apos;s Mandate</p>
        <h2>Take high-conviction trades only when setup, risk, and market context align.</h2>
        <p>Every panel below is built to protect capital first and maximize quality decisions second.</p>
      </article>
      {cards.map((card) => (
        <article key={card.title} className="panel metric-card">
          <p>{card.title}</p>
          <h3 className={card.tone === 'up' ? 'up' : card.tone === 'down' ? 'down' : ''}>{card.value}</h3>
          <small>{card.delta}</small>
        </article>
      ))}
      <article className="panel index-strip">
        <h3>Sector Pulse</h3>
        {indexRows.map((row) => (
          <div className="index-row" key={row.name}>
            <span>{row.name}</span>
            <strong>{row.value}</strong>
            <span className={row.direction === 'up' ? 'up' : 'down'}>{row.move}</span>
          </div>
        ))}
      </article>

      <article className="panel watch-panel">
        <h3>A+ Setup Queue</h3>
        {setups.map((setup) => (
          <div key={setup.symbol} className="setup-row">
            <div>
              <strong>{setup.symbol}</strong>
              <p>{setup.note}</p>
            </div>
            <div>
              <p>Trigger: {setup.trigger}</p>
              <p>Stop: {setup.stop}</p>
              <p className="up">Potential: {setup.rr}</p>
            </div>
          </div>
        ))}
      </article>

      <article className="panel checklist-panel">
        <h3>Execution Checklist</h3>
        <ul>
          <li>Market breadth confirms your direction</li>
          <li>Position risk is less than 2% of capital</li>
          <li>Entry, stop, and exit are defined before order</li>
          <li>No revenge trade after a loss</li>
        </ul>
      </article>

      <article className="panel plan-panel">
        <h3>Daily Trade Plan</h3>
        <p>Write your plan before market open. This note is saved on your device.</p>
        <textarea value={dailyPlan} onChange={(e) => setDailyPlan(e.target.value)} rows={4} maxLength={320} />
        <small>{dailyPlan.length}/320 characters</small>
      </article>

      <article className="panel curve-panel">
        <h3>P&L Momentum Curve</h3>
        <p>
          Latest point: <strong className="up">{curveStats.latest}R</strong> ({curveStats.delta >= 0 ? '+' : ''}
          {curveStats.delta}R vs previous)
        </p>
        <div className="curve-bars">
          {pnlSeries.map((point, index) => (
            <span
              key={`${point}-${index}`}
              className="curve-bar"
              style={{ height: `${Math.round((point / curveStats.highest) * 100)}%` }}
              title={`Trade ${index + 1}: ${point}R`}
            />
          ))}
        </div>
      </article>
    </section>
  );
}
