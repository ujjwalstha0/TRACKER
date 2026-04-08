import { useMemo, useState } from 'react';

export function SimulationPage() {
  const [checks, setChecks] = useState({
    context: true,
    trigger: false,
    risk: false,
    plan: false,
  });

  const readiness = useMemo(() => {
    const values = Object.values(checks);
    const count = values.filter(Boolean).length;
    return Math.round((count / values.length) * 100);
  }, [checks]);

  return (
    <section className="grid-layout">
      <article className="panel metric-card">
        <p>Virtual Capital</p>
        <h3>NPR 500,000</h3>
      </article>
      <article className="panel metric-card">
        <p>Real Portfolio Return</p>
        <h3 className="up">+8.20%</h3>
      </article>
      <article className="panel metric-card">
        <p>Paper Portfolio Return</p>
        <h3 className="up">+13.90%</h3>
      </article>
      <article className="panel metric-card">
        <p>Trade Readiness</p>
        <h3 className={readiness >= 75 ? 'up' : 'down'}>{readiness}%</h3>
      </article>
      <article className="panel">
        <h2>Strategy Testing Helper</h2>
        <p>Rules: EMA cross, RSI {'<'} 30, time-based exits.</p>
        <table>
          <thead>
            <tr>
              <th>Rule</th>
              <th>Symbol</th>
              <th>P&L</th>
              <th>Win Rate</th>
              <th>Avg Win/Loss</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>EMA(9/21) cross</td>
              <td>NABIL</td>
              <td className="up">+24,200</td>
              <td>57.1%</td>
              <td>1.48</td>
            </tr>
            <tr>
              <td>RSI {'<'} 30 + 10-day exit</td>
              <td>UPPER</td>
              <td className="up">+18,090</td>
              <td>54.8%</td>
              <td>1.33</td>
            </tr>
          </tbody>
        </table>
      </article>

      <article className="panel checklist-panel">
        <h3>Pre-Trade Discipline Gate</h3>
        <label>
          <input type="checkbox" checked={checks.context} onChange={(e) => setChecks({ ...checks, context: e.target.checked })} />
          Sector and index context agree with trade direction
        </label>
        <label>
          <input type="checkbox" checked={checks.trigger} onChange={(e) => setChecks({ ...checks, trigger: e.target.checked })} />
          Entry trigger and invalidation level are defined
        </label>
        <label>
          <input type="checkbox" checked={checks.risk} onChange={(e) => setChecks({ ...checks, risk: e.target.checked })} />
          Position size keeps risk below 2% of account
        </label>
        <label>
          <input type="checkbox" checked={checks.plan} onChange={(e) => setChecks({ ...checks, plan: e.target.checked })} />
          Profit booking plan is written before order
        </label>
      </article>
    </section>
  );
}
